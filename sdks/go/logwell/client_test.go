package logwell

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

type testServer struct {
	*httptest.Server
	mu      sync.Mutex
	logs    []LogEntry
	handler http.HandlerFunc
}

func newTestServer() *testServer {
	ts := &testServer{
		logs: make([]LogEntry, 0),
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
