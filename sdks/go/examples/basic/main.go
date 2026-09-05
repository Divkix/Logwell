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
	endpoint := os.Getenv("LOGWELL_ENDPOINT")
	if endpoint == "" {
		endpoint = "http://localhost:3000"
	}

	apiKey := os.Getenv("LOGWELL_API_KEY")
	if apiKey == "" {
		apiKey = "lw_00000000000000000000000000000000"
	}

	client, err := logwell.New(
		endpoint,
		apiKey,
		logwell.WithService("basic-example"),
		logwell.WithBatchSize(50),
	)
	if err != nil {
		log.Fatalf("Failed to create Logwell client: %v", err)
	}
	defer func() {
		if err := client.Shutdown(context.Background()); err != nil {
			log.Printf("logwell shutdown failed: %v", err)
		}
	}()

	fmt.Println("Logwell Go SDK - Basic Example")
	fmt.Printf("Endpoint: %s\n", endpoint)
	fmt.Println()

	client.Info("Application started")
	client.Info("User logged in", logwell.M{"userId": "user-123", "email": "user@example.com"})
	client.Info("Processing request", logwell.M{
		"requestId": "req-456",
		"method":    "POST",
		"path":      "/api/orders",
	})

	fmt.Println("Logged 3 info messages")

	for i := 0; i < 48; i++ {
		client.Info("Processing item", logwell.M{
			"itemId":   fmt.Sprintf("item-%d", i),
			"progress": fmt.Sprintf("%d%%", (i+1)*2),
		})
	}

	fmt.Println("Logged 48 more messages (total: 51, should trigger auto-flush)")

	time.Sleep(100 * time.Millisecond)

	fmt.Println()
	fmt.Println("Example completed. Check your Logwell server for the logs!")
	fmt.Println("If running locally, start the server with: bun run dev")
}
