package config

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/BurntSushi/toml"
)

// ─── Public types ─────────────────────────────────────────────────────────────

// TemplateParam describes one user-facing parameter of a Spin template as
// parsed from the template's metadata/spin-template.toml.
type TemplateParam struct {
	// ID is the parameter key used with --value key=value.
	ID string `json:"id"`
	// Prompt is the human-readable label shown in the UI.
	Prompt string `json:"prompt"`
	// Default is the pre-filled value (may be empty string).
	Default string `json:"default,omitempty"`
	// Pattern is an optional regex the value must satisfy.
	Pattern string `json:"pattern,omitempty"`
	// AllowedValues, when non-nil, restricts input to a fixed set (rendered
	// as a <select> in the UI).
	AllowedValues []string `json:"allowed_values,omitempty"`
	// IsHTTPPath is true for the special "http-path" parameter so the
	// frontend can render the private-endpoint toggle alongside it.
	IsHTTPPath bool `json:"is_http_path,omitempty"`
}

// TemplateInfo describes one installed Spin template.
type TemplateInfo struct {
	ID          string          `json:"id"`
	Description string          `json:"description"`
	Parameters  []TemplateParam `json:"parameters"`
}

// DiscoverTemplates scans the Spin templates directory and returns info about
// every installed template, including its user-facing parameters (filtered to
// those relevant for `spin add`, not `spin new`).
func DiscoverTemplates() ([]TemplateInfo, error) {
	dirs := spinTemplateDirs()
	for _, dir := range dirs {
		if _, err := os.Stat(dir); err == nil {
			return scanTemplatesDir(dir)
		}
	}
	return nil, nil // no templates dir found — caller should fall back
}

// ─── Internal ────────────────────────────────────────────────────────────────

// rawSpinTemplate mirrors the on-disk structure of spin-template.toml.
type rawSpinTemplate struct {
	ManifestVersion string `toml:"manifest_version"`
	ID              string `toml:"id"`
	Description     string `toml:"description"`
	AddComponent    struct {
		SkipParameters []string `toml:"skip_parameters"`
	} `toml:"add_component"`
	Parameters map[string]rawParam `toml:"parameters"`
}

type rawParam struct {
	Type          string   `toml:"type"`
	Prompt        string   `toml:"prompt"`
	Default       string   `toml:"default"`
	Pattern       string   `toml:"pattern"`
	AllowedValues []string `toml:"allowed_values"`
}

func scanTemplatesDir(dir string) ([]TemplateInfo, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	var results []TemplateInfo
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		meta := filepath.Join(dir, e.Name(), "metadata", "spin-template.toml")
		info, err := parseTemplateMetadata(meta)
		if err != nil || info == nil {
			continue
		}
		results = append(results, *info)
	}
	return results, nil
}

func parseTemplateMetadata(path string) (*TemplateInfo, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err // template dir without metadata — skip
	}

	var raw rawSpinTemplate
	if _, err := toml.Decode(string(data), &raw); err != nil {
		return nil, err
	}
	if raw.ID == "" {
		return nil, nil
	}

	// Build skip set from the flat add_component.skip_parameters list.
	// Conditional skips (add_component.conditions.*) are intentionally not
	// evaluated here — those parameters are included and the backend may
	// pass --value for them (they have defaults or are optional).
	skipSet := make(map[string]bool, len(raw.AddComponent.SkipParameters))
	for _, p := range raw.AddComponent.SkipParameters {
		skipSet[p] = true
	}

	// Collect parameters in a stable order (TOML maps are unordered, so we
	// use the order: non-path params first, http-path last — matching the
	// order Spin prompts them interactively).
	var params []TemplateParam
	var httpPathParam *TemplateParam

	for id, rp := range raw.Parameters {
		if skipSet[id] {
			continue
		}
		p := TemplateParam{
			ID:            id,
			Prompt:        rp.Prompt,
			Default:       rp.Default,
			Pattern:       rp.Pattern,
			AllowedValues: rp.AllowedValues,
		}
		if id == "http-path" {
			p.IsHTTPPath = true
			httpPathParam = &p
		} else {
			params = append(params, p)
		}
	}

	// Sort non-path params alphabetically for stability.
	sortParams(params)

	// Append http-path last so the route field appears at the end of the form.
	if httpPathParam != nil {
		params = append(params, *httpPathParam)
	}

	return &TemplateInfo{
		ID:          raw.ID,
		Description: raw.Description,
		Parameters:  params,
	}, nil
}

// spinTemplateDirs returns candidate directories for Spin's template store in
// order of preference for the current OS.
func spinTemplateDirs() []string {
	var candidates []string

	switch runtime.GOOS {
	case "darwin":
		// Spin uses the macOS "Application Support" data directory.
		if home, err := os.UserHomeDir(); err == nil {
			candidates = append(candidates,
				filepath.Join(home, "Library", "Application Support", "spin", "templates"),
			)
		}
	default:
		// XDG-based systems (Linux, BSD, …)
		if xdg := os.Getenv("XDG_DATA_HOME"); xdg != "" {
			candidates = append(candidates, filepath.Join(xdg, "spin", "templates"))
		}
		if home, err := os.UserHomeDir(); err == nil {
			candidates = append(candidates,
				filepath.Join(home, ".local", "share", "spin", "templates"),
			)
		}
	}

	// Fallback: legacy ~/.spin/templates (some older installations).
	if home, err := os.UserHomeDir(); err == nil {
		candidates = append(candidates, filepath.Join(home, ".spin", "templates"))
	}

	return candidates
}

// sortParams sorts template params by ID for a stable UI ordering.
func sortParams(params []TemplateParam) {
	// Simple insertion sort (small N — typically < 10 params per template).
	for i := 1; i < len(params); i++ {
		for j := i; j > 0 && strings.Compare(params[j].ID, params[j-1].ID) < 0; j-- {
			params[j], params[j-1] = params[j-1], params[j]
		}
	}
}
