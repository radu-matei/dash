// Package kvexplorer handles injecting the pre-built spin-kv-explorer
// component into a temporary Spin manifest so the dashboard can browse KV
// stores without modifying the user's spin.toml.
package kvexplorer

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/spinframework/dash/internal/config"
)

const (
	wasmURL    = "https://github.com/fermyon/spin-kv-explorer/releases/download/v0.10.0/spin-kv-explorer.wasm"
	wasmDigest = "sha256:65bc286f8315746d1beecd2430e178f539fa487ebf6520099daae09a35dbce1d"

	manifestFile = ".dash_manifest.toml"

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
// the given stores. The manifest is written to the project root as a dotfile
// so that all relative paths in the original manifest still resolve correctly.
//
// Spin fetches the Wasm binary from the remote URL on its own — no local
// download is needed.
//
// Returns the path to the temp manifest (for use with spin up --from).
func InjectManifest(dir string, stores []string) (string, error) {
	original, err := os.ReadFile(filepath.Join(dir, "spin.toml"))
	if err != nil {
		return "", fmt.Errorf("reading spin.toml: %w", err)
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
source = { url = %q, digest = %q }
key_value_stores = [%s]
environment = { SPIN_APP_KV_SKIP_AUTH = "1" }

[[trigger.http]]
route = "/internal/kv-explorer/..."
component = "dash-kv-explorer"
`, wasmURL, wasmDigest, strings.Join(quoted, ", "))

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

// Cleanup removes the temporary manifest.
func Cleanup(dir string) {
	os.Remove(filepath.Join(dir, manifestFile))
}
