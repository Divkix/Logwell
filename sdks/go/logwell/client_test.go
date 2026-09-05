package logwell

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type testServer struct {
	*httptest.Server
	mu       sync.Mutex
	logs     []LogEntry
	requests [][]LogEntry
	handler  http.HandlerFunc
}

func newTestServer() *testServer {
	ts := &testServer{
		logs:     make([]LogEntry, 0),
		requests: make([][]LogEntry, 0),
	}

	ts.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if ts.handler != nil {
			ts.handler(w, r)
			return
		}

		var raw []map[string]any
		if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}

		var entries []LogEntry
		for _, item := range raw {
			entry, err := mapToLogEntry(item)
			if err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
				return
			}
			entries = append(entries, entry)
		}

		ts.mu.Lock()
		ts.requests = append(ts.requests, entries)
		ts.logs = append(ts.logs, entries...)
		ts.mu.Unlock()

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(IngestResponse{Accepted: len(entries)})
	}))

	return ts
}

func (ts *testServer) getLogs() []LogEntry {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	result := make([]LogEntry, len(ts.logs))
	copy(result, ts.logs)
	return result
}

func (ts *testServer) getRequests() [][]LogEntry {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	result := make([][]LogEntry, len(ts.requests))
	copy(result, ts.requests)
	return result
}

func mapToLogEntry(m map[string]any) (LogEntry, error) {
	var entry LogEntry

	lvl, ok := m["level"].(string)
	if !ok {
		return entry, fmt.Errorf("missing or invalid 'level' field")
	}
	entry.Level = LogLevel(lvl)

	msg, ok := m["message"].(string)
	if !ok {
		return entry, fmt.Errorf("missing or invalid 'message' field")
	}
	entry.Message = msg

	if ts, ok := m["timestamp"].(string); ok {
		entry.Timestamp = ts
	}
	if svc, ok := m["service"].(string); ok {
		entry.Service = svc
	}
	if meta, ok := m["metadata"].(map[string]any); ok {
		entry.Metadata = meta
	}
	if sf, ok := m["sourceFile"].(string); ok {
		entry.SourceFile = sf
	}
	if ln, ok := m["lineNumber"].(float64); ok {
		entry.LineNumber = int(ln)
	}

	return entry, nil
}

func (ts *testServer) setHandler(h http.HandlerFunc) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	ts.handler = h
}

func TestClientNew(t *testing.T) {
	t.Run("valid config creates client", func(t *testing.T) {
		ts := newTestServer()
		defer ts.Close()

		client := createTestClient(t, ts)
		defer client.Shutdown(context.Background())
	})

	t.Run("valid config with all options", func(t *testing.T) {
		ts := newTestServer()
		defer ts.Close()

		client := createTestClient(t, ts,
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
		defer client.Shutdown(context.Background())

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
		assertConfigError(t, err, ErrInvalidConfig)
	})

	t.Run("empty endpoint returns error", func(t *testing.T) {
		_, err := New("", validAPIKey())
		if err == nil {
			t.Fatal("New() expected error for empty endpoint")
		}
		assertConfigError(t, err, ErrInvalidConfig)
	})

	t.Run("invalid API key returns error", func(t *testing.T) {
		_, err := New("http://localhost:3000", "invalid-key")
		if err == nil {
			t.Fatal("New() expected error for invalid API key")
		}
		assertConfigError(t, err, ErrInvalidConfig)
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
			ts.mu.Lock()
			ts.logs = ts.logs[:0]
			ts.mu.Unlock()

			tc.logFn(tc.message)

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

		log := logAndWait(client, ts, client.Info, "test message")
		assertLogMetadata(t, log, map[string]string{
			"env":     "test",
			"version": "1.0",
		})
	})

	t.Run("call metadata merges with config metadata", func(t *testing.T) {
		log := setupAndLogWithMetadata(t, ts,
			[]Option{WithBatchSize(1), WithMetadata(M{"env": "test", "version": "1.0"})},
			"test message",
			M{"request_id": "abc123"},
		)

		assertLogMetadata(t, log, map[string]string{
			"env":        "test",
			"version":    "1.0",
			"request_id": "abc123",
		})
	})

	t.Run("call metadata overrides config metadata", func(t *testing.T) {
		log := setupAndLogWithMetadata(t, ts,
			[]Option{WithBatchSize(1), WithMetadata(M{"env": "test", "version": "1.0"})},
			"test message",
			M{"env": "production"},
		)

		assertLogMetadata(t, log, map[string]string{
			"env":     "production",
			"version": "1.0",
		})
	})

	t.Run("multiple metadata maps merge correctly", func(t *testing.T) {
		log := setupAndLogWithMetadata(t, ts,
			[]Option{WithBatchSize(1)},
			"test",
			M{"a": "1"},
			M{"b": "2"},
			M{"a": "3"},
		)

		assertLogMetadata(t, log, map[string]string{
			"a": "3",
			"b": "2",
		})
	})
}

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

	for i := 0; i < batchSize; i++ {
		client.Info("message")
	}

	time.Sleep(100 * time.Millisecond)

	logs := ts.getLogs()
	if len(logs) != batchSize {
		t.Errorf("received %d logs, want %d", len(logs), batchSize)
	}

	requests := ts.getRequests()
	if len(requests) != 1 {
		t.Errorf("received %d requests, want 1", len(requests))
	}
}

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

	client.Info("message 1")
	client.Info("message 2")
	client.Info("message 3")

	logs := ts.getLogs()
	if len(logs) != 0 {
		t.Errorf("expected 0 logs before flush, got %d", len(logs))
	}

	err = client.Flush(context.Background())
	if err != nil {
		t.Fatalf("Flush() error = %v", err)
	}

	logs = ts.getLogs()
	if len(logs) != 3 {
		t.Errorf("expected 3 logs after flush, got %d", len(logs))
	}
}

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

	client.Info("message 1")
	client.Info("message 2")

	logs := ts.getLogs()
	if len(logs) != 0 {
		t.Errorf("expected 0 logs before shutdown, got %d", len(logs))
	}

	err = client.Shutdown(context.Background())
	if err != nil {
		t.Fatalf("Shutdown() error = %v", err)
	}

	logs = ts.getLogs()
	if len(logs) != 2 {
		t.Errorf("expected 2 logs after shutdown, got %d", len(logs))
	}

	client.Info("should not be sent")

	time.Sleep(50 * time.Millisecond)

	logs = ts.getLogs()
	if len(logs) != 2 {
		t.Errorf("expected 2 logs after logging post-shutdown, got %d", len(logs))
	}
}

func TestClientShutdownIdempotent(t *testing.T) {
	ts := newTestServer()
	defer ts.Close()

	client, err := New(ts.URL, validAPIKey())
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	err = client.Shutdown(context.Background())
	if err != nil {
		t.Fatalf("first Shutdown() error = %v", err)
	}

	err = client.Shutdown(context.Background())
	if err != nil {
		t.Fatalf("second Shutdown() error = %v", err)
	}
}

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
		log := childLogHelper(t, parent, ts, nil, "child message")
		if log.Service != "parent-service" {
			t.Errorf("Service = %q, want %q", log.Service, "parent-service")
		}
	})

	t.Run("child can override service", func(t *testing.T) {
		log := childLogHelper(t, parent, ts, []ChildOption{ChildWithService("child-service")}, "child message")
		if log.Service != "child-service" {
			t.Errorf("Service = %q, want %q", log.Service, "child-service")
		}
	})

	t.Run("child inherits parent metadata", func(t *testing.T) {
		log := childLogHelper(t, parent, ts, nil, "child message")
		assertLogMetadata(t, log, map[string]string{
			"env":        "test",
			"parent_key": "parent_value",
		})
	})

	t.Run("child metadata merges with parent", func(t *testing.T) {
		log := childLogHelper(t, parent, ts, []ChildOption{ChildWithMetadata(M{"child_key": "child_value"})}, "child message")
		assertLogMetadata(t, log, map[string]string{
			"env":        "test",
			"parent_key": "parent_value",
			"child_key":  "child_value",
		})
	})

	t.Run("child metadata overrides parent", func(t *testing.T) {
		log := childLogHelper(t, parent, ts, []ChildOption{ChildWithMetadata(M{"env": "production"})}, "child message")
		assertLogMetadata(t, log, map[string]string{
			"env":        "production",
			"parent_key": "parent_value",
		})
	})

	t.Run("child shares parent queue", func(t *testing.T) {
		child := parent.Child()
		if child.queue != parent.queue {
			t.Error("child queue is not same as parent queue")
		}
	})

	t.Run("child shutdown does not affect parent", func(t *testing.T) {
		child := parent.Child()
		err := child.Shutdown(context.Background())
		if err != nil {
			t.Fatalf("child Shutdown() error = %v", err)
		}

		child.Info("should be dropped")

		clearTestLogs(ts)
		parent.Info("parent after child shutdown")
		time.Sleep(50 * time.Millisecond)

		logs := ts.getLogs()
		assertLogCount(t, logs, 1)
	})
}

func TestClientOnErrorCallback(t *testing.T) {
	var errorReceived *Error
	var errorMu sync.Mutex

	ts := newTestServer()
	defer ts.Close()

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

	client.Info("message 1")
	client.Info("message 2")
	client.Info("message 3")

	time.Sleep(100 * time.Millisecond)

	count := atomic.LoadInt32(&flushCount)
	if count != 3 {
		t.Errorf("OnFlush received count = %d, want 3", count)
	}
}

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

func TestClientContextCancellation(t *testing.T) {
	ts := newTestServer()
	defer ts.Close()

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

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	err = client.Flush(ctx)
	if err == nil {
		t.Fatal("Flush() expected error for context timeout")
	}

	logwellErr, ok := err.(*Error)
	if !ok {
		t.Fatalf("error type = %T, want *Error", err)
	}
	if logwellErr.Code != ErrNetworkError {
		t.Errorf("error code = %q, want %q", logwellErr.Code, ErrNetworkError)
	}
}

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

func TestClientFullFlow(t *testing.T) {
	ts := newTestServer()
	defer ts.Close()

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

	client.Debug("debug message", M{"level": "debug"})
	client.Info("info message", M{"level": "info"})
	client.Warn("warn message", M{"level": "warn"})
	client.Error("error message", M{"level": "error"})

	logs := ts.getLogs()
	if len(logs) != 0 {
		t.Errorf("expected 0 logs before batch complete, got %d", len(logs))
	}

	client.Fatal("fatal message", M{"level": "fatal"})

	time.Sleep(100 * time.Millisecond)

	logs = ts.getLogs()
	if len(logs) != 5 {
		t.Errorf("expected 5 logs after batch complete, got %d", len(logs))
	}

	levels := make(map[LogLevel]bool)
	for _, log := range logs {
		levels[log.Level] = true
		if log.Service != "integration-test" {
			t.Errorf("Service = %q, want %q", log.Service, "integration-test")
		}
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

	client.Info("pre-shutdown message")

	err = client.Shutdown(context.Background())
	if err != nil {
		t.Fatalf("Shutdown() error = %v", err)
	}

	logs = ts.getLogs()
	if len(logs) != 8 {
		t.Errorf("expected 8 logs after shutdown, got %d", len(logs))
	}

	client.Info("post-shutdown message")
	time.Sleep(50 * time.Millisecond)

	logs = ts.getLogs()
	if len(logs) != 8 {
		t.Errorf("expected 8 logs after post-shutdown log, got %d", len(logs))
	}
}

func TestClientRequeueOnFailure(t *testing.T) {
	var errorCount int32

	ts := newTestServer()
	defer ts.Close()

	ts.setHandler(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "test error"})
	})

	client, err := New(
		ts.URL,
		validAPIKey(),
		WithBatchSize(100), // Large batch to prevent auto-flush
		WithFlushInterval(1*time.Minute),
		WithMaxRetries(0), // No retries to speed up test
		WithOnError(func(e *Error) {
			atomic.AddInt32(&errorCount, 1)
		}),
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer client.Shutdown(context.Background())

	client.Info("message 1")
	client.Info("message 2")
	client.Info("message 3")

	if client.queue.size() != 3 {
		t.Fatalf("expected 3 entries in queue, got %d", client.queue.size())
	}

	err = client.Flush(context.Background())
	if err == nil {
		t.Fatal("Flush() expected error")
	}

	if client.queue.size() != 3 {
		t.Fatalf("expected 3 entries re-queued after failure, got %d", client.queue.size())
	}

	if atomic.LoadInt32(&errorCount) != 1 {
		t.Fatalf("expected OnError to be called once, got %d", atomic.LoadInt32(&errorCount))
	}

	ts.setHandler(nil)

	err = client.Flush(context.Background())
	if err != nil {
		t.Fatalf("second Flush() error = %v", err)
	}

	logs := ts.getLogs()
	if len(logs) != 3 {
		t.Fatalf("expected 3 logs after recovery, got %d", len(logs))
	}

	if client.queue.size() != 0 {
		t.Fatalf("expected queue to be empty after successful flush, got %d", client.queue.size())
	}
}

func TestClientRequeueOrderOnFailure(t *testing.T) {
	ts := newTestServer()
	defer ts.Close()

	requestCount := 0
	ts.setHandler(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		if requestCount == 1 {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "first attempt fails"})
			return
		}
		var raw []map[string]any
		if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		var entries []LogEntry
		for _, item := range raw {
			entry, err := mapToLogEntry(item)
			if err != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			entries = append(entries, entry)
		}
		ts.mu.Lock()
		ts.requests = append(ts.requests, entries)
		ts.logs = append(ts.logs, entries...)
		ts.mu.Unlock()
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(IngestResponse{Accepted: len(entries)})
	})

	client, err := New(
		ts.URL,
		validAPIKey(),
		WithBatchSize(100),
		WithFlushInterval(1*time.Minute),
		WithMaxRetries(0),
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer client.Shutdown(context.Background())

	client.Info("first")
	client.Info("second")
	client.Info("third")

	_ = client.Flush(context.Background())

	err = client.Flush(context.Background())
	if err != nil {
		t.Fatalf("second Flush() error = %v", err)
	}

	logs := ts.getLogs()
	if len(logs) != 3 {
		t.Fatalf("expected 3 logs, got %d", len(logs))
	}
	if logs[0].Message != "first" {
		t.Errorf("first log message = %q, want %q", logs[0].Message, "first")
	}
	if logs[1].Message != "second" {
		t.Errorf("second log message = %q, want %q", logs[1].Message, "second")
	}
	if logs[2].Message != "third" {
		t.Errorf("third log message = %q, want %q", logs[2].Message, "third")
	}
}

// TestClientFlushChunksLargeBatch tests that a flush with more entries than
// BatchSize is split into multiple requests, each carrying at most BatchSize
// entries. This guards against the server-400 regression: the ingest endpoint
// rejects batches over its limit with a 400 batch_too_large, so a single
// oversized request would lose the whole flush.
func TestClientFlushChunksLargeBatch(t *testing.T) {
	ts := newTestServer()
	defer ts.Close()

	batchSize := 30
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

	total := 130
	for i := 0; i < total; i++ {
		client.queue.add(LogEntry{Level: LevelInfo, Message: fmt.Sprintf("message %d", i)})
	}

	err = client.Flush(context.Background())
	if err != nil {
		t.Fatalf("Flush() error = %v", err)
	}

	requests := ts.getRequests()
	if len(requests) != 5 {
		t.Fatalf("expected 5 requests, got %d", len(requests))
	}

	sent := 0
	for i, req := range requests {
		if len(req) > batchSize {
			t.Errorf("request %d has %d entries, want <= %d", i, len(req), batchSize)
		}
		sent += len(req)
	}
	if sent != total {
		t.Errorf("total entries sent = %d, want %d", sent, total)
	}

	logs := ts.getLogs()
	if len(logs) != total {
		t.Fatalf("expected %d logs, got %d", len(logs), total)
	}
	for i, log := range logs {
		want := fmt.Sprintf("message %d", i)
		if log.Message != want {
			t.Errorf("logs[%d].Message = %q, want %q", i, log.Message, want)
		}
	}
}

func TestClientFlushChunksRequeueOnFailure(t *testing.T) {
	ts := newTestServer()
	defer ts.Close()

	var requestCount int32
	ts.setHandler(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&requestCount, 1) == 2 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "batch too large"})
			return
		}
		var raw []map[string]any
		if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		var entries []LogEntry
		for _, item := range raw {
			entry, err := mapToLogEntry(item)
			if err != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			entries = append(entries, entry)
		}
		ts.mu.Lock()
		ts.requests = append(ts.requests, entries)
		ts.logs = append(ts.logs, entries...)
		ts.mu.Unlock()
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(IngestResponse{Accepted: len(entries)})
	})

	var errorCount int32
	client, err := New(
		ts.URL,
		validAPIKey(),
		WithBatchSize(30),
		WithFlushInterval(1*time.Minute),
		WithMaxRetries(0), // 400 is non-retryable anyway; keep the test fast
		WithOnError(func(e *Error) {
			atomic.AddInt32(&errorCount, 1)
		}),
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer client.Shutdown(context.Background())

	total := 130 // chunks: 30, 30, 30, 30, 10
	for i := 0; i < total; i++ {
		client.queue.add(LogEntry{Level: LevelInfo, Message: fmt.Sprintf("message %d", i)})
	}

	err = client.Flush(context.Background())
	if err == nil {
		t.Fatal("Flush() expected error for failed chunk")
	}
	logwellErr, ok := err.(*Error)
	if !ok || logwellErr.Code != ErrValidationError {
		t.Fatalf("error = %v, want VALIDATION_ERROR", err)
	}
	if got := atomic.LoadInt32(&requestCount); got != 2 {
		t.Fatalf("requests made = %d, want 2 (sending must stop on first chunk failure)", got)
	}
	if got := atomic.LoadInt32(&errorCount); got != 1 {
		t.Fatalf("OnError calls = %d, want 1", got)
	}

	if got := client.queue.size(); got != total-30 {
		t.Fatalf("queue size after failed flush = %d, want %d", got, total-30)
	}

	ts.setHandler(nil)
	err = client.Flush(context.Background())
	if err != nil {
		t.Fatalf("recovery Flush() error = %v", err)
	}

	logs := ts.getLogs()
	if len(logs) != total {
		t.Fatalf("expected %d logs after recovery, got %d", len(logs), total)
	}
	for i, log := range logs {
		want := fmt.Sprintf("message %d", i)
		if log.Message != want {
			t.Errorf("logs[%d].Message = %q, want %q", i, log.Message, want)
		}
	}
	if got := client.queue.size(); got != 0 {
		t.Errorf("queue size after recovery flush = %d, want 0", got)
	}
}

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

	client.Info("timer flush test")

	logs := ts.getLogs()
	if len(logs) != 0 {
		t.Errorf("expected 0 logs immediately, got %d", len(logs))
	}

	time.Sleep(flushInterval + 100*time.Millisecond)

	logs = ts.getLogs()
	if len(logs) != 1 {
		t.Errorf("expected 1 log after timer flush, got %d", len(logs))
	}
}

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
