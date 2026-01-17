<p align="center">
  <img src="https://raw.githubusercontent.com/Divkix/Logwell/main/static/banner.png" alt="Logwell" width="600" />
</p>

<p align="center">
  <a href="https://pkg.go.dev/github.com/Divkix/Logwell/sdks/go/logwell"><img src="https://pkg.go.dev/badge/github.com/Divkix/Logwell/sdks/go/logwell.svg" alt="Go Reference" /></a>
  <a href="https://github.com/Divkix/Logwell/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Divkix/Logwell" alt="license" /></a>
  <img src="https://img.shields.io/badge/Go-1.21+-00ADD8?logo=go" alt="Go version" />
</p>

# Logwell Go SDK

Official Go SDK for [Logwell](https://github.com/Divkix/Logwell) - a self-hosted logging platform with real-time streaming and full-text search.

## Features

- **Zero external dependencies** - Uses only Go standard library
- **Automatic batching** - Configurable batch size and flush intervals
- **Retry with exponential backoff** - Automatic retry on transient failures
- **Child loggers** - Request-scoped context propagation
- **Source location capture** - Opt-in file/line number tracking
- **Thread-safe** - Safe for concurrent use from multiple goroutines
- **Context support** - Flush and Shutdown respect context cancellation

## Installation

```bash
go get github.com/Divkix/Logwell/sdks/go
```

## Quick Start

```go
package main

import (
    "context"
    "log"

    "github.com/Divkix/Logwell/sdks/go/logwell"
)

func main() {
    // Create a new client
    client, err := logwell.New(
        "https://logs.example.com",
        "lw_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        logwell.WithService("my-app"),
    )
    if err != nil {
        log.Fatal(err)
    }

    // Log at different levels
    client.Debug("Debug message")
    client.Info("User logged in", logwell.M{"userId": "123"})
    client.Warn("Deprecated API called")
    client.Error("Database connection failed", logwell.M{"host": "db.local"})
    client.Fatal("Unrecoverable error")

    // Flush before shutdown
    if err := client.Shutdown(context.Background()); err != nil {
        log.Printf("Shutdown error: %v", err)
    }
}
```

## Configuration Options

Configure the client using functional options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `WithService(s)` | `string` | `""` | Service name attached to all logs |
| `WithMetadata(m)` | `map[string]any` | `nil` | Default metadata for all logs |
| `WithBatchSize(n)` | `int` | `10` | Logs per batch (1-500) |
| `WithFlushInterval(d)` | `time.Duration` | `5s` | Auto-flush interval (100ms-60s) |
| `WithMaxQueueSize(n)` | `int` | `1000` | Max queue size before dropping oldest (1-10000) |
| `WithMaxRetries(n)` | `int` | `3` | Retry attempts for failed requests (0-10) |
| `WithCaptureSourceLocation(b)` | `bool` | `false` | Capture file/line info |
| `WithHTTPClient(c)` | `*http.Client` | `http.DefaultClient` | Custom HTTP client |
| `WithOnError(fn)` | `func(*Error)` | `nil` | Error callback |
| `WithOnFlush(fn)` | `func(int)` | `nil` | Flush callback (receives count) |

### Example with all options

```go
client, err := logwell.New(
    "https://logs.example.com",
    "lw_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    logwell.WithService("my-app"),
    logwell.WithMetadata(logwell.M{"env": "production"}),
    logwell.WithBatchSize(50),
    logwell.WithFlushInterval(10*time.Second),
    logwell.WithMaxQueueSize(5000),
    logwell.WithMaxRetries(5),
    logwell.WithCaptureSourceLocation(true),
    logwell.WithOnError(func(err *logwell.Error) {
        log.Printf("Logwell error: %v", err)
    }),
    logwell.WithOnFlush(func(count int) {
        log.Printf("Flushed %d logs", count)
    }),
)
```

## Log Levels

Five severity levels matching industry standards:

```go
client.Debug("Detailed debugging info")
client.Info("Normal operational message")
client.Warn("Warning - something unusual")
client.Error("Error - operation failed")
client.Fatal("Fatal - unrecoverable error")
```

All methods accept optional metadata maps:

```go
client.Info("User action", logwell.M{
    "userId":    "123",
    "action":    "login",
    "ipAddress": "192.168.1.1",
})
```

## Metadata

Use `logwell.M` (shorthand for `map[string]any`) for structured metadata:

```go
// Single metadata map
client.Info("Request processed", logwell.M{
    "requestId":  "abc-123",
    "duration":   150,
    "statusCode": 200,
})

// Multiple metadata maps (later maps override earlier)
client.Info("Event", logwell.M{"a": 1}, logwell.M{"b": 2})
```

### Default Metadata

Set metadata that applies to all logs:

```go
client, _ := logwell.New(
    endpoint, apiKey,
    logwell.WithMetadata(logwell.M{
        "env":     "production",
        "version": "1.2.3",
    }),
)
// All logs will include env and version
client.Info("Started") // includes env and version
```

## Child Loggers

Create child loggers for request-scoped context:

```go
// Create child with additional metadata
requestLogger := client.Child(
    logwell.ChildWithMetadata(logwell.M{"requestId": "abc-123"}),
)

// All logs include requestId automatically
requestLogger.Info("Request received")
requestLogger.Info("Processing complete")

// Override service name for a child
dbLogger := client.Child(
    logwell.ChildWithService("my-app-db"),
    logwell.ChildWithMetadata(logwell.M{"component": "database"}),
)
dbLogger.Info("Query executed", logwell.M{"duration": 45})
```

Child loggers:
- Share the parent's queue and transport (efficient batching)
- Inherit parent metadata (child metadata overrides on conflict)
- Can override the service name
- Can be shut down independently without affecting parent

## Shutdown and Flush

### Shutdown

Always call `Shutdown` before your application exits to ensure all queued logs are sent:

```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()

if err := client.Shutdown(ctx); err != nil {
    log.Printf("Failed to shutdown cleanly: %v", err)
}
```

### Manual Flush

Force an immediate flush without shutting down:

```go
ctx := context.Background()
if err := client.Flush(ctx); err != nil {
    log.Printf("Flush failed: %v", err)
}
```

### Graceful Shutdown Pattern

```go
// Handle SIGTERM for graceful shutdown
sigChan := make(chan os.Signal, 1)
signal.Notify(sigChan, syscall.SIGTERM, syscall.SIGINT)

go func() {
    <-sigChan
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

    if err := client.Shutdown(ctx); err != nil {
        log.Printf("Shutdown error: %v", err)
    }
    os.Exit(0)
}()
```

## Error Handling

### Error Callbacks

Handle errors without blocking your application:

```go
client, _ := logwell.New(
    endpoint, apiKey,
    logwell.WithOnError(func(err *logwell.Error) {
        switch err.Code {
        case logwell.ErrNetworkError:
            log.Printf("Network issue: %v (will retry)", err)
        case logwell.ErrUnauthorized:
            log.Printf("Invalid API key: %v", err)
        case logwell.ErrQueueOverflow:
            log.Printf("Queue full, logs dropped: %v", err)
        default:
            log.Printf("Logwell error: %v", err)
        }
    }),
)
```

### Error Codes

| Code | Description | Retryable |
|------|-------------|-----------|
| `ErrNetworkError` | Network failure (connection, timeout) | Yes |
| `ErrUnauthorized` | Invalid API key (401) | No |
| `ErrValidationError` | Invalid log data (400) | No |
| `ErrRateLimited` | Too many requests (429) | Yes |
| `ErrServerError` | Server error (5xx) | Yes |
| `ErrQueueOverflow` | Queue full, oldest logs dropped | No |
| `ErrInvalidConfig` | Invalid configuration | No |

### Error Type

```go
err := client.Flush(ctx)
if err != nil {
    if logwellErr, ok := err.(*logwell.Error); ok {
        fmt.Printf("Code: %s\n", logwellErr.Code)
        fmt.Printf("Message: %s\n", logwellErr.Message)
        fmt.Printf("StatusCode: %d\n", logwellErr.StatusCode)
        fmt.Printf("Retryable: %t\n", logwellErr.Retryable)
        fmt.Printf("Cause: %v\n", logwellErr.Cause)
    }
}
```

## Source Location Capture

Enable automatic file and line number capture:

```go
client, _ := logwell.New(
    endpoint, apiKey,
    logwell.WithCaptureSourceLocation(true),
)

client.Info("Something happened")
// Log includes: sourceFile: "main.go", lineNumber: 42
```

> **Note:** This uses `runtime.Caller()` which has minor performance overhead. Disabled by default.

## API Reference

### Client

```go
// Constructor
func New(endpoint, apiKey string, opts ...Option) (*Client, error)

// Log methods
func (c *Client) Debug(message string, metadata ...map[string]any)
func (c *Client) Info(message string, metadata ...map[string]any)
func (c *Client) Warn(message string, metadata ...map[string]any)
func (c *Client) Error(message string, metadata ...map[string]any)
func (c *Client) Fatal(message string, metadata ...map[string]any)

// Generic log with full control
func (c *Client) Log(entry LogEntry)

// Child logger
func (c *Client) Child(opts ...ChildOption) *Client

// Lifecycle
func (c *Client) Flush(ctx context.Context) error
func (c *Client) Shutdown(ctx context.Context) error
```

### Types

```go
// Log levels
const (
    LevelDebug LogLevel = "debug"
    LevelInfo  LogLevel = "info"
    LevelWarn  LogLevel = "warn"
    LevelError LogLevel = "error"
    LevelFatal LogLevel = "fatal"
)

// Metadata shorthand
type M map[string]any

// Log entry structure
type LogEntry struct {
    Level      LogLevel
    Message    string
    Timestamp  string         // Auto-generated if empty
    Service    string
    Metadata   M
    SourceFile string
    LineNumber int
}

// Ingest response
type IngestResponse struct {
    Accepted int
    Rejected int
    Errors   []string
}
```

## HTTP Server Example

```go
package main

import (
    "context"
    "log"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"

    "github.com/Divkix/Logwell/sdks/go/logwell"
    "github.com/google/uuid"
)

var logger *logwell.Client

func main() {
    var err error
    logger, err = logwell.New(
        os.Getenv("LOGWELL_ENDPOINT"),
        os.Getenv("LOGWELL_API_KEY"),
        logwell.WithService("http-server"),
    )
    if err != nil {
        log.Fatal(err)
    }

    http.HandleFunc("/", handler)

    // Graceful shutdown
    server := &http.Server{Addr: ":8080"}
    go func() {
        sigChan := make(chan os.Signal, 1)
        signal.Notify(sigChan, syscall.SIGTERM, syscall.SIGINT)
        <-sigChan

        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()

        logger.Shutdown(ctx)
        server.Shutdown(ctx)
    }()

    logger.Info("Server starting", logwell.M{"port": 8080})
    log.Fatal(server.ListenAndServe())
}

func handler(w http.ResponseWriter, r *http.Request) {
    start := time.Now()
    requestID := uuid.New().String()

    // Create request-scoped logger
    reqLog := logger.Child(
        logwell.ChildWithMetadata(logwell.M{"requestId": requestID}),
    )

    reqLog.Info("Request started", logwell.M{
        "method": r.Method,
        "path":   r.URL.Path,
    })

    // Handle request...
    w.WriteHeader(http.StatusOK)
    w.Write([]byte("OK"))

    reqLog.Info("Request completed", logwell.M{
        "status":   200,
        "duration": time.Since(start).Milliseconds(),
    })
}
```

## Requirements

- Go 1.21+
- No external dependencies

## License

MIT License - see [LICENSE](../../LICENSE) for details.
