# Spin Dashboard Plugin

A zero-config local developer dashboard for the [Fermyon Spin](https://github.com/fermyon/spin) framework.

`spin dashboard` wraps `spin up` and opens a web UI that lets you inspect, manipulate, and observe your local Spin application without dropping into the CLI.

## Features

- **Live Log Streaming** — stdout/stderr from your Spin app streamed in real time with colorized output
- **SQLite Explorer** — browse tables, run queries, and inject test data into `.spin/sqlite_db.db`
- **KV Store Explorer** — CRUD operations on `.spin/sqlite_key_value.db`
- **OpenTelemetry Traces** — built-in OTLP receiver visualizing request waterfalls and latency charts
- **Variable Inspector** — merged view of `spin.toml` variables and `.env` values

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

| Flag | Default | Description |
|------|---------|-------------|
| `--port` | `3001` | Port for the dashboard HTTP server |
| `--no-open` | `false` | Do not open the browser automatically |

## Building from Source

Requirements: Go 1.22+, Node.js 20+

```bash
# Build the UI and the Go binary
make build

# Install as a Spin plugin
make install
```

## Architecture

```
spin dashboard
    │
    ├── HTTP server :3001  (dashboard UI + JSON API)
    │       ├── GET  /api/logs          SSE log stream
    │       ├── GET  /api/traces        OTel trace summaries
    │       ├── GET  /api/vars          merged variable map
    │       ├── GET  /api/sqlite/tables list tables
    │       ├── POST /api/sqlite/query  read SQL
    │       ├── POST /api/sqlite/exec   write SQL
    │       ├── GET  /api/kv            list KV entries
    │       ├── POST /api/kv            upsert KV entry
    │       └── DELETE /api/kv/:s/:k   delete KV entry
    │
    ├── OTLP receiver :4318  (accepts traces from spin up)
    │
    └── spin up (child process)
            OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

## Contributing

Contributions are welcome! Please open an issue or pull request on GitHub.

## License

Apache 2.0 — see [LICENSE](LICENSE).
