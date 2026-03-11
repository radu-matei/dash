.PHONY: ui build install clean test vet lint dev

BINARY  := dashboard
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
LDFLAGS := -ldflags "-s -w -X main.version=$(VERSION)"

# Build the React UI and copy the compiled assets into the Go embed path.
ui:
	cd ui && npm install && npm run build

# Compile the Go binary (requires ui to have been built at least once).
build:
	go build $(LDFLAGS) -o $(BINARY) .

# Build everything from scratch and install as a Spin plugin.
install: ui build
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
