# Spin Dashboard Plugin

> Experimental project developed with assistive AI coding tools. Subject to breaking changes.

A zero-config local developer dashboard for the [Spin](https://github.com/spinframework/spin) framework.

`spin dashboard` wraps `spin up` and opens a web UI for inspecting and (optionally) editing your Spin application — no separate tooling required.

## Features

- **Topology Graph** — interactive graph of components, triggers, KV/SQLite stores, and variables with clickable detail panes for each node
- **Live Log Streaming** — stdout/stderr from `spin up` streamed in real time with log-level highlighting
- **OpenTelemetry Traces** — built-in OTLP receiver visualising request waterfalls and span details
- **OTel Metrics** — time-series charts for all received metric series
- **Variable Inspector** — resolved runtime values (including secrets with reveal toggle) accessible by clicking a variable node in the graph
- **Edit mode** (`--allow-edits`) — add components, variables, and bindings directly from the UI; delete KV/SQLite bindings

## Installation

```bash
spin plugins install dashboard
```

Or install the latest canary build:

```bash
spin plugins install --url https://github.com/spinframework/dash/releases/download/canary/dashboard.json
```

## Usage

Run inside a directory containing a `spin.toml`:

```bash
spin dashboard
```

Pass additional flags to `spin up` after `--`:

```bash
spin dashboard -- --listen 127.0.0.1:3000
```

The dashboard opens automatically at [http://localhost:3001](http://localhost:3001).

### Flags

| Flag                | Default | Description                                                        |
| ------------------- | ------- | ------------------------------------------------------------------ |
| `--port`            | `3001`  | Port for the dashboard HTTP server                                 |
| `--no-open`         | `false` | Do not open the browser automatically                              |
| `--allow-edits`     | `false` | Enable UI controls to add/remove components, variables, bindings   |
| `--otel-port`       | `4318`  | Port for the built-in OTLP receiver                                |
| `--otel-forward-to` | —       | Forward OTLP data to an upstream collector (e.g. a shared backend) |

### Edit mode

By default the dashboard is read-only — `spin.toml` is never touched. Pass `--allow-edits` to unlock mutation controls:

```bash
spin dashboard --allow-edits
```

This enables:
- **Add Component** — runs `spin add` with template-driven parameters
- **Add Variable** — appends a new `[variables]` entry
- **Add Binding** — wires a KV store, SQLite database, or variable to a component
- **Delete bindings** — removes KV/SQLite entries from a component

## Building from Source

Requirements: Go 1.22+, Node.js 20+

```bash
# Build the UI and the Go binary
make build

# Install as a Spin plugin
make install
```

## Contributing

Contributions are welcome! Please open an issue or pull request on GitHub.

## License

Apache 2.0 — see [LICENSE](LICENSE).
