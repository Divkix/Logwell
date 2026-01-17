package logwell

import (
    "context"
    "encoding/json"
    "net/http"
    "net/http/httptest"
    "strings"
    "sync"
    "sync/atomic"
    "testing"
    "time"
)

// testServer is a mock server that captures received logs for verification.
type testServer struct {
    *httptest.Server
    mu       sync.Mutex
    logs     []LogEntry
    requests []ingestRequest
    handler  http.HandlerFunc
}

// newTestServer creates a new test server that accepts logs.
func newTestServer() *testServer {
    ts := &testServer{
        logs:     make([]LogEntry, 0),
        requests: make([]ingestRequest, 0),
    }

    ts.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // Allow custom handler override
        if ts.handler != nil {
            ts.handler(w, r)
            return
        }

        // Default: accept all logs
        var req ingestRequest
        if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
            w.WriteHeader(http.StatusBadRequest)
            json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
            return
        }

        ts.mu.Lock()
        ts.requests = append(ts.requests, req)
        ts.logs = append(ts.logs, req.Logs...)
        ts.mu.Unlock()

        w.WriteHeader(http.StatusOK)
        json.NewEncoder(w).Encode(IngestResponse{Accepted: len(req.Logs)})
    }))

    return ts
}

// getLogs returns a copy of received logs.
func (ts *testServer) getLogs() []LogEntry {
    ts.mu.Lock()
    defer ts.mu.Unlock()
    result := make([]LogEntry, len(ts.logs))
    copy(result, ts.logs)
    return result
}

// getRequests returns a copy of received requests.
func (ts *testServer) getRequests() []ingestRequest {
    ts.mu.Lock()
    defer ts.mu.Unlock()
    result := make([]ingestRequest, len(ts.requests))
    copy(result, ts.requests)
    return result
}

// setHandler sets a custom handler for the server.
func (ts *testServer) setHandler(h http.HandlerFunc) {
    ts.mu.Lock()
    defer ts.mu.Unlock()
    ts.handler = h
}

// TestClientNew tests client creation with valid and invalid configs.
func TestClientNew(t *testing.T) {
    t.Run("valid config creates client", func(t *testing.T) {
        ts := newTestServer()
        defer ts.Close()

        client, err := New(ts.URL, validAPIKey())
        if err != nil {
            t.Fatalf("New() error = %v", err)
        }
        if client == nil {
            t.Fatal("New() returned nil client")
        }
        defer client.Shutdown(context.Background())
    })

    t.Run("valid config with all options", func(t *testing.T) {
        ts := newTestServer()
        defer ts.Close()

        client, err := New(
            ts.URL,
            validAPIKey(),
            WithService("test-service"),
            WithMetadata(M{"env": "test"}),
            WithBatchSize(100),
            WithFlushInterval(10*time.Second),
            WithMaxQueueSize(5000),
            WithMaxRetries(5),
            WithCaptureSourceLocation(true),
            WithOnError(func(e *Error) { _ = e }),
            WithOnFlush(func(n int) { _ = n }),
        )
        if err != nil {
            t.Fatalf("New() error = %v", err)
        }
        if client == nil {
            t.Fatal("New() returned nil client")
        }
        defer client.Shutdown(context.Background())

        // Verify config was applied
        if client.config.Service != "test-service" {
            t.Errorf("Service = %q, want %q", client.config.Service, "test-service")
        }
        if client.config.BatchSize != 100 {
            t.Errorf("BatchSize = %d, want 100", client.config.BatchSize)
        }
    })

    t.Run("invalid endpoint returns error", func(t *testing.T) {
        _, err := New("not-a-url", validAPIKey())
        if err == nil {
            t.Fatal("New() expected error for invalid endpoint")
        }
        logwellErr, ok := err.(*Error)
        if !ok {
            t.Fatalf("error type = %T, want *Error", err)
        }
        if logwellErr.Code != ErrInvalidConfig {
            t.Errorf("error code = %q, want %q", logwellErr.Code, ErrInvalidConfig)
        }
    })

    t.Run("empty endpoint returns error", func(t *testing.T) {
        _, err := New("", validAPIKey())
        if err == nil {
            t.Fatal("New() expected error for empty endpoint")
        }
        logwellErr, ok := err.(*Error)
        if !ok {
            t.Fatalf("error type = %T, want *Error", err)
        }
        if logwellErr.Code != ErrInvalidConfig {
            t.Errorf("error code = %q, want %q", logwellErr.Code, ErrInvalidConfig)
        }
    })

    t.Run("invalid API key returns error", func(t *testing.T) {
        _, err := New("http://localhost:3000", "invalid-key")
        if err == nil {
            t.Fatal("New() expected error for invalid API key")
        }
        logwellErr, ok := err.(*Error)
        if !ok {
            t.Fatalf("error type = %T, want *Error", err)
        }
        if logwellErr.Code != ErrInvalidConfig {
            t.Errorf("error code = %q, want %q", logwellErr.Code, ErrInvalidConfig)
        }
    })

    t.Run("empty API key returns error", func(t *testing.T) {
        _, err := New("http://localhost:3000", "")
        if err == nil {
            t.Fatal("New() expected error for empty API key")
        }
    })

    t.Run("invalid batch size returns error", func(t *testing.T) {
        _, err := New("http://localhost:3000", validAPIKey(), WithBatchSize(0))
        if err == nil {
            t.Fatal("New() expected error for invalid batch size")
        }
    })

    t.Run("invalid flush interval returns error", func(t *testing.T) {
        _, err := New("http://localhost:3000", validAPIKey(), WithFlushInterval(0))
        if err == nil {
            t.Fatal("New() expected error for invalid flush interval")
        }
    })
}

// TestClientLogLevels tests logging at all severity levels.
func TestClientLogLevels(t *testing.T) {
    ts := newTestServer()
    defer ts.Close()

    client, err := New(ts.URL, validAPIKey(), WithBatchSize(1))
    if err != nil {
        t.Fatalf("New() error = %v", err)
    }
    defer client.Shutdown(context.Background())

    testCases := []struct {
        name    string
        logFn   func(string, ...map[string]any)
        level   LogLevel
        message string
    }{
        {"Debug", client.Debug, LevelDebug, "debug message"},
        {"Info", client.Info, LevelInfo, "info message"},
        {"Warn", client.Warn, LevelWarn, "warn message"},
        {"Error", client.Error, LevelError, "error message"},
        {"Fatal", client.Fatal, LevelFatal, "fatal message"},
    }

    for _, tc := range testCases {
        t.Run(tc.name, func(t *testing.T) {
            // Clear previous logs
            ts.mu.Lock()
            ts.logs = ts.logs[:0]
            ts.mu.Unlock()

            tc.logFn(tc.message)

            // Wait for flush (batch size 1 triggers immediate flush)
            time.Sleep(50 * time.Millisecond)

            logs := ts.getLogs()
            if len(logs) == 0 {
                t.Fatal("expected 1 log, got 0")
            }

            lastLog := logs[len(logs)-1]
            if lastLog.Level != tc.level {
                t.Errorf("Level = %q, want %q", lastLog.Level, tc.level)
            }
            if lastLog.Message != tc.message {
                t.Errorf("Message = %q, want %q", lastLog.Message, tc.message)
            }
        })
    }
}

// TestClientMetadataMerging tests metadata merging from config and call.
func TestClientMetadataMerging(t *testing.T) {
    ts := newTestServer()
    defer ts.Close()

    t.Run("config metadata is included in logs", func(t *testing.T) {
        client, err := New(
            ts.URL,
            validAPIKey(),
            WithBatchSize(1),
            WithMetadata(M{"env": "test", "version": "1.0"}),
        )
        if err != nil {
            t.Fatalf("New() error = %v", err)
        }
        defer client.Shutdown(context.Background())

        // Clear logs
        ts.mu.Lock()
        ts.logs = ts.logs[:0]
        ts.mu.Unlock()

        client.Info("test message")
        time.Sleep(50 * time.Millisecond)

        logs := ts.getLogs()
        if len(logs) == 0 {
            t.Fatal("expected at least 1 log")
        }

        lastLog := logs[len(logs)-1]
        if lastLog.Metadata["env"] != "test" {
            t.Errorf("Metadata[env] = %v, want %q", lastLog.Metadata["env"], "test")
        }
        if lastLog.Metadata["version"] != "1.0" {
            t.Errorf("Metadata[version] = %v, want %q", lastLog.Metadata["version"], "1.0")
        }
    })

    t.Run("call metadata merges with config metadata", func(t *testing.T) {
        client, err := New(
            ts.URL,
            validAPIKey(),
            WithBatchSize(1),
            WithMetadata(M{"env": "test", "version": "1.0"}),
        )
        if err != nil {
            t.Fatalf("New() error = %v", err)
        }
        defer client.Shutdown(context.Background())

        // Clear logs
        ts.mu.Lock()
        ts.logs = ts.logs[:0]
        ts.mu.Unlock()

        client.Info("test message", M{"request_id": "abc123"})
        time.Sleep(50 * time.Millisecond)

        logs := ts.getLogs()
        if len(logs) == 0 {
            t.Fatal("expected at least 1 log")
        }

        lastLog := logs[len(logs)-1]
        // Config metadata
        if lastLog.Metadata["env"] != "test" {
            t.Errorf("Metadata[env] = %v, want %q", lastLog.Metadata["env"], "test")
        }
        // Call metadata
        if lastLog.Metadata["request_id"] != "abc123" {
            t.Errorf("Metadata[request_id] = %v, want %q", lastLog.Metadata["request_id"], "abc123")
        }
    })

    t.Run("call metadata overrides config metadata", func(t *testing.T) {
        client, err := New(
            ts.URL,
            validAPIKey(),
            WithBatchSize(1),
            WithMetadata(M{"env": "test", "version": "1.0"}),
        )
        if err != nil {
            t.Fatalf("New() error = %v", err)
        }
        defer client.Shutdown(context.Background())

        // Clear logs
        ts.mu.Lock()
        ts.logs = ts.logs[:0]
        ts.mu.Unlock()

        // Override env in call metadata
        client.Info("test message", M{"env": "production"})
        time.Sleep(50 * time.Millisecond)

        logs := ts.getLogs()
        if len(logs) == 0 {
            t.Fatal("expected at least 1 log")
        }

        lastLog := logs[len(logs)-1]
        if lastLog.Metadata["env"] != "production" {
            t.Errorf("Metadata[env] = %v, want %q", lastLog.Metadata["env"], "production")
        }
        // Non-overridden key should still be present
        if lastLog.Metadata["version"] != "1.0" {
            t.Errorf("Metadata[version] = %v, want %q", lastLog.Metadata["version"], "1.0")
        }
    })

    t.Run("multiple metadata maps merge correctly", func(t *testing.T) {
        client, err := New(
            ts.URL,
            validAPIKey(),
            WithBatchSize(1),
        )
        if err != nil {
            t.Fatalf("New() error = %v", err)
        }
        defer client.Shutdown(context.Background())

        // Clear logs
        ts.mu.Lock()
        ts.logs = ts.logs[:0]
        ts.mu.Unlock()

        client.Info("test", M{"a": "1"}, M{"b": "2"}, M{"a": "3"})
        time.Sleep(50 * time.Millisecond)

        logs := ts.getLogs()
        if len(logs) == 0 {
            t.Fatal("expected at least 1 log")
        }

        lastLog := logs[len(logs)-1]
        // Later maps should override earlier ones
        if lastLog.Metadata["a"] != "3" {
            t.Errorf("Metadata[a] = %v, want %q", lastLog.Metadata["a"], "3")
        }
        if lastLog.Metadata["b"] != "2" {
            t.Errorf("Metadata[b] = %v, want %q", lastLog.Metadata["b"], "2")
        }
    })
}

// TestClientBatchAutoFlush tests auto-flush when batch size is reached.
func TestClientBatchAutoFlush(t *testing.T) {
    ts := newTestServer()
    defer ts.Close()

    batchSize := 5
    client, err := New(
        ts.URL,
        validAPIKey(),
        WithBatchSize(batchSize),
        WithFlushInterval(1*time.Minute), // Long interval to avoid timer flush
    )
    if err != nil {
        t.Fatalf("New() error = %v", err)
    }
    defer client.Shutdown(context.Background())

    // Log exactly batch size entries
    for i := 0; i < batchSize; i++ {
        client.Info("message")
    }

    // Wait for flush
    time.Sleep(100 * time.Millisecond)

    logs := ts.getLogs()
    if len(logs) != batchSize {
        t.Errorf("received %d logs, want %d", len(logs), batchSize)
    }

    // Verify exactly one request was made (all in one batch)
    requests := ts.getRequests()
    if len(requests) != 1 {
        t.Errorf("received %d requests, want 1", len(requests))
    }
}

// TestClientManualFlush tests explicit Flush() call.
func TestClientManualFlush(t *testing.T) {
    ts := newTestServer()
    defer ts.Close()

    client, err := New(
        ts.URL,
        validAPIKey(),
        WithBatchSize(100), // Large batch size to prevent auto-flush
        WithFlushInterval(1*time.Minute),
    )
    if err != nil {
        t.Fatalf("New() error = %v", err)
    }
    defer client.Shutdown(context.Background())

    // Log some entries (less than batch size)
    client.Info("message 1")
    client.Info("message 2")
    client.Info("message 3")

    // Verify no logs sent yet
    logs := ts.getLogs()
    if len(logs) != 0 {
        t.Errorf("expected 0 logs before flush, got %d", len(logs))
    }

    // Manual flush
    err = client.Flush(context.Background())
    if err != nil {
        t.Fatalf("Flush() error = %v", err)
    }

    // Verify logs sent
    logs = ts.getLogs()
    if len(logs) != 3 {
        t.Errorf("expected 3 logs after flush, got %d", len(logs))
    }
}

// TestClientShutdown tests graceful shutdown behavior.
func TestClientShutdown(t *testing.T) {
    ts := newTestServer()
    defer ts.Close()

    client, err := New(
        ts.URL,
        validAPIKey(),
        WithBatchSize(100), // Large batch to prevent auto-flush
        WithFlushInterval(1*time.Minute),
    )
    if err != nil {
        t.Fatalf("New() error = %v", err)
    }

    // Log entries
    client.Info("message 1")
    client.Info("message 2")

    // Verify no logs sent yet
    logs := ts.getLogs()
    if len(logs) != 0 {
        t.Errorf("expected 0 logs before shutdown, got %d", len(logs))
    }

    // Shutdown should flush remaining logs
    err = client.Shutdown(context.Background())
    if err != nil {
        t.Fatalf("Shutdown() error = %v", err)
    }

    // Verify logs were flushed
    logs = ts.getLogs()
    if len(logs) != 2 {
        t.Errorf("expected 2 logs after shutdown, got %d", len(logs))
    }

    // Verify new logs are not sent after shutdown
    client.Info("should not be sent")

    time.Sleep(50 * time.Millisecond)

    logs = ts.getLogs()
    if len(logs) != 2 {
        t.Errorf("expected 2 logs after logging post-shutdown, got %d", len(logs))
    }
}

// TestClientShutdownIdempotent tests that multiple shutdowns are safe.
func TestClientShutdownIdempotent(t *testing.T) {
    ts := newTestServer()
    defer ts.Close()

    client, err := New(ts.URL, validAPIKey())
    if err != nil {
        t.Fatalf("New() error = %v", err)
    }

    // First shutdown
    err = client.Shutdown(context.Background())
    if err != nil {
        t.Fatalf("first Shutdown() error = %v", err)
    }

    // Second shutdown should not error
    err = client.Shutdown(context.Background())
    if err != nil {
        t.Fatalf("second Shutdown() error = %v", err)
    }
}

// TestClientChild tests child logger creation and inheritance.
func TestClientChild(t *testing.T) {
    ts := newTestServer()
    defer ts.Close()

    parent, err := New(
        ts.URL,
        validAPIKey(),
        WithBatchSize(1),
        WithService("parent-service"),
        WithMetadata(M{"env": "test", "parent_key": "parent_value"}),
    )
    if err != nil {
        t.Fatalf("New() error = %v", err)
    }
    defer parent.Shutdown(context.Background())

    t.Run("child inherits parent service", func(t *testing.T) {
        child := parent.Child()

        ts.mu.Lock()
        ts.logs = ts.logs[:0]
        ts.mu.Unlock()

        child.Info("child message")
        time.Sleep(50 * time.Millisecond)

        logs := ts.getLogs()
        if len(logs) == 0 {
            t.Fatal("expected at least 1 log")
        }

        lastLog := logs[len(logs)-1]
        if lastLog.Service != "parent-service" {
            t.Errorf("Service = %q, want %q", lastLog.Service, "parent-service")
        }
    })

    t.Run("child can override service", func(t *testing.T) {
        child := parent.Child(ChildWithService("child-service"))

        ts.mu.Lock()
        ts.logs = ts.logs[:0]
        ts.mu.Unlock()

        child.Info("child message")
        time.Sleep(50 * time.Millisecond)

        logs := ts.getLogs()
        if len(logs) == 0 {
            t.Fatal("expected at least 1 log")
        }

        lastLog := logs[len(logs)-1]
        if lastLog.Service != "child-service" {
            t.Errorf("Service = %q, want %q", lastLog.Service, "child-service")
        }
    })

    t.Run("child inherits parent metadata", func(t *testing.T) {
        child := parent.Child()

        ts.mu.Lock()
        ts.logs = ts.logs[:0]
        ts.mu.Unlock()

        child.Info("child message")
        time.Sleep(50 * time.Millisecond)

        logs := ts.getLogs()
        if len(logs) == 0 {
            t.Fatal("expected at least 1 log")
        }

        lastLog := logs[len(logs)-1]
        if lastLog.Metadata["env"] != "test" {
            t.Errorf("Metadata[env] = %v, want %q", lastLog.Metadata["env"], "test")
        }
        if lastLog.Metadata["parent_key"] != "parent_value" {
            t.Errorf("Metadata[parent_key] = %v, want %q", lastLog.Metadata["parent_key"], "parent_value")
        }
    })

    t.Run("child metadata merges with parent", func(t *testing.T) {
        child := parent.Child(ChildWithMetadata(M{"child_key": "child_value"}))

        ts.mu.Lock()
        ts.logs = ts.logs[:0]
        ts.mu.Unlock()

        child.Info("child message")
        time.Sleep(50 * time.Millisecond)

        logs := ts.getLogs()
        if len(logs) == 0 {
            t.Fatal("expected at least 1 log")
        }

        lastLog := logs[len(logs)-1]
        // Parent metadata
        if lastLog.Metadata["env"] != "test" {
            t.Errorf("Metadata[env] = %v, want %q", lastLog.Metadata["env"], "test")
        }
        // Child metadata
        if lastLog.Metadata["child_key"] != "child_value" {
            t.Errorf("Metadata[child_key] = %v, want %q", lastLog.Metadata["child_key"], "child_value")
        }
    })

    t.Run("child metadata overrides parent", func(t *testing.T) {
        child := parent.Child(ChildWithMetadata(M{"env": "production"}))

        ts.mu.Lock()
        ts.logs = ts.logs[:0]
        ts.mu.Unlock()

        child.Info("child message")
        time.Sleep(50 * time.Millisecond)

        logs := ts.getLogs()
        if len(logs) == 0 {
            t.Fatal("expected at least 1 log")
        }

        lastLog := logs[len(logs)-1]
        if lastLog.Metadata["env"] != "production" {
            t.Errorf("Metadata[env] = %v, want %q", lastLog.Metadata["env"], "production")
        }
        // Non-overridden key should still exist
        if lastLog.Metadata["parent_key"] != "parent_value" {
            t.Errorf("Metadata[parent_key] = %v, want %q", lastLog.Metadata["parent_key"], "parent_value")
        }
    })

    t.Run("child shares parent queue", func(t *testing.T) {
        child := parent.Child()

        // Both parent and child should contribute to the same batch
        if child.queue != parent.queue {
            t.Error("child queue is not same as parent queue")
        }
    })

    t.Run("child shutdown does not affect parent", func(t *testing.T) {
        child := parent.Child()

        // Shutdown child
        err := child.Shutdown(context.Background())
        if err != nil {
            t.Fatalf("child Shutdown() error = %v", err)
        }

        // Child should be shut down
        child.Info("should be dropped")

        // Parent should still work
        ts.mu.Lock()
        ts.logs = ts.logs[:0]
        ts.mu.Unlock()

        parent.Info("parent after child shutdown")
        time.Sleep(50 * time.Millisecond)

        logs := ts.getLogs()
        if len(logs) != 1 {
            t.Errorf("expected 1 log from parent, got %d", len(logs))
        }
    })
}

// TestClientOnErrorCallback tests the OnError callback.
func TestClientOnErrorCallback(t *testing.T) {
    var errorReceived *Error
    var errorMu sync.Mutex

    ts := newTestServer()
    defer ts.Close()

    // Set handler to always return 500
    ts.setHandler(func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusInternalServerError)
        json.NewEncoder(w).Encode(map[string]string{"error": "test error"})
    })

    client, err := New(
        ts.URL,
        validAPIKey(),
        WithBatchSize(1),
        WithMaxRetries(0), // No retries to speed up test
        WithOnError(func(e *Error) {
            errorMu.Lock()
            errorReceived = e
            errorMu.Unlock()
        }),
    )
    if err != nil {
        t.Fatalf("New() error = %v", err)
    }
    defer client.Shutdown(context.Background())

    client.Info("trigger error")
    time.Sleep(100 * time.Millisecond)

    errorMu.Lock()
    defer errorMu.Unlock()

    if errorReceived == nil {
        t.Fatal("OnError callback was not called")
    }
    if errorReceived.Code != ErrServerError {
        t.Errorf("error code = %q, want %q", errorReceived.Code, ErrServerError)
    }
}

// TestClientOnFlushCallback tests the OnFlush callback.
func TestClientOnFlushCallback(t *testing.T) {
    var flushCount int32

    ts := newTestServer()
    defer ts.Close()

    client, err := New(
        ts.URL,
        validAPIKey(),
        WithBatchSize(3),
        WithOnFlush(func(count int) {
            atomic.StoreInt32(&flushCount, int32(count))
        }),
    )
    if err != nil {
        t.Fatalf("New() error = %v", err)
    }
    defer client.Shutdown(context.Background())

    // Log exactly batch size to trigger flush
    client.Info("message 1")
    client.Info("message 2")
    client.Info("message 3")

    time.Sleep(100 * time.Millisecond)

    count := atomic.LoadInt32(&flushCount)
    if count != 3 {
        t.Errorf("OnFlush received count = %d, want 3", count)
    }
}

// TestClientSourceLocation tests source location capture.
func TestClientSourceLocation(t *testing.T) {
    ts := newTestServer()
    defer ts.Close()

    t.Run("source location disabled by default", func(t *testing.T) {
        client, err := New(ts.URL, validAPIKey(), WithBatchSize(1))
        if err != nil {
            t.Fatalf("New() error = %v", err)
        }
        defer client.Shutdown(context.Background())

        ts.mu.Lock()
        ts.logs = ts.logs[:0]
        ts.mu.Unlock()

        client.Info("test message")
        time.Sleep(50 * time.Millisecond)

        logs := ts.getLogs()
        if len(logs) == 0 {
            t.Fatal("expected at least 1 log")
        }

        lastLog := logs[len(logs)-1]
        if lastLog.SourceFile != "" {
            t.Errorf("SourceFile = %q, want empty when disabled", lastLog.SourceFile)
        }
        if lastLog.LineNumber != 0 {
            t.Errorf("LineNumber = %d, want 0 when disabled", lastLog.LineNumber)
        }
    })

    t.Run("source location captured when enabled", func(t *testing.T) {
        client, err := New(
            ts.URL,
            validAPIKey(),
            WithBatchSize(1),
            WithCaptureSourceLocation(true),
        )
        if err != nil {
            t.Fatalf("New() error = %v", err)
        }
        defer client.Shutdown(context.Background())

        ts.mu.Lock()
        ts.logs = ts.logs[:0]
        ts.mu.Unlock()

        client.Info("test message") // This line number matters
        time.Sleep(50 * time.Millisecond)

        logs := ts.getLogs()
        if len(logs) == 0 {
            t.Fatal("expected at least 1 log")
        }

        lastLog := logs[len(logs)-1]
        if lastLog.SourceFile == "" {
            t.Error("SourceFile is empty when enabled")
        }
        if !strings.HasSuffix(lastLog.SourceFile, "_test.go") {
            t.Errorf("SourceFile = %q, expected to end with _test.go", lastLog.SourceFile)
        }
        if lastLog.LineNumber == 0 {
            t.Error("LineNumber = 0 when enabled")
        }
    })
}

// TestClientContextCancellation tests context cancellation during flush.
func TestClientContextCancellation(t *testing.T) {
    ts := newTestServer()
    defer ts.Close()

    // Set handler to delay response
    ts.setHandler(func(w http.ResponseWriter, r *http.Request) {
        time.Sleep(500 * time.Millisecond)
        w.WriteHeader(http.StatusOK)
        json.NewEncoder(w).Encode(IngestResponse{Accepted: 1})
    })

    client, err := New(
        ts.URL,
        validAPIKey(),
        WithBatchSize(100),
    )
    if err != nil {
        t.Fatalf("New() error = %v", err)
    }
    defer client.Shutdown(context.Background())

    client.Info("test message")

    // Create context with short timeout
    ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
    defer cancel()

    err = client.Flush(ctx)
    if err == nil {
        t.Fatal("Flush() expected error for context timeout")
    }

    // Verify error is context-related
    logwellErr, ok := err.(*Error)
    if !ok {
        t.Fatalf("error type = %T, want *Error", err)
    }
    if logwellErr.Code != ErrNetworkError {
        t.Errorf("error code = %q, want %q", logwellErr.Code, ErrNetworkError)
    }
}

// TestClientLogEntry tests the generic Log() method.
func TestClientLogEntry(t *testing.T) {
    ts := newTestServer()
    defer ts.Close()

    client, err := New(
        ts.URL,
        validAPIKey(),
        WithBatchSize(1),
        WithService("default-service"),
        WithMetadata(M{"default_key": "default_value"}),
    )
    if err != nil {
        t.Fatalf("New() error = %v", err)
    }
    defer client.Shutdown(context.Background())

    t.Run("Log with full entry", func(t *testing.T) {
        ts.mu.Lock()
        ts.logs = ts.logs[:0]
        ts.mu.Unlock()

        entry := LogEntry{
            Level:     LevelWarn,
            Message:   "custom entry",
            Service:   "custom-service",
            Metadata:  M{"custom_key": "custom_value"},
            Timestamp: "2024-01-01T00:00:00Z",
        }
        client.Log(entry)
        time.Sleep(50 * time.Millisecond)

        logs := ts.getLogs()
        if len(logs) == 0 {
            t.Fatal("expected at least 1 log")
        }

        lastLog := logs[len(logs)-1]
        if lastLog.Level != LevelWarn {
            t.Errorf("Level = %q, want %q", lastLog.Level, LevelWarn)
        }
        if lastLog.Message != "custom entry" {
            t.Errorf("Message = %q, want %q", lastLog.Message, "custom entry")
        }
        if lastLog.Service != "custom-service" {
            t.Errorf("Service = %q, want %q", lastLog.Service, "custom-service")
        }
        if lastLog.Timestamp != "2024-01-01T00:00:00Z" {
            t.Errorf("Timestamp = %q, want %q", lastLog.Timestamp, "2024-01-01T00:00:00Z")
        }
    })

    t.Run("Log uses defaults for empty fields", func(t *testing.T) {
        ts.mu.Lock()
        ts.logs = ts.logs[:0]
        ts.mu.Unlock()

        entry := LogEntry{
            Level:   LevelInfo,
            Message: "minimal entry",
        }
        client.Log(entry)
        time.Sleep(50 * time.Millisecond)

        logs := ts.getLogs()
        if len(logs) == 0 {
            t.Fatal("expected at least 1 log")
        }

        lastLog := logs[len(logs)-1]
        if lastLog.Service != "default-service" {
            t.Errorf("Service = %q, want %q (default)", lastLog.Service, "default-service")
        }
        if lastLog.Timestamp == "" {
            t.Error("Timestamp should be auto-generated")
        }
    })

    t.Run("Log merges config metadata with entry metadata", func(t *testing.T) {
        ts.mu.Lock()
        ts.logs = ts.logs[:0]
        ts.mu.Unlock()

        entry := LogEntry{
            Level:    LevelInfo,
            Message:  "merge test",
            Metadata: M{"entry_key": "entry_value"},
        }
        client.Log(entry)
        time.Sleep(50 * time.Millisecond)

        logs := ts.getLogs()
        if len(logs) == 0 {
            t.Fatal("expected at least 1 log")
        }

        lastLog := logs[len(logs)-1]
        if lastLog.Metadata["default_key"] != "default_value" {
            t.Errorf("Metadata[default_key] = %v, want %q", lastLog.Metadata["default_key"], "default_value")
        }
        if lastLog.Metadata["entry_key"] != "entry_value" {
            t.Errorf("Metadata[entry_key] = %v, want %q", lastLog.Metadata["entry_key"], "entry_value")
        }
    })
}

// TestClientFullFlow tests the complete lifecycle: create, log, flush, shutdown.
func TestClientFullFlow(t *testing.T) {
    ts := newTestServer()
    defer ts.Close()

    // Step 1: Create client
    client, err := New(
        ts.URL,
        validAPIKey(),
        WithService("integration-test"),
        WithBatchSize(5),
        WithFlushInterval(500*time.Millisecond),
        WithMetadata(M{"test": "integration"}),
    )
    if err != nil {
        t.Fatalf("New() error = %v", err)
    }

    // Step 2: Log at various levels
    client.Debug("debug message", M{"level": "debug"})
    client.Info("info message", M{"level": "info"})
    client.Warn("warn message", M{"level": "warn"})
    client.Error("error message", M{"level": "error"})

    // Verify logs are queued (not sent yet, batch size is 5)
    logs := ts.getLogs()
    if len(logs) != 0 {
        t.Errorf("expected 0 logs before batch complete, got %d", len(logs))
    }

    // Step 3: Log one more to trigger batch flush
    client.Fatal("fatal message", M{"level": "fatal"})

    time.Sleep(100 * time.Millisecond)

    logs = ts.getLogs()
    if len(logs) != 5 {
        t.Errorf("expected 5 logs after batch complete, got %d", len(logs))
    }

    // Verify all levels present
    levels := make(map[LogLevel]bool)
    for _, log := range logs {
        levels[log.Level] = true
        // Verify service
        if log.Service != "integration-test" {
            t.Errorf("Service = %q, want %q", log.Service, "integration-test")
        }
        // Verify base metadata
        if log.Metadata["test"] != "integration" {
            t.Errorf("Metadata[test] = %v, want %q", log.Metadata["test"], "integration")
        }
    }

    expectedLevels := []LogLevel{LevelDebug, LevelInfo, LevelWarn, LevelError, LevelFatal}
    for _, level := range expectedLevels {
        if !levels[level] {
            t.Errorf("missing log level: %s", level)
        }
    }

    // Step 4: Log more and manually flush
    client.Info("post-batch message 1")
    client.Info("post-batch message 2")

    err = client.Flush(context.Background())
    if err != nil {
        t.Fatalf("Flush() error = %v", err)
    }

    logs = ts.getLogs()
    if len(logs) != 7 {
        t.Errorf("expected 7 logs after manual flush, got %d", len(logs))
    }

    // Step 5: Shutdown gracefully
    client.Info("pre-shutdown message")

    err = client.Shutdown(context.Background())
    if err != nil {
        t.Fatalf("Shutdown() error = %v", err)
    }

    logs = ts.getLogs()
    if len(logs) != 8 {
        t.Errorf("expected 8 logs after shutdown, got %d", len(logs))
    }

    // Verify no more logs accepted after shutdown
    client.Info("post-shutdown message")
    time.Sleep(50 * time.Millisecond)

    logs = ts.getLogs()
    if len(logs) != 8 {
        t.Errorf("expected 8 logs after post-shutdown log, got %d", len(logs))
    }
}

// TestClientTimerFlush tests timer-based auto-flush.
func TestClientTimerFlush(t *testing.T) {
    ts := newTestServer()
    defer ts.Close()

    flushInterval := 200 * time.Millisecond
    client, err := New(
        ts.URL,
        validAPIKey(),
        WithBatchSize(100), // Large batch size to prevent batch-based flush
        WithFlushInterval(flushInterval),
    )
    if err != nil {
        t.Fatalf("New() error = %v", err)
    }
    defer client.Shutdown(context.Background())

    // Log a message
    client.Info("timer flush test")

    // Verify no logs sent immediately
    logs := ts.getLogs()
    if len(logs) != 0 {
        t.Errorf("expected 0 logs immediately, got %d", len(logs))
    }

    // Wait for timer flush
    time.Sleep(flushInterval + 100*time.Millisecond)

    logs = ts.getLogs()
    if len(logs) != 1 {
        t.Errorf("expected 1 log after timer flush, got %d", len(logs))
    }
}

// TestClientService tests service name in logs.
func TestClientService(t *testing.T) {
    ts := newTestServer()
    defer ts.Close()

    client, err := New(
        ts.URL,
        validAPIKey(),
        WithBatchSize(1),
        WithService("my-service"),
    )
    if err != nil {
        t.Fatalf("New() error = %v", err)
    }
    defer client.Shutdown(context.Background())

    client.Info("service test")
    time.Sleep(50 * time.Millisecond)

    logs := ts.getLogs()
    if len(logs) == 0 {
        t.Fatal("expected at least 1 log")
    }

    if logs[0].Service != "my-service" {
        t.Errorf("Service = %q, want %q", logs[0].Service, "my-service")
    }
}

// TestClientConcurrency tests thread-safety of client operations.
func TestClientConcurrency(t *testing.T) {
    ts := newTestServer()
    defer ts.Close()

    client, err := New(
        ts.URL,
        validAPIKey(),
        WithBatchSize(10),
        WithFlushInterval(100*time.Millisecond),
    )
    if err != nil {
        t.Fatalf("New() error = %v", err)
    }

    var wg sync.WaitGroup
    numGoroutines := 10
    logsPerGoroutine := 50

    // Concurrent logging
    for i := 0; i < numGoroutines; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for j := 0; j < logsPerGoroutine; j++ {
                client.Info("concurrent log", M{"goroutine": id, "iteration": j})
            }
        }(i)
    }

    wg.Wait()

    // Shutdown to flush all remaining logs
    err = client.Shutdown(context.Background())
    if err != nil {
        t.Fatalf("Shutdown() error = %v", err)
    }

    expectedTotal := numGoroutines * logsPerGoroutine
    logs := ts.getLogs()
    if len(logs) != expectedTotal {
        t.Errorf("expected %d logs, got %d", expectedTotal, len(logs))
    }
}
