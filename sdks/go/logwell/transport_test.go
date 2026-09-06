package logwell

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestTransport_ContextCancellation(t *testing.T) {
	var requestCount int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requestCount, 1)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "server error"})
	}))
	defer server.Close()

	transport := newHTTPTransport(server.URL, "test-api-key")
	logs := []LogEntry{{Level: LevelInfo, Message: "test"}}

	ctx, cancel := context.WithCancel(context.Background())

	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	_, err := transport.sendWithRetry(ctx, logs)
	if err == nil {
		t.Fatal("sendWithRetry() expected error for context cancellation, got nil")
	}

	logwellErr, ok := err.(*Error)
	if !ok {
		t.Fatalf("error type = %T, want *Error", err)
	}
	if logwellErr.Code != ErrNetworkError && logwellErr.Code != ErrServerError {
		t.Errorf("error code = %q, want ErrNetworkError or ErrServerError", logwellErr.Code)
	}

	count := atomic.LoadInt32(&requestCount)
	if count > 2 {
		t.Errorf("requestCount = %d, expected <= 2 (context should stop retries)", count)
	}
}

func TestTransport_MaxRetriesExhausted(t *testing.T) {
	var requestCount int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requestCount, 1)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "persistent failure"})
	}))
	defer server.Close()

	transport := newHTTPTransport(server.URL, "test-api-key")
	transport.maxRetries = 2 // Total 3 attempts (initial + 2 retries)
	logs := []LogEntry{{Level: LevelInfo, Message: "test"}}

	_, err := transport.sendWithRetry(context.Background(), logs)
	if err == nil {
		t.Fatal("sendWithRetry() expected error after exhausting retries, got nil")
	}

	logwellErr, ok := err.(*Error)
	if !ok {
		t.Fatalf("error type = %T, want *Error", err)
	}
	if logwellErr.Code != ErrServerError {
		t.Errorf("error code = %q, want %q", logwellErr.Code, ErrServerError)
	}

	expectedCount := int32(transport.maxRetries + 1)
	if atomic.LoadInt32(&requestCount) != expectedCount {
		t.Errorf("requestCount = %d, want %d", requestCount, expectedCount)
	}
}

func TestTransport_BackoffCalculation(t *testing.T) {
	transport := newHTTPTransport("http://example.com", "test-api-key")

	testCases := []struct {
		attempt      int
		expectedBase time.Duration
		minExpected  time.Duration
		maxExpected  time.Duration
	}{
		{1, 200 * time.Millisecond, 200 * time.Millisecond, 260 * time.Millisecond},
		{2, 400 * time.Millisecond, 400 * time.Millisecond, 520 * time.Millisecond},
		{3, 800 * time.Millisecond, 800 * time.Millisecond, 1040 * time.Millisecond},
		{10, 10 * time.Second, 10 * time.Second, 13 * time.Second},
	}

	for _, tc := range testCases {
		t.Run("attempt_"+string(rune('0'+tc.attempt)), func(t *testing.T) {
			for i := 0; i < 100; i++ {
				delay := transport.calculateBackoff(tc.attempt)

				if delay < tc.minExpected || delay > tc.maxExpected {
					t.Errorf("calculateBackoff(%d) = %v, expected in range [%v, %v]",
						tc.attempt, delay, tc.minExpected, tc.maxExpected)
				}
			}
		})
	}
}
