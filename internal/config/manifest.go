// Package config provides types for the Spin application manifest (spin.toml).
//
// This file is the canonical Go representation of the Spin v2 manifest format.
// It mirrors the full specification at https://spinframework.dev/v3/manifest-reference
// and is the authoritative reference for every field the runtime accepts.
//
// The types here implement toml.Unmarshaler where a field can hold more than one
// TOML type (e.g. a trigger route that is either a string or the table
// { private = true }). Use DecodeManifest to parse a spin.toml into a Manifest.
package config

import (
	"fmt"

	"github.com/BurntSushi/toml"
)

// ─── Top level ────────────────────────────────────────────────────────────────

// Manifest is the complete spin.toml document (format version 2).
//
// Example minimal manifest:
//
//	spin_manifest_version = 2
//	[application]
//	name = "hello"
//	[[trigger.http]]
//	route = "/..."
//	component = "hello"
//	[component.hello]
//	source = "hello.wasm"
type Manifest struct {
	// SpinManifestVersion must be 2 for all manifests described here.
	SpinManifestVersion int `toml:"spin_manifest_version"`

	// Application contains metadata about the application and application-wide
	// trigger settings.
	Application ApplicationSection `toml:"application"`

	// Variables declares the application-level configuration variables that
	// operators can supply at runtime (via --variable, SPIN_VARIABLE_*, .env,
	// or Fermyon Cloud secrets).
	Variables map[string]VariableSpec `toml:"variables"`

	// Trigger maps trigger types to their arrays of trigger entries.
	// In TOML this is written as e.g. [[trigger.http]], [[trigger.redis]].
	Trigger TriggerSet `toml:"trigger"`

	// Component is keyed by component ID (kebab-case).  Each value is the
	// full specification of one WebAssembly component.
	Component map[string]ComponentSpec `toml:"component"`
}

// DecodeManifest parses path (a spin.toml file) into a Manifest.
func DecodeManifest(path string) (*Manifest, error) {
	var m Manifest
	if _, err := toml.DecodeFile(path, &m); err != nil {
		return nil, fmt.Errorf("decoding %s: %w", path, err)
	}
	return &m, nil
}

// ─── Application section ──────────────────────────────────────────────────────

// ApplicationSection is the [application] table.
type ApplicationSection struct {
	// Name is the application identifier. Required. Alphanumeric, hyphens,
	// underscores.
	Name string `toml:"name"`

	// Version is an optional semver string (major.minor.patch).
	Version string `toml:"version"`

	// Description is a free-text human-readable description.
	Description string `toml:"description"`

	// Authors is a list of author strings, conventionally "Name <email>".
	Authors []string `toml:"authors"`

	// Targets lists the deployment environments this application is designed
	// for, e.g. ["spin-up:3.2"].
	Targets []string `toml:"targets"`

	// Trigger holds application-wide trigger defaults (currently only Redis
	// has an app-wide setting: the default broker address).
	Trigger ApplicationTrigger `toml:"trigger"`
}

// ApplicationTrigger is the [application.trigger] table.
type ApplicationTrigger struct {
	// Redis contains the default Redis broker address for all redis triggers
	// that do not supply their own address.
	Redis *ApplicationRedisConfig `toml:"redis"`
}

// ApplicationRedisConfig is [application.trigger.redis].
type ApplicationRedisConfig struct {
	// Address is the Redis URL, e.g. "redis://localhost:6379".
	// Supports manifest variable expressions: "redis://{{ redis_host }}:6379"
	Address string `toml:"address"`
}

// ─── Variables ────────────────────────────────────────────────────────────────

// VariableSpec is one entry in the [variables] table.
//
// Example:
//
//	[variables]
//	api_key   = { required = true, secret = true }
//	log_level = { default = "info" }
//	db_url    = { description = "PostgreSQL DSN", default = "postgres://localhost/mydb" }
type VariableSpec struct {
	// Description is an optional human-readable explanation of the variable.
	Description string `toml:"description"`

	// Default is the value used when no runtime value is supplied.
	// If omitted, Required must be true.
	Default string `toml:"default"`

	// Required, when true, means the operator must supply a value at runtime.
	// Mutually exclusive with Default.
	Required bool `toml:"required"`

	// Secret, when true, marks the variable as sensitive. Spin will redact it
	// from logs and the dashboard will mask the value by default.
	Secret bool `toml:"secret"`
}

// ─── Trigger set ─────────────────────────────────────────────────────────────

// TriggerSet groups all trigger arrays.  Each field corresponds to one trigger
// type; TOML arrays-of-tables are written as [[trigger.http]], etc.
type TriggerSet struct {
	HTTP  []HTTPTriggerSpec  `toml:"http"`
	Redis []RedisTriggerSpec `toml:"redis"`
	Cron  []CronTriggerSpec  `toml:"cron"`
}

// ─── HTTP trigger ─────────────────────────────────────────────────────────────

// HTTPTriggerSpec is one [[trigger.http]] entry.
//
// A trigger maps an HTTP route (or a private-endpoint marker) to a component.
//
// Example (public route):
//
//	[[trigger.http]]
//	route     = "/api/..."
//	component = "api-handler"
//
// Example (private endpoint, internal service chaining only):
//
//	[[trigger.http]]
//	route     = { private = true }
//	component = "internal-svc"
//
// Example (static response, no component):
//
//	[[trigger.http]]
//	route           = "/health"
//	static_response = { status_code = 200, body = "ok" }
type HTTPTriggerSpec struct {
	// Route is either a path string ("/foo/...") or the private-endpoint
	// table { private = true }.  See HTTPRoute.
	Route HTTPRoute `toml:"route"`

	// Component is either the string ID of a [component.*] entry or an
	// inline component table (for simple single-file components).
	// Mutually exclusive with StaticResponse.
	Component TriggerComponent `toml:"component"`

	// Executor controls how Spin invokes the component.  Defaults to
	// { type = "spin" }.  Set { type = "wagi" } for WASI Preview 1 modules
	// that implement the CGI interface instead of the component model.
	Executor *HTTPExecutor `toml:"executor"`

	// StaticResponse returns a fixed HTTP response without invoking any
	// component.  Mutually exclusive with Component.
	StaticResponse *StaticResponse `toml:"static_response"`
}

// HTTPRoute represents the `route` field of [[trigger.http]], which is either:
//   - a plain string:        route = "/api/..."
//   - a private-endpoint:   route = { private = true }
type HTTPRoute struct {
	// Path is the URL pattern (empty when Private is true).
	Path string
	// Private marks this as an internal-only endpoint, reachable only via
	// local service chaining (spin_sdk::http::send to a spin:// URL).
	Private bool
}

// UnmarshalTOML implements toml.Unmarshaler so HTTPRoute handles both the
// plain-string and table forms of the route field.
func (r *HTTPRoute) UnmarshalTOML(data interface{}) error {
	switch v := data.(type) {
	case string:
		r.Path = v
	case map[string]interface{}:
		if p, _ := v["private"].(bool); p {
			r.Private = true
		}
	default:
		return fmt.Errorf("unexpected type %T for route", data)
	}
	return nil
}

// HTTPExecutor is the optional `executor` table inside [[trigger.http]].
type HTTPExecutor struct {
	// Type is "spin" (default) or "wagi".
	Type string `toml:"type"`

	// Wagi-only: the argv string passed to the module's main.
	// $SCRIPT_NAME and $ARGS are substituted.  Default: "$SCRIPT_NAME $ARGS".
	Argv string `toml:"argv"`

	// Wagi-only: the name of the wasm export to call.  Default: "_start".
	Entrypoint string `toml:"entrypoint"`
}

// StaticResponse is the `static_response` table on [[trigger.http]].
// When present, Spin returns this fixed response without invoking any component.
//
//	[[trigger.http]]
//	route = "/..."
//	static_response = { status_code = 404, body = "not found" }
type StaticResponse struct {
	// StatusCode is the HTTP status code.  Defaults to 200.
	StatusCode int `toml:"status_code"`

	// Headers is a map of response header names to values.
	Headers map[string]string `toml:"headers"`

	// Body is the response body text.  Only plain text is supported.
	Body string `toml:"body"`
}

// ─── Redis trigger ────────────────────────────────────────────────────────────

// RedisTriggerSpec is one [[trigger.redis]] entry.
//
// Example:
//
//	[[trigger.redis]]
//	address   = "redis://{{ redis_address }}"
//	channel   = "orders"
//	component = "order-processor"
type RedisTriggerSpec struct {
	// Address is the Redis URL for this trigger.  If omitted, falls back to
	// application.trigger.redis.address.
	// Supports manifest variable expressions.
	Address string `toml:"address"`

	// Channel is the Redis pub/sub channel to subscribe to.
	// Supports manifest variable expressions.
	Channel string `toml:"channel"`

	// Component is the ID of the handler component.
	Component TriggerComponent `toml:"component"`
}

// ─── Cron trigger ─────────────────────────────────────────────────────────────

// CronTriggerSpec is one [[trigger.cron]] entry.
//
// Example:
//
//	[[trigger.cron]]
//	cron      = "0 * * * *"   # every hour
//	component = "housekeeping"
type CronTriggerSpec struct {
	// Cron is a standard 5-field cron expression.
	Cron string `toml:"cron"`

	// Component is the ID of the handler component.
	Component TriggerComponent `toml:"component"`
}

// ─── Trigger component reference ─────────────────────────────────────────────

// TriggerComponent is the `component` field on a trigger entry.
// It is either the string ID of a named component or an inline component table.
//
// Most manifests use the string form:
//
//	component = "my-handler"
//
// A simple component can be written inline to avoid a separate [component.*]:
//
//	component = { source = "handler.wasm" }
type TriggerComponent struct {
	// ID is the name of a [component.<id>] entry (non-empty when not inline).
	ID string
	// Inline is set when the component is specified as an anonymous table
	// directly on the trigger (rare).
	Inline *ComponentSpec
}

// UnmarshalTOML implements toml.Unmarshaler for string-or-table component refs.
func (tc *TriggerComponent) UnmarshalTOML(data interface{}) error {
	switch v := data.(type) {
	case string:
		tc.ID = v
	case map[string]interface{}:
		// Inline component — best-effort decode.
		tc.Inline = &ComponentSpec{}
		if src, ok := v["source"].(string); ok {
			tc.Inline.Source.LocalPath = src
		}
	default:
		return fmt.Errorf("unexpected type %T for component", data)
	}
	return nil
}

// ─── Component specification ──────────────────────────────────────────────────

// ComponentSpec is one [component.<id>] table.
//
// Example:
//
//	[component.api]
//	source               = "target/wasm32-wasip1/release/api.wasm"
//	description          = "REST API handler"
//	allowed_outbound_hosts = ["https://db.example.com"]
//	key_value_stores     = ["default"]
//	sqlite_databases     = ["default"]
//	ai_models            = ["llama2-chat"]
//	files                = [{ source = "assets/", destination = "/" }]
//	environment          = { LOG_LEVEL = "info" }
//
//	[component.api.variables]
//	api_key = "{{ api_key }}"
//	db_url  = "postgres://{{ db_user }}:{{ db_pass }}@{{ db_host }}/mydb"
//
//	[component.api.build]
//	command = "cargo build --target wasm32-wasip1 --release"
//	workdir = "."
//	watch   = ["src/**/*.rs", "Cargo.toml"]
type ComponentSpec struct {
	// Description is a human-readable description of the component.
	Description string `toml:"description"`

	// Source is the Wasm binary, which may be:
	//   - a local path string:            source = "handler.wasm"
	//   - a remote URL table:             source = { url = "https://...", digest = "sha256:..." }
	//   - a registry reference (experimental): source = { registry = "...", package = "...", version = "..." }
	Source ComponentSource `toml:"source"`

	// AllowedOutboundHosts is the list of network addresses this component may
	// connect to.  Format: scheme://host:port.  Wildcards allowed.
	// Applies to outbound HTTP, Redis, MySQL, PostgreSQL.
	// Does NOT apply to key-value or SQLite (those use key_value_stores /
	// sqlite_databases instead).
	//
	// Examples: "https://api.example.com", "*://example.com:8080",
	//           "http://127.0.0.1:*", "redis://cache.internal:6379"
	AllowedOutboundHosts []string `toml:"allowed_outbound_hosts"`

	// AllowedHTTPHosts is the v1 predecessor of AllowedOutboundHosts.
	// Retained for backward compatibility; prefer AllowedOutboundHosts.
	AllowedHTTPHosts []string `toml:"allowed_http_hosts"`

	// KeyValueStores lists the key-value store labels this component may read
	// and write.  The label "default" refers to the Spin-provided default store.
	KeyValueStores []string `toml:"key_value_stores"`

	// SQLiteDatabases lists the SQLite database labels this component may use.
	// The label "default" refers to the Spin-provided ephemeral SQLite DB.
	SQLiteDatabases []string `toml:"sqlite_databases"`

	// AIModels lists the serverless AI model labels this component may invoke.
	// Examples: "llama2-chat", "codellama-instruct", "all-minilm-l6-v2".
	AIModels []string `toml:"ai_models"`

	// Files lists the host files or directories to expose inside the Wasm
	// sandbox.  Each entry is either a glob string or a source→destination
	// mount table.
	Files []FileMount `toml:"files"`

	// ExcludeFiles lists glob patterns that should be excluded from Files,
	// even if they match a Files entry.
	ExcludeFiles []string `toml:"exclude_files"`

	// Environment is a map of environment variables injected into the Wasm
	// module's WASI environment at startup.
	Environment map[string]string `toml:"environment"`

	// Variables maps variable-binding names to value expressions.
	// Values may use {{ var_name }} template notation to reference application
	// variables, or be plain strings.
	// This is what appears as [component.<id>.variables] in TOML.
	Variables map[string]string `toml:"variables"`

	// Build specifies how `spin build` should compile this component.
	Build *BuildConfig `toml:"build"`

	// Targets overrides the application-level targets for this component.
	Targets []string `toml:"targets"`

	// DependenciesInheritConfiguration controls whether Wasm Component Model
	// dependencies can invoke Spin APIs with the same permissions as this
	// component.  Defaults to false (dependencies have no permissions).
	DependenciesInheritConfiguration bool `toml:"dependencies_inherit_configuration"`

	// Dependencies specifies how to satisfy Wasm Component Model imports.
	// Keys are WIT interface names; values describe where to source them.
	Dependencies map[string]ComponentDependency `toml:"dependencies"`
}

// ─── Component source ─────────────────────────────────────────────────────────

// ComponentSource is the `source` field of a component, which may be:
//   - a local file path (string)
//   - a remote HTTP URL + digest (table)
//   - a registry package reference (table, experimental)
type ComponentSource struct {
	// LocalPath is set when source is a plain string, e.g. "handler.wasm".
	LocalPath string

	// URL + Digest are set when source is { url = "...", digest = "sha256:..." }.
	URL    string
	Digest string

	// Registry + Package + Version are set for registry sources (experimental):
	// { registry = "...", package = "...", version = "..." }
	Registry string
	Package  string
	Version  string
}

// UnmarshalTOML implements toml.Unmarshaler for string-or-table component sources.
func (cs *ComponentSource) UnmarshalTOML(data interface{}) error {
	switch v := data.(type) {
	case string:
		cs.LocalPath = v
	case map[string]interface{}:
		if url, ok := v["url"].(string); ok {
			cs.URL = url
		}
		if digest, ok := v["digest"].(string); ok {
			cs.Digest = digest
		}
		if reg, ok := v["registry"].(string); ok {
			cs.Registry = reg
		}
		if pkg, ok := v["package"].(string); ok {
			cs.Package = pkg
		}
		if ver, ok := v["version"].(string); ok {
			cs.Version = ver
		}
	default:
		return fmt.Errorf("unexpected type %T for source", data)
	}
	return nil
}

// IsLocal reports whether the source is a local file path.
func (cs ComponentSource) IsLocal() bool { return cs.LocalPath != "" }

// IsRemote reports whether the source is a remote HTTP URL.
func (cs ComponentSource) IsRemote() bool { return cs.URL != "" }

// IsRegistry reports whether the source is a registry package reference.
func (cs ComponentSource) IsRegistry() bool { return cs.Registry != "" }

// String returns the source in a short human-readable form.
func (cs ComponentSource) String() string {
	switch {
	case cs.LocalPath != "":
		return cs.LocalPath
	case cs.URL != "":
		return cs.URL
	case cs.Registry != "":
		return fmt.Sprintf("%s/%s@%s", cs.Registry, cs.Package, cs.Version)
	}
	return "(unknown source)"
}

// ─── File mount ───────────────────────────────────────────────────────────────

// FileMount is one entry in the component `files` array.  It may be:
//   - a plain string glob:  "images/*.jpg"
//   - a source→destination mount: { source = "assets/", destination = "/" }
type FileMount struct {
	// Glob is set for plain string entries; the matching files are exposed at
	// the same relative paths inside the component sandbox.
	Glob string `toml:"-" json:"glob,omitempty"`

	// Source is the host-side path (file or directory) for table-form mounts.
	Source string `toml:"source" json:"source,omitempty"`
	// Destination is the absolute path inside the Wasm sandbox.
	Destination string `toml:"destination" json:"destination,omitempty"`
}

// UnmarshalTOML implements toml.Unmarshaler for string-or-table file mounts.
func (fm *FileMount) UnmarshalTOML(data interface{}) error {
	switch v := data.(type) {
	case string:
		fm.Glob = v
	case map[string]interface{}:
		if src, ok := v["source"].(string); ok {
			fm.Source = src
		}
		if dst, ok := v["destination"].(string); ok {
			fm.Destination = dst
		}
	default:
		return fmt.Errorf("unexpected type %T for files entry", data)
	}
	return nil
}

// ─── Build configuration ──────────────────────────────────────────────────────

// BuildConfig is [component.<id>.build].
//
// Example:
//
//	[component.api.build]
//	command = "cargo build --target wasm32-wasip1 --release"
//	workdir = "api/"
//	watch   = ["src/**/*.rs", "Cargo.toml"]
type BuildConfig struct {
	// Command is the shell command that `spin build` executes to produce the
	// Wasm binary.  Required.
	Command string `toml:"command" json:"command,omitempty"`

	// Workdir is the directory (relative to the manifest) in which Command
	// runs.  Defaults to the directory containing spin.toml.
	Workdir string `toml:"workdir" json:"workdir,omitempty"`

	// Watch is a list of file globs (relative to Workdir) that `spin watch`
	// monitors to decide whether a rebuild is needed.
	Watch []string `toml:"watch" json:"watch,omitempty"`
}

// ─── Component dependencies ───────────────────────────────────────────────────

// ComponentDependency specifies how to satisfy one Wasm Component Model import
// for a component.  The map key in ComponentSpec.Dependencies is a WIT
// interface name such as "example:calculator/adder".
//
// Example:
//
//	[component.cart.dependencies]
//	"example:calculator/adder" = { registry = "example.com", package = "example:adding-calculator", version = "1.0.0" }
type ComponentDependency struct {
	// Registry is the OCI registry host.
	Registry string `toml:"registry"`
	// Package is the fully-qualified package name.
	Package string `toml:"package"`
	// Version is the SemVer version constraint.
	Version string `toml:"version"`
}
