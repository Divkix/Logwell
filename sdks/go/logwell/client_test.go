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

// TestClientOnErrorReentrancyDoesNotDeadlock guards the documented use of
// OnError: a callback that logs through the same client must not self-deadlock
// on the client mutex, which would wedge every later log and Shutdown.
func TestClientOnErrorReentrancyDoesNotDeadlock(t *testing.T) {
	ts := newTestServer()
	defer ts.Close()

	var calls int32
	var reentered atomic.Bool

	var client *Client
	var err error
	client, err = New(
		ts.URL,
		validAPIKey(),
		WithMaxQueueSize(1),
		WithBatchSize(100),
		WithFlushInterval(time.Minute),
		WithOnError(func(e *Error) {
			atomic.AddInt32(&calls, 1)
			if e.Code != ErrQueueOverflow {
				t.Errorf("OnError code = %q, want %q", e.Code, ErrQueueOverflow)
			}
			if reentered.CompareAndSwap(false, true) {
				client.Info("logged from the OnError callback")
			}
		}),
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		client.Info("first")
		client.Info("second") // overflow → OnError → callback logs through the client
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Info() deadlocked: the OnError callback re-entered the client while its mutex was held")
	}

	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Errorf("OnError calls = %d, want 2 (overflow, then overflow from the callback)", got)
	}
}

// TestClientDropsNonRetryableBatch verifies that a chunk that can never be
// accepted (here: entries that fail to marshal) is dropped after OnError
// instead of being re-queued ahead of every later chunk forever.
func TestClientDropsNonRetryableBatch(t *testing.T) {
	ts := newTestServer()
	defer ts.Close()

	var errs []*Error
	var mu sync.Mutex

	client, err := New(
		ts.URL,
		validAPIKey(),
		WithBatchSize(1),
		WithFlushInterval(time.Minute),
		WithMaxRetries(0),
		WithOnError(func(e *Error) {
			mu.Lock()
			errs = append(errs, e)
			mu.Unlock()
		}),
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer client.Shutdown(context.Background())

	// Queued directly so the batch-size trigger cannot race the explicit flush.
	client.queue.add(LogEntry{Level: LevelInfo, Message: "poison", Metadata: M{"bad": make(chan int)}})
	client.queue.add(LogEntry{Level: LevelInfo, Message: "good"})

	if err := client.Flush(context.Background()); err != nil {
		t.Fatalf("Flush() error = %v, want nil (the undeliverable chunk must be dropped, not block the queue)", err)
	}

	logs := ts.getLogs()
	if len(logs) != 1 || logs[0].Message != "good" {
		t.Fatalf("delivered logs = %v, want only %q", logs, "good")
	}

	mu.Lock()
	defer mu.Unlock()
	if len(errs) != 1 || errs[0].Code != ErrValidationError {
		t.Fatalf("OnError errors = %v, want one %s for the dropped chunk", errs, ErrValidationError)
	}
}

// TestClientPartialRejection verifies that per-log rejections in a 200
// response are surfaced, and that OnFlush reports what the server accepted
// rather than what was submitted.
func TestClientPartialRejection(t *testing.T) {
	ts := newTestServer()
	defer ts.Close()

	ts.setHandler(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(IngestResponse{
			Accepted: 1,
			Rejected: 1,
			Errors:   []string{"message must not be blank"},
		})
	})

	var errs []*Error
	flushed := -1

	client, err := New(
		ts.URL,
		validAPIKey(),
		WithBatchSize(100),
		WithFlushInterval(time.Minute),
		WithOnError(func(e *Error) { errs = append(errs, e) }),
		WithOnFlush(func(count int) { flushed = count }),
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer client.Shutdown(context.Background())

	client.Info("ok")
	client.Info("   ")

	if err := client.Flush(context.Background()); err != nil {
		t.Fatalf("Flush() error = %v", err)
	}

	if flushed != 1 {
		t.Errorf("OnFlush count = %d, want 1 (accepted, not submitted)", flushed)
	}
	if len(errs) != 1 || errs[0].Code != ErrValidationError {
		t.Fatalf("OnError errors = %v, want one %s for the rejected log", errs, ErrValidationError)
	}
	if !strings.Contains(errs[0].Message, "message must not be blank") {
		t.Errorf("OnError message = %q, want the server's error detail", errs[0].Message)
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
