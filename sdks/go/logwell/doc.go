// Package logwell provides a Go SDK for the Logwell logging platform.
//
// Logwell is a self-hosted logging platform with real-time log streaming,
// full-text search, and per-project API key authentication.
//
// # Quick Start
//
// Create a client and start logging:
//
//	client, err := logwell.New(
//		"https://your-logwell-instance.com",
//		"lw_your-api-key",
//	)
//	if err != nil {
//		log.Fatal(err)
//	}
//	defer client.Shutdown(context.Background())
//
//	client.Info("Application started")
//	client.Error("Something went wrong", logwell.M{"error": "details"})
//
// # Features
//
// The SDK provides:
//   - Five log levels: Debug, Info, Warn, Error, Fatal
//   - Automatic batching with configurable batch size and flush interval
//   - Retry with exponential backoff for transient failures
//   - Child loggers for scoped logging with inherited metadata
//   - Source location capture (file and line number)
//   - Queue overflow protection with configurable limits
//   - Graceful shutdown with context support
//
// # Configuration
//
// Use functional options to customize the client:
//
//	client, err := logwell.New(
//		endpoint,
//		apiKey,
//		logwell.WithBatchSize(100),
//		logwell.WithFlushInterval(5*time.Second),
//		logwell.WithMaxRetries(3),
//		logwell.WithMetadata(logwell.M{"service": "my-app"}),
//	)
package logwell
