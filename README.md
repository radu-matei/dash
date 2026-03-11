# Spin Dashboard Plugin

> Note: this is an experimental and unstable project. It was developed using assistive AI coding tools (Opus 4.6), and is subject to changes.

A zero-config local developer dashboard for the [Spin](https://github.com/spinframework/spin) framework.

`spin dashboard` wraps `spin up` and opens a web UI that lets you inspect your local Spin application without dropping into the CLI.

## Features

- **Application Structure Overview** — inspect the structure of your application in the web UI
- **Live Log Streaming** — stdout/stderr from your Spin app streamed in real time
- **OpenTelemetry Traces** — built-in OTLP receiver visualizing request waterfalls and latency charts
- **Variable Inspector** — merged view of `spin.toml` variables

> Note: this project is not intending to replace [the `spin otel` plugin](https://github.com/spinframework/otel-plugin). Rather, this project provides a unified, no-dependency dashboard that is opinionated about the information it displays, as opposed to `spin otel`, whose goal is to use existing tools that fit into existing workflows.

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

| Flag        | Default | Description                           |
| ----------- | ------- | ------------------------------------- |
| `--port`    | `3001`  | Port for the dashboard HTTP server    |
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
    ├── OTLP receiver :4318  (accepts traces from spin up)
    │
    └── spin up (child process)
            OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

## Contributing

Contributions are welcome! Please open an issue or pull request on GitHub.

## License

Apache 2.0 — see [LICENSE](LICENSE).
