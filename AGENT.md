# Project Name: Spin Local Dashboard Plugin

## 1. Project Overview
This project is a dedicated local developer dashboard for the Fermyon Spin framework. It provides a web-based UI for developers to inspect, manipulate, and observe their local Spin applications without dropping into the CLI. 

**CRITICAL CONSTRAINT:** This must be built as a standalone **Spin Plugin**. It requires ZERO changes to the upstream Spin binary or the user's application code. It operates as a "Zero-Config Sidecar".

Follow the same structure as https://github.com/spinframework/otel-plugin for a Go-based plugin for Spin.

## 2. Architecture Diagram


## 3. Tech Stack
* **Backend:** Go (Golang). Compiles to a single binary for cross-platform plugin distribution.
* **Frontend:** React (Vite) OR HTMX + Alpine.js + TailwindCSS. The compiled frontend assets MUST be embedded directly into the Go binary using the `embed` package (`//go:embed`).
* **Database Driver:** `github.com/mattn/go-sqlite3` (for reading Spin's local state).
* **Process Management:** Go's standard `os/exec` package.

## 4. System Architecture & Operation
The Go binary acts as a wrapper around the local developer environment. When the user executes `spin dashboard`, the program must:
1.  Parse the `spin.toml` in the current working directory to understand the app structure.
2.  Start a local HTTP server (e.g., port `3001`) serving the embedded dashboard UI and a JSON API for the frontend.
3.  Inject OpenTelemetry environment variables (e.g., `OTEL_EXPORTER_OTLP_ENDPOINT`) pointing to an OTel receiver running inside the Go backend.
4.  Spawn `spin up` as a child process (passing through any additional CLI flags).
5.  Capture `stdout` and `stderr` of the child process and stream it to the frontend via WebSockets or Server-Sent Events (SSE).
6.  Gracefully terminate the `spin up` child process when the dashboard process receives a SIGINT/SIGTERM.

## 5. Core Feature Modules

### Module A: File-Based State Explorers (Zero Config)
Spin stores local state in standard SQLite files located in the `.spin/` directory. The Go backend must interface with these files directly.
* **SQLite Explorer:** Connect to `.spin/sqlite_db.db`. Provide API endpoints to list tables, execute raw SQL queries, and inject dummy data.
* **KV Explorer:** Connect to `.spin/sqlite_key_value.db`. Provide CRUD endpoints (Create, Read, Update, Delete) for keys and values.

### Module B: Log Interception & Streaming
* Capture the stdout/stderr of the `spin up` child process.
* Provide an SSE or WebSocket endpoint to stream these logs to the UI.
* The UI should format and distinctively colorize standard app output vs. system/Spin output.

### Module C: OpenTelemetry (OTel) Receiver
* Implement a lightweight OTel trace receiver in Go.
* Listen for trace data from the `spin up` process.
* Parse traces to extract metrics: Cold start times, execution duration per component, and HTTP request paths/statuses.
* Expose this data to the frontend for visualizing a "Request Waterfall" and performance charts.

### Module D: Trigger & Variable Inspector
* **Variables:** Parse `spin.toml` and `.env`. Provide an endpoint merging these to show the active variable state.
* **Trigger Simulation:** Provide API endpoints to simulate triggers. For HTTP, act as a local proxy/client. For Redis/MQTT triggers defined in `spin.toml`, provide a backend mechanism to publish test JSON payloads to the local broker.

## 6. AI Agent Coding Directives (Rules for the LLM)
1.  **Zero-Config Rule:** Never write code that requires the user to modify their `spin.toml` or install an SDK to use this dashboard. Everything must be inferred or intercepted.
2.  **Idempotency:** The plugin must not permanently alter the `.spin/` directory structure. Only read and write data to the specific SQLite files as requested by the user via the UI.
3.  **Concurrency:** Ensure thread-safe access to the SQLite files. The `spin up` process and the Go dashboard backend will be accessing `.spin/sqlite_db.db` simultaneously. Use appropriate PRAGMA statements (e.g., WAL mode) if necessary to prevent locking issues.
4.  **Error Handling:** If `spin up` fails to start, capture the error output, display it cleanly in the UI, and do not crash the dashboard server.
5.  **Clean Exit:** Ensure the child process (`spin up`) is ALWAYS killed when the Go parent process terminates to avoid orphaned processes binding to ports. Use process groups if necessary.
