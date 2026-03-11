package config

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/BurntSushi/toml"
)

// ─── Public types ─────────────────────────────────────────────────────────────

// VarEntry represents a single resolved variable with its source.
type VarEntry struct {
	Key    string `json:"key"`
	Value  string `json:"value"`
	Source string `json:"source"` // "spin.toml" | ".env"
	Secret bool   `json:"secret"` // true when declared secret = true in spin.toml
}

// TriggerInfo is a normalised trigger entry.
type TriggerInfo struct {
	Type      string `json:"type"`
	Route     string `json:"route,omitempty"`
	Channel   string `json:"channel,omitempty"`
	Address   string `json:"address,omitempty"`
	Component string `json:"component"`
}

// FileMount represents one entry in a component's files array.
type FileMount struct {
	Source      string `json:"source"`
	Destination string `json:"destination,omitempty"`
}

// BuildInfo holds the optional [component.id.build] section.
type BuildInfo struct {
	Command string   `json:"command,omitempty"`
	Workdir string   `json:"workdir,omitempty"`
	Watch   []string `json:"watch,omitempty"`
}

// ComponentInfo is a normalised component entry.
type ComponentInfo struct {
	ID                   string            `json:"id"`
	Source               string            `json:"source"`
	SourceDigest         string            `json:"sourceDigest,omitempty"` // sha256:... for remote URL sources
	SourceSize           int64             `json:"sourceSize,omitempty"`   // bytes, 0 for remote URLs
	AllowedOutboundHosts []string          `json:"allowedOutboundHosts,omitempty"`
	KeyValueStores       []string          `json:"keyValueStores,omitempty"`
	SQLiteDatabases      []string          `json:"sqliteDatabases,omitempty"`
	Variables            map[string]string `json:"variables,omitempty"`
	Files                []FileMount       `json:"files,omitempty"`
	Build                *BuildInfo        `json:"build,omitempty"`
	Triggers             []TriggerInfo     `json:"triggers,omitempty"`
}

// AppConfig holds the full parsed Spin application metadata.
type AppConfig struct {
	Name        string
	Description string
	Variables   []VarEntry
	Components  []ComponentInfo
	Triggers    []TriggerInfo
	// ListenAddr is the URL where the Spin app is reachable (derived from --listen).
	// Empty when no --listen flag was provided.
	ListenAddr string
}

// ─── Load ─────────────────────────────────────────────────────────────────────

// Load parses spin.toml and .env from dir and returns the full AppConfig.
func Load(dir string) (*AppConfig, error) {
	tomlPath := fmt.Sprintf("%s/spin.toml", dir)

	appName, appDesc, rawVars, components, triggers, err := decodeSpinTOML(tomlPath)
	if err != nil {
		return nil, fmt.Errorf("reading spin.toml: %w", err)
	}

	vars := buildVarEntries(rawVars)

	// Overlay .env values.
	envPath := fmt.Sprintf("%s/.env", dir)
	envEntries, err := parseEnvFile(envPath)
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("reading .env: %w", err)
	}
	for _, entry := range envEntries {
		updated := false
		for i, v := range vars {
			if v.Key == entry.Key {
				vars[i].Value = entry.Value
				vars[i].Source = ".env"
				updated = true
				break
			}
		}
		if !updated {
			vars = append(vars, entry)
		}
	}

	// Synthesize VarEntry items for variable names referenced in component
	// bindings that are not declared in [variables].  This covers apps where
	// [variables] is absent or only partially defined, so the Variables page
	// always surfaces every variable the app actually uses.
	knownVarKeys := make(map[string]struct{}, len(vars))
	for _, v := range vars {
		knownVarKeys[v.Key] = struct{}{}
	}
	for _, comp := range components {
		for k := range comp.Variables {
			if _, exists := knownVarKeys[k]; !exists {
				vars = append(vars, VarEntry{Key: k, Source: "spin.toml"})
				knownVarKeys[k] = struct{}{}
			}
		}
	}
	sort.Slice(vars, func(i, j int) bool { return vars[i].Key < vars[j].Key })

	sort.Slice(components, func(i, j int) bool { return components[i].ID < components[j].ID })

	// Stat local source files for size; skip remote URLs.
	for i := range components {
		src := components[i].Source
		if src == "" || strings.HasPrefix(src, "http://") || strings.HasPrefix(src, "https://") {
			continue
		}
		p := src
		if !filepath.IsAbs(src) {
			p = filepath.Join(dir, src)
		}
		if info, statErr := os.Stat(p); statErr == nil {
			components[i].SourceSize = info.Size()
		}
	}

	return &AppConfig{
		Name:        appName,
		Description: appDesc,
		Variables:   vars,
		Components:  components,
		Triggers:    triggers,
	}, nil
}

// ─── Decode – raw map approach (handles any manifest version) ─────────────────

// decodeSpinTOML decodes the TOML file into a generic map and extracts
// application metadata.  Using a raw map avoids type-mismatch panics when the
// caller struct doesn't perfectly match the manifest version on disk.
func decodeSpinTOML(path string) (
	name, description string,
	variables map[string]map[string]interface{},
	components []ComponentInfo,
	triggers []TriggerInfo,
	err error,
) {
	var raw map[string]interface{}
	if _, decErr := toml.DecodeFile(path, &raw); decErr != nil {
		err = decErr
		return
	}

	// ── Application section ──────────────────────────────────────────────────
	if appRaw, ok := raw["application"]; ok {
		if appMap := toMap(appRaw); appMap != nil {
			name = strVal(appMap["name"])
			description = strVal(appMap["description"])
		}
	}

	// ── Variables section ────────────────────────────────────────────────────
	variables = make(map[string]map[string]interface{})
	if varsRaw, ok := raw["variables"]; ok {
		if varsMap := toMap(varsRaw); varsMap != nil {
			for k, v := range varsMap {
				if def := toMap(v); def != nil {
					variables[k] = def
				} else {
					variables[k] = map[string]interface{}{"default": strVal(v)}
				}
			}
		}
	}

	// ── Triggers section ─────────────────────────────────────────────────────
	//
	// Spin v2: [[trigger.http]], [[trigger.redis]], etc.
	// In raw form this arrives as:
	//   trigger → map{ "http" → []interface{}{map{...}, ...} }
	if trigRaw, ok := raw["trigger"]; ok {
		if trigMap := toMap(trigRaw); trigMap != nil {
			for trigType, entries := range trigMap {
				for _, entry := range toSlice(entries) {
					if em := toMap(entry); em != nil {
						triggers = append(triggers, TriggerInfo{
							Type:      trigType,
							Route:     strVal(em["route"]),
							Channel:   strVal(em["channel"]),
							Address:   strVal(em["address"]),
							Component: strVal(em["component"]),
						})
					}
				}
			}
		}
	}

	// ── Components section ───────────────────────────────────────────────────
	//
	// Spin v2: [component.id]  → map[string]interface{}
	// Spin v1: [[component]]   → []map[string]interface{} (BurntSushi/toml
	//                            represents arrays-of-tables this way when
	//                            the destination type is interface{})
	trigsByComponent := make(map[string][]TriggerInfo)
	for _, t := range triggers {
		if t.Component != "" {
			trigsByComponent[t.Component] = append(trigsByComponent[t.Component], t)
		}
	}

	if compRaw, ok := raw["component"]; ok {
		switch cv := compRaw.(type) {

		// v2: [component.id] is a map keyed by component ID
		case map[string]interface{}:
			for id, def := range cv {
				if dm := toMap(def); dm != nil {
					components = append(components, extractComponent(id, dm, trigsByComponent))
				}
			}

		// v1: [[component]] decodes as []map[string]interface{}
		case []map[string]interface{}:
			for _, dm := range cv {
				id := strVal(dm["id"])
				components = append(components, extractComponent(id, dm, trigsByComponent))
			}

		// defensive: some decoders may use []interface{}
		case []interface{}:
			for _, elem := range cv {
				if dm := toMap(elem); dm != nil {
					id := strVal(dm["id"])
					components = append(components, extractComponent(id, dm, trigsByComponent))
				}
			}
		}
	}

	return
}

// extractComponent builds a ComponentInfo from a raw TOML map.
func extractComponent(id string, dm map[string]interface{}, trigsByComponent map[string][]TriggerInfo) ComponentInfo {
	// source may be a string or a map { url = "...", digest = "..." }
	source := ""
	sourceDigest := ""
	if s, ok := dm["source"]; ok {
		switch sv := s.(type) {
		case string:
			source = sv
		case map[string]interface{}:
			source = strVal(sv["url"])
			sourceDigest = strVal(sv["digest"])
		}
	}

	vars := map[string]string{}
	if vm := toMap(dm["variables"]); vm != nil {
		for k, v := range vm {
			vars[k] = strVal(v)
		}
	}

	// files: array of strings or {source, destination} maps
	var files []FileMount
	for _, f := range toSlice(dm["files"]) {
		switch fv := f.(type) {
		case string:
			files = append(files, FileMount{Source: fv})
		case map[string]interface{}:
			files = append(files, FileMount{
				Source:      strVal(fv["source"]),
				Destination: strVal(fv["destination"]),
			})
		}
	}

	// [component.id.build]
	var build *BuildInfo
	if bm := toMap(dm["build"]); bm != nil {
		build = &BuildInfo{
			Command: strVal(bm["command"]),
			Workdir: strVal(bm["workdir"]),
			Watch:   toStringSlice(bm["watch"]),
		}
	}

	return ComponentInfo{
		ID:                   id,
		Source:               source,
		SourceDigest:         sourceDigest,
		AllowedOutboundHosts: toStringSlice(dm["allowed_outbound_hosts"]),
		KeyValueStores:       toStringSlice(dm["key_value_stores"]),
		SQLiteDatabases:      toStringSlice(dm["sqlite_databases"]),
		Variables:            vars,
		Files:                files,
		Build:                build,
		Triggers:             trigsByComponent[id],
	}
}

// ─── Variable helpers ─────────────────────────────────────────────────────────

func buildVarEntries(variables map[string]map[string]interface{}) []VarEntry {
	vars := make([]VarEntry, 0, len(variables))
	for key, def := range variables {
		vars = append(vars, VarEntry{
			Key:    key,
			Value:  strVal(def["default"]),
			Source: "spin.toml",
			Secret: boolVal(def["secret"]),
		})
	}
	sort.Slice(vars, func(i, j int) bool { return vars[i].Key < vars[j].Key })
	return vars
}

// ─── .env parser ─────────────────────────────────────────────────────────────

func parseEnvFile(path string) ([]VarEntry, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var entries []VarEntry
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		idx := strings.IndexByte(line, '=')
		if idx < 0 {
			continue
		}
		key := strings.TrimSpace(line[:idx])
		val := strings.TrimSpace(line[idx+1:])
		if len(val) >= 2 &&
			((val[0] == '"' && val[len(val)-1] == '"') ||
				(val[0] == '\'' && val[len(val)-1] == '\'')) {
			val = val[1 : len(val)-1]
		}
		entries = append(entries, VarEntry{Key: key, Value: val, Source: ".env"})
	}
	return entries, scanner.Err()
}

// ─── Tiny TOML-raw helpers ────────────────────────────────────────────────────

func toMap(v interface{}) map[string]interface{} {
	if v == nil {
		return nil
	}
	m, _ := v.(map[string]interface{})
	return m
}

// toSlice normalises both slice forms BurntSushi/toml can produce when
// decoding into interface{}.
//
//   - Regular arrays decode as []interface{}
//   - Arrays-of-tables (e.g. [[trigger.http]]) decode as []map[string]interface{}
func toSlice(v interface{}) []interface{} {
	if v == nil {
		return nil
	}
	switch sv := v.(type) {
	case []interface{}:
		return sv
	case []map[string]interface{}:
		out := make([]interface{}, len(sv))
		for i, m := range sv {
			out[i] = m
		}
		return out
	}
	return nil
}

func strVal(v interface{}) string {
	if v == nil {
		return ""
	}
	s, _ := v.(string)
	return s
}

func boolVal(v interface{}) bool {
	if v == nil {
		return false
	}
	b, _ := v.(bool)
	return b
}

func toStringSlice(v interface{}) []string {
	items := toSlice(v)
	if len(items) == 0 {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		if s := strVal(item); s != "" {
			out = append(out, s)
		}
	}
	return out
}
