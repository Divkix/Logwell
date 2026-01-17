// Package main demonstrates basic usage of the Logwell Go SDK.
//
// This example shows how to create a client and send logs to a Logwell server.
// Replace the endpoint and API key with your actual values.
//
// Usage:
//
//	cd sdks/go && go run ./examples/basic/
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/Divkix/Logwell/sdks/go/logwell"
)

func main() {
	// Get endpoint and API key from environment, with fallback for demo
	endpoint := os.Getenv("LOGWELL_ENDPOINT")
	if endpoint == "" {
		endpoint = "http://localhost:3000"
	}

	apiKey := os.Getenv("LOGWELL_API_KEY")
	if apiKey == "" {
		// Demo key that matches the validation regex (lw_ + 32 chars)
		apiKey = "lw_demo1234567890abcdefghijklmnopqr"
	}

	// Create a new Logwell client with options
	client, err := logwell.New(
		endpoint,
		apiKey,
		logwell.WithService("basic-example"),
		logwell.WithBatchSize(10),
	)
	if err != nil {
		log.Fatalf("Failed to create Logwell client: %v", err)
	}

	fmt.Println("Logwell Go SDK - Basic Example")
	fmt.Printf("Endpoint: %s\n", endpoint)
	fmt.Println()

	// Log some messages
	client.Info("Application started")
	client.Info("User logged in", logwell.M{"userId": "user-123", "email": "user@example.com"})
	client.Info("Processing request", logwell.M{
		"requestId": "req-456",
		"method":    "POST",
		"path":      "/api/orders",
	})

	// Simulate some application activity
	fmt.Println("Logged 3 info messages")

	// Add more logs to trigger auto-flush (default batch size is 10)
	for i := 0; i < 8; i++ {
		client.Info("Processing item", logwell.M{
			"itemId":   fmt.Sprintf("item-%d", i),
			"progress": fmt.Sprintf("%d%%", (i+1)*10),
		})
	}

	fmt.Println("Logged 8 more messages (total: 11, should trigger auto-flush)")

	// Give some time for the flush to complete
	time.Sleep(100 * time.Millisecond)

	// Flush any remaining logs before exit
	// Note: In POC, Flush is not yet implemented on Client, but will be in Phase 2
	// For now, just give time for any background operations
	_ = context.Background()

	fmt.Println()
	fmt.Println("Example completed. Check your Logwell server for the logs!")
	fmt.Println("If running locally, start the server with: bun run dev")
}
