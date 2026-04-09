// Package kvexplorer handles injecting the KV explorer Spin component
// into a temporary Spin manifest so the dashboard can browse KV
// stores without modifying the user's spin.toml.
package kvexplorer

import (
	"embed"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/spinframework/dash/internal/config"
)

//go:embed wasm/kv_explorer.wasm
var embeddedWasm embed.FS

const (
	manifestFile = ".dash_manifest.toml"
	wasmFile     = ".dash_kv_explorer.wasm"

	// ExplorerRoute is the HTTP route prefix where the KV explorer component
	// is mounted inside the Spin app.
	ExplorerRoute = "/internal/kv-explorer"
)

// CollectKVStores returns all unique KV store names referenced across all
// components in the config, sorted alphabetically.
func CollectKVStores(cfg *config.AppConfig) []string {
	seen := make(map[string]struct{})
	for _, c := range cfg.Components {
		for _, s := range c.KeyValueStores {
			seen[s] = struct{}{}
		}
	}
	stores := make([]string, 0, len(seen))
	for s := range seen {
		stores = append(stores, s)
	}
	sort.Strings(stores)
	return stores
}

// InjectManifest creates a temporary Spin manifest that includes the original
// spin.toml content plus an injected KV explorer component with access to all
// the given stores. The embedded Wasm binary is written to a dotfile next to
// spin.toml so that the Spin runtime can load it.
//
// Returns the path to the temp manifest (for use with spin up --from).
func InjectManifest(dir string, stores []string) (string, error) {
	original, err := os.ReadFile(filepath.Join(dir, "spin.toml"))
	if err != nil {
		return "", fmt.Errorf("reading spin.toml: %w", err)
	}

	// Write the embedded Wasm to disk so Spin can load it.
	wasmData, err := embeddedWasm.ReadFile("wasm/kv_explorer.wasm")
	if err != nil {
		return "", fmt.Errorf("reading embedded wasm: %w", err)
	}
	wasmPath := filepath.Join(dir, wasmFile)
	if err := os.WriteFile(wasmPath, wasmData, 0o644); err != nil {
		return "", fmt.Errorf("writing wasm file: %w", err)
	}

	quoted := make([]string, len(stores))
	for i, s := range stores {
		quoted[i] = fmt.Sprintf("%q", s)
	}

	injection := fmt.Sprintf(`

# ─── Injected by Spin Dashboard (KV Explorer) ────────────────────────────────
# This block is auto-generated and only present in the temporary manifest.
# The real spin.toml is not modified.

[component.dash-kv-explorer]
source = %q
key_value_stores = [%s]

[[trigger.http]]
route = "/internal/kv-explorer/..."
component = "dash-kv-explorer"
`, wasmFile, strings.Join(quoted, ", "))

	manifestPath := filepath.Join(dir, manifestFile)
	content := string(original) + injection
	if err := os.WriteFile(manifestPath, []byte(content), 0o644); err != nil {
		return "", fmt.Errorf("writing temp manifest: %w", err)
	}

	return manifestPath, nil
}

// ManifestPath returns the path to the temp manifest for the given project dir.
func ManifestPath(dir string) string {
	return filepath.Join(dir, manifestFile)
}

// CopyManifest writes a plain copy of spin.toml to the temp manifest path
// (no KV explorer injection). Used when no KV stores exist yet so that
// --from always has a valid target.
func CopyManifest(dir string) error {
	original, err := os.ReadFile(filepath.Join(dir, "spin.toml"))
	if err != nil {
		return fmt.Errorf("reading spin.toml: %w", err)
	}
	return os.WriteFile(filepath.Join(dir, manifestFile), original, 0o644)
}

// Cleanup removes the temporary manifest and wasm file.
func Cleanup(dir string) {
	os.Remove(filepath.Join(dir, manifestFile))
	os.Remove(filepath.Join(dir, wasmFile))
}
