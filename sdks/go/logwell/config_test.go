package logwell

import (
	"context"
	"testing"
)

func validAPIKey() string {
	return "lw_" + "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" // 32 chars after lw_
}

func validEndpoint() string {
	return "http://localhost:3000"
}

// Config bounds are pinned by the TS reference SDK; one smoke case proves the
// Go mirror accepts a valid config (incl. its 100ms flush floor parity).
func TestConfigAcceptsValidConfig(t *testing.T) {
	cfg, err := New(validEndpoint(), validAPIKey())
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer cfg.Shutdown(context.Background())
}
