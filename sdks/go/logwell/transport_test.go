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

// TestTransport_SuccessfulRequest tests that a 200 response succeeds without retry.
func TestTransport_SuccessfulRequest(t *testing.T) {
	var requestCount int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requestCount, 1)

		// Verify request headers
		if got := r.Header.Get("Authorization"); got != "Bearer test-api-key" {
			t.Errorf("Authorization header = %q, want %q", got, "Bearer test-api-key")
		}
		if got := r.Header.Get("Content-Type"); got != "application/json" {
			t.Errorf("Content-Type header = %q, want %q", got, "application/json")
		}

		// Verify request body
		var req ingestRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Errorf("failed to decode request body: %v", err)
		}
		if len(req.Logs) != 1 {
			t.Errorf("len(Logs) = %d, want 1", len(req.Logs))
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(IngestResponse{Accepted: 1})
	}))
	defer server.Close()

	transport := newHTTPTransport(server.URL, "test-api-key")
	logs := []LogEntry{{Level: LevelInfo, Message: "test message"}}

	resp, err := transport.sendWithRetry(context.Background(), logs)
	if err != nil {
		t.Fatalf("sendWithRetry() error = %v", err)
	}
	if resp.Accepted != 1 {
		t.Errorf("Accepted = %d, want 1", resp.Accepted)
	}
	if atomic.LoadInt32(&requestCount) != 1 {
		t.Errorf("requestCount = %d, want 1", requestCount)
	}
}

// TestTransport_RetryOn5xx tests that 5xx errors trigger retries.
func TestTransport_RetryOn5xx(t *testing.T) {
	testCases := []struct {
		name       string
		statusCode int
	}{
		{"500 Internal Server Error", http.StatusInternalServerError},
		{"502 Bad Gateway", http.StatusBadGateway},
		{"503 Service Unavailable", http.StatusServiceUnavailable},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			var requestCount int32

			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				count := atomic.AddInt32(&requestCount, 1)

				// Fail first 2 attempts, succeed on third
				if count < 3 {
					w.WriteHeader(tc.statusCode)
					json.NewEncoder(w).Encode(map[string]string{"error": "server error"})
					return
				}

				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(IngestResponse{Accepted: 1})
			}))
			defer server.Close()

			transport := newHTTPTransport(server.URL, "test-api-key")
			logs := []LogEntry{{Level: LevelInfo, Message: "test"}}

			resp, err := transport.sendWithRetry(context.Background(), logs)
			if err != nil {
				t.Fatalf("sendWithRetry() error = %v", err)
			}
			if resp.Accepted != 1 {
				t.Errorf("Accepted = %d, want 1", resp.Accepted)
			}
			if atomic.LoadInt32(&requestCount) != 3 {
				t.Errorf("requestCount = %d, want 3", requestCount)
			}
		})
	}
}

// TestTransport_RetryOn429 tests that 429 (rate limited) triggers retries.
func TestTransport_RetryOn429(t *testing.T) {
	var requestCount int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count := atomic.AddInt32(&requestCount, 1)

		// Rate limit first 2 attempts
		if count < 3 {
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(map[string]string{"error": "rate limited"})
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(IngestResponse{Accepted: 1})
	}))
	defer server.Close()

	transport := newHTTPTransport(server.URL, "test-api-key")
	logs := []LogEntry{{Level: LevelInfo, Message: "test"}}

	resp, err := transport.sendWithRetry(context.Background(), logs)
	if err != nil {
		t.Fatalf("sendWithRetry() error = %v", err)
	}
	if resp.Accepted != 1 {
		t.Errorf("Accepted = %d, want 1", resp.Accepted)
	}
	if atomic.LoadInt32(&requestCount) != 3 {
		t.Errorf("requestCount = %d, want 3 (should retry on 429)", requestCount)
	}
}

// TestTransport_NoRetryOn401 tests that 401 errors do NOT retry.
func TestTransport_NoRetryOn401(t *testing.T) {
	var requestCount int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requestCount, 1)
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
	}))
	defer server.Close()

	transport := newHTTPTransport(server.URL, "test-api-key")
	logs := []LogEntry{{Level: LevelInfo, Message: "test"}}

	_, err := transport.sendWithRetry(context.Background(), logs)
	if err == nil {
		t.Fatal("sendWithRetry() expected error for 401, got nil")
	}

	logwellErr, ok := err.(*Error)
	if !ok {
		t.Fatalf("error type = %T, want *Error", err)
	}
	if logwellErr.Code != ErrUnauthorized {
		t.Errorf("error code = %q, want %q", logwellErr.Code, ErrUnauthorized)
	}
	if logwellErr.StatusCode != 401 {
		t.Errorf("status code = %d, want 401", logwellErr.StatusCode)
	}
	if atomic.LoadInt32(&requestCount) != 1 {
		t.Errorf("requestCount = %d, want 1 (should NOT retry on 401)", requestCount)
	}
}

// TestTransport_NoRetryOn400 tests that 400 (validation error) does NOT retry.
func TestTransport_NoRetryOn400(t *testing.T) {
	var requestCount int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requestCount, 1)
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid log format"})
	}))
	defer server.Close()

	transport := newHTTPTransport(server.URL, "test-api-key")
	logs := []LogEntry{{Level: LevelInfo, Message: "test"}}

	_, err := transport.sendWithRetry(context.Background(), logs)
	if err == nil {
		t.Fatal("sendWithRetry() expected error for 400, got nil")
	}

	logwellErr, ok := err.(*Error)
	if !ok {
		t.Fatalf("error type = %T, want *Error", err)
	}
	if logwellErr.Code != ErrValidationError {
		t.Errorf("error code = %q, want %q", logwellErr.Code, ErrValidationError)
	}
	if logwellErr.StatusCode != 400 {
		t.Errorf("status code = %d, want 400", logwellErr.StatusCode)
	}
	if atomic.LoadInt32(&requestCount) != 1 {
		t.Errorf("requestCount = %d, want 1 (should NOT retry on 400)", requestCount)
	}
}

// TestTransport_RetryOnNetworkError tests retry on network-level errors.
func TestTransport_RetryOnNetworkError(t *testing.T) {
	// Create transport pointing to non-existent server (connection refused)
	transport := newHTTPTransport("http://127.0.0.1:1", "test-api-key")
	transport.maxRetries = 2 // Reduce retries to speed up test

	logs := []LogEntry{{Level: LevelInfo, Message: "test"}}

	start := time.Now()
	_, err := transport.sendWithRetry(context.Background(), logs)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("sendWithRetry() expected error for network failure, got nil")
	}

	logwellErr, ok := err.(*Error)
	if !ok {
		t.Fatalf("error type = %T, want *Error", err)
	}
	if logwellErr.Code != ErrNetworkError {
		t.Errorf("error code = %q, want %q", logwellErr.Code, ErrNetworkError)
	}

	// Should have taken some time due to retry backoff
	// With 2 retries: attempt 0 (immediate), attempt 1 (100ms backoff), attempt 2 (200ms backoff)
	// Minimum time should be > 100ms (at least one backoff)
	if elapsed < 50*time.Millisecond {
		t.Errorf("elapsed time %v suggests no retry backoff occurred", elapsed)
	}
}

// TestTransport_ContextCancellation tests that context cancellation stops retries.
func TestTransport_ContextCancellation(t *testing.T) {
	var requestCount int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requestCount, 1)
		// Always return 500 to trigger retry
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "server error"})
	}))
	defer server.Close()

	transport := newHTTPTransport(server.URL, "test-api-key")
	logs := []LogEntry{{Level: LevelInfo, Message: "test"}}

	// Create context that cancels after first request
	ctx, cancel := context.WithCancel(context.Background())

	// Cancel context after a short delay (during first backoff)
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

	// Should have made only 1-2 requests before context canceled during backoff
	count := atomic.LoadInt32(&requestCount)
	if count > 2 {
		t.Errorf("requestCount = %d, expected <= 2 (context should stop retries)", count)
	}
}

// TestTransport_MaxRetriesExhausted tests that errors are returned after max retries.
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

	// Should have made exactly maxRetries + 1 attempts
	expectedCount := int32(transport.maxRetries + 1)
	if atomic.LoadInt32(&requestCount) != expectedCount {
		t.Errorf("requestCount = %d, want %d", requestCount, expectedCount)
	}
}

// TestTransport_BackoffCalculation tests the exponential backoff formula.
func TestTransport_BackoffCalculation(t *testing.T) {
	transport := newHTTPTransport("http://example.com", "test-api-key")

	testCases := []struct {
		attempt       int
		expectedBase  time.Duration
		minExpected   time.Duration
		maxExpected   time.Duration
	}{
		// Attempt 1: 100ms * 2^1 = 200ms, +/- 30% = [140ms, 260ms]
		{1, 200 * time.Millisecond, 140 * time.Millisecond, 260 * time.Millisecond},
		// Attempt 2: 100ms * 2^2 = 400ms, +/- 30% = [280ms, 520ms]
		{2, 400 * time.Millisecond, 280 * time.Millisecond, 520 * time.Millisecond},
		// Attempt 3: 100ms * 2^3 = 800ms, +/- 30% = [560ms, 1040ms]
		{3, 800 * time.Millisecond, 560 * time.Millisecond, 1040 * time.Millisecond},
		// Attempt 10: capped at 10s, +/- 30% = [7s, 13s]
		{10, 10 * time.Second, 7 * time.Second, 13 * time.Second},
	}

	for _, tc := range testCases {
		t.Run("attempt_"+string(rune('0'+tc.attempt)), func(t *testing.T) {
			// Run multiple times to account for jitter randomness
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

// TestTransport_IsRetryableError tests error classification logic.
func TestTransport_IsRetryableError(t *testing.T) {
	transport := newHTTPTransport("http://example.com", "test-api-key")

	testCases := []struct {
		name      string
		err       error
		retryable bool
	}{
		{
			name:      "network error is retryable",
			err:       NewError(ErrNetworkError, "connection refused"),
			retryable: true,
		},
		{
			name:      "server error (5xx) is retryable",
			err:       NewErrorWithStatus(ErrServerError, "internal error", 500),
			retryable: true,
		},
		{
			name:      "rate limited (429) is retryable",
			err:       NewErrorWithStatus(ErrRateLimited, "too many requests", 429),
			retryable: true,
		},
		{
			name:      "unauthorized (401) is NOT retryable",
			err:       NewErrorWithStatus(ErrUnauthorized, "bad api key", 401),
			retryable: false,
		},
		{
			name:      "validation error (400) is NOT retryable",
			err:       NewErrorWithStatus(ErrValidationError, "invalid format", 400),
			retryable: false,
		},
		{
			name:      "403 forbidden is NOT retryable",
			err:       NewErrorWithStatus(ErrServerError, "forbidden", 403),
			retryable: false,
		},
		{
			name:      "unknown error type is retryable",
			err:       context.DeadlineExceeded,
			retryable: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			got := transport.isRetryableError(tc.err)
			if got != tc.retryable {
				t.Errorf("isRetryableError(%v) = %v, want %v", tc.err, got, tc.retryable)
			}
		})
	}
}

// TestTransport_ErrorMessageParsing tests that error messages are extracted from responses.
func TestTransport_ErrorMessageParsing(t *testing.T) {
	testCases := []struct {
		name           string
		responseBody   map[string]string
		statusCode     int
		expectedInMsg  string
	}{
		{
			name:          "message field",
			responseBody:  map[string]string{"message": "invalid API key"},
			statusCode:    401,
			expectedInMsg: "invalid API key",
		},
		{
			name:          "error field",
			responseBody:  map[string]string{"error": "rate limit exceeded"},
			statusCode:    429,
			expectedInMsg: "rate limit exceeded",
		},
		{
			name:          "empty body uses status code",
			responseBody:  nil,
			statusCode:    500,
			expectedInMsg: "HTTP 500",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.statusCode)
				if tc.responseBody != nil {
					json.NewEncoder(w).Encode(tc.responseBody)
				}
			}))
			defer server.Close()

			transport := newHTTPTransport(server.URL, "test-api-key")
			transport.maxRetries = 0 // No retries to speed up test
			logs := []LogEntry{{Level: LevelInfo, Message: "test"}}

			_, err := transport.sendWithRetry(context.Background(), logs)
			if err == nil {
				t.Fatal("expected error, got nil")
			}

			logwellErr, ok := err.(*Error)
			if !ok {
				t.Fatalf("error type = %T, want *Error", err)
			}

			if logwellErr.Message == "" {
				t.Error("error message is empty")
			}
		})
	}
}

// TestTransport_RequestBody tests that the request body is correctly formatted.
func TestTransport_RequestBody(t *testing.T) {
	var receivedBody ingestRequest

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&receivedBody); err != nil {
			t.Errorf("failed to decode body: %v", err)
		}
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(IngestResponse{Accepted: len(receivedBody.Logs)})
	}))
	defer server.Close()

	transport := newHTTPTransport(server.URL, "test-api-key")
	logs := []LogEntry{
		{Level: LevelInfo, Message: "message 1", Service: "svc1"},
		{Level: LevelError, Message: "message 2", Metadata: M{"key": "value"}},
	}

	resp, err := transport.sendWithRetry(context.Background(), logs)
	if err != nil {
		t.Fatalf("sendWithRetry() error = %v", err)
	}

	if resp.Accepted != 2 {
		t.Errorf("Accepted = %d, want 2", resp.Accepted)
	}

	if len(receivedBody.Logs) != 2 {
		t.Fatalf("len(receivedBody.Logs) = %d, want 2", len(receivedBody.Logs))
	}

	// Verify first log
	if receivedBody.Logs[0].Message != "message 1" {
		t.Errorf("Logs[0].Message = %q, want %q", receivedBody.Logs[0].Message, "message 1")
	}
	if receivedBody.Logs[0].Service != "svc1" {
		t.Errorf("Logs[0].Service = %q, want %q", receivedBody.Logs[0].Service, "svc1")
	}

	// Verify second log
	if receivedBody.Logs[1].Level != LevelError {
		t.Errorf("Logs[1].Level = %q, want %q", receivedBody.Logs[1].Level, LevelError)
	}
}
