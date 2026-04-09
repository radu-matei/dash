.PHONY: ui wasm build install clean test vet lint dev

BINARY  := dashboard
SHA     := $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)
LDFLAGS := -ldflags "-s -w -X github.com/spinframework/dash/cmd.CommitSHA=$(SHA)-dev"

# Build the React UI and copy the compiled assets into the Go embed path.
ui:
	cd ui && npm install && npm run build

# Build the KV explorer Wasm component and copy into the Go embed path.
wasm:
	cd kv-explorer && cargo build --target wasm32-wasip2 --release
	cp kv-explorer/target/wasm32-wasip2/release/kv_explorer.wasm internal/kvexplorer/wasm/kv_explorer.wasm

# Compile the Go binary (requires ui and wasm to have been built at least once).
build:
	go build $(LDFLAGS) -o $(BINARY) .

# Build everything from scratch and install as a Spin plugin.
install: ui wasm build
	spin pluginify --install

# Build for the current platform without rebuilding the UI
# (useful during Go-only development iterations).
build-go:
	go build $(LDFLAGS) -o $(BINARY) .

# Start the Vite dev server proxied to a running dashboard backend.
# Run 'make build-go && ./dashboard' in another terminal first.
dev:
	cd ui && npm run dev

# Run Go tests.
test:
	go test ./...

# Run go vet.
vet:
	go vet ./...

# Run golangci-lint (install separately: https://golangci-lint.run).
lint:
	golangci-lint run ./...

# Remove build artifacts.
clean:
	rm -f $(BINARY) *.tar.gz dashboard.json
	rm -rf internal/server/ui/dist
