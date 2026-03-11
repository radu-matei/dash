package cmd

// CommitSHA is injected at build time via:
//
//	go build -ldflags "-X github.com/spinframework/dash/cmd.CommitSHA=$(git rev-parse --short HEAD)"
//
// It falls back to "dev" for local builds that don't pass the flag.
var CommitSHA = "dev"
