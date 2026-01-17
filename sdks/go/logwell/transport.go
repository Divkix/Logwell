package logwell

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"time"
)

const (
	defaultMaxRetries = 3
	baseRetryDelay    = 100 * time.Millisecond
	maxRetryDelay     = 10 * time.Second
	jitterFactor      = 0.3 // 30% jitter
)

// httpTransport sends log batches to the Logwell server.
type httpTransport struct {
	endpoint   string
	apiKey     string
	httpClient *http.Client
	ingestURL  string
	maxRetries int
}

// newHTTPTransport creates a new HTTP transport.
func newHTTPTransport(endpoint, apiKey string) *httpTransport {
	return &httpTransport{
		endpoint:   endpoint,
		apiKey:     apiKey,
		httpClient: &http.Client{},
		ingestURL:  endpoint + "/v1/ingest",
		maxRetries: defaultMaxRetries,
	}
}

// sendWithRetry sends a batch with exponential backoff retry for transient errors.
// Network errors, 5xx, and 429 are retried. 400, 401, 403 are not.
func (t *httpTransport) sendWithRetry(ctx context.Context, logs []LogEntry) (*IngestResponse, error) {
	var lastErr error

	for attempt := 0; attempt <= t.maxRetries; attempt++ {
		// Wait before retry (skip on first attempt)
		if attempt > 0 {
			delay := t.calculateBackoff(attempt)
			select {
			case <-ctx.Done():
				return nil, NewErrorWithCause(ErrNetworkError, "context canceled during retry", ctx.Err())
			case <-time.After(delay):
				// Continue with retry
			}
		}

		resp, err := t.send(ctx, logs)
		if err == nil {
			return resp, nil
		}

		lastErr = err

		// Check if error is retryable
		if !t.isRetryableError(err) {
			return nil, err
		}

		// Context canceled - don't retry
		if ctx.Err() != nil {
			return nil, NewErrorWithCause(ErrNetworkError, "context canceled", ctx.Err())
		}
	}

	// All retries exhausted
	return nil, lastErr
}

// calculateBackoff computes delay with exponential backoff + jitter.
// Formula: min(baseDelay * 2^attempt, maxDelay) + 30% jitter
func (t *httpTransport) calculateBackoff(attempt int) time.Duration {
	// Exponential: baseDelay * 2^attempt
	delay := baseRetryDelay * (1 << attempt)

	// Cap at max delay
	if delay > maxRetryDelay {
		delay = maxRetryDelay
	}

	// Add jitter: +/- 30%
	jitter := time.Duration(float64(delay) * jitterFactor * (rand.Float64()*2 - 1))
	delay += jitter

	// Ensure non-negative
	if delay < 0 {
		delay = 0
	}

	return delay
}

// isRetryableError returns true if the error is transient and should be retried.
// Retryable: network errors, 5xx, 429 (rate limited)
// Non-retryable: 400 (validation), 401 (unauthorized), 403 (forbidden)
func (t *httpTransport) isRetryableError(err error) bool {
	logwellErr, ok := err.(*Error)
	if !ok {
		// Unknown error type - assume retryable (network issue)
		return true
	}

	// Check HTTP status code for explicit non-retryable cases
	// 4xx client errors (except 429) should not retry
	if logwellErr.StatusCode >= 400 && logwellErr.StatusCode < 500 && logwellErr.StatusCode != 429 {
		return false
	}

	switch logwellErr.Code {
	case ErrNetworkError:
		return true
	case ErrServerError:
		// 5xx server errors are retryable
		return true
	case ErrRateLimited:
		return true
	case ErrUnauthorized, ErrValidationError:
		return false
	default:
		// Unknown code - don't retry to be safe
		return false
	}
}

// send sends a batch of log entries to the Logwell server.
// Returns IngestResponse on success, or an Error on failure.
func (t *httpTransport) send(ctx context.Context, logs []LogEntry) (*IngestResponse, error) {
	// Build request body
	reqBody := ingestRequest{Logs: logs}
	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, NewErrorWithCause(ErrValidationError, "failed to marshal logs", err)
	}

	// Create HTTP request
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.ingestURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, NewErrorWithCause(ErrNetworkError, "failed to create request", err)
	}

	req.Header.Set("Authorization", "Bearer "+t.apiKey)
	req.Header.Set("Content-Type", "application/json")

	// Execute request
	resp, err := t.httpClient.Do(req)
	if err != nil {
		return nil, NewErrorWithCause(ErrNetworkError, "request failed", err)
	}
	defer resp.Body.Close()

	// Read response body
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, NewErrorWithCause(ErrNetworkError, "failed to read response", err)
	}

	// Handle error responses
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		errorMsg := t.parseErrorMessage(respBody, resp.StatusCode)
		return nil, t.createError(resp.StatusCode, errorMsg)
	}

	// Parse successful response
	var ingestResp IngestResponse
	if err := json.Unmarshal(respBody, &ingestResp); err != nil {
		return nil, NewErrorWithCause(ErrServerError, "failed to parse response", err)
	}

	return &ingestResp, nil
}

// parseErrorMessage tries to extract an error message from the response body.
func (t *httpTransport) parseErrorMessage(body []byte, statusCode int) string {
	var errResp struct {
		Message string `json:"message"`
		Error   string `json:"error"`
	}

	if err := json.Unmarshal(body, &errResp); err == nil {
		if errResp.Message != "" {
			return errResp.Message
		}
		if errResp.Error != "" {
			return errResp.Error
		}
	}

	return fmt.Sprintf("HTTP %d", statusCode)
}

// createError creates an appropriate Error based on HTTP status code.
func (t *httpTransport) createError(status int, message string) *Error {
	switch status {
	case 401:
		return NewErrorWithStatus(ErrUnauthorized, "unauthorized: "+message, status)
	case 400:
		return NewErrorWithStatus(ErrValidationError, "validation error: "+message, status)
	case 429:
		return NewErrorWithStatus(ErrRateLimited, "rate limited: "+message, status)
	default:
		if status >= 500 {
			return NewErrorWithStatus(ErrServerError, "server error: "+message, status)
		}
		return NewErrorWithStatus(ErrServerError, fmt.Sprintf("HTTP error %d: %s", status, message), status)
	}
}
