package logwell

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// httpTransport sends log batches to the Logwell server.
type httpTransport struct {
	endpoint   string
	apiKey     string
	httpClient *http.Client
	ingestURL  string
}

// newHTTPTransport creates a new HTTP transport.
func newHTTPTransport(endpoint, apiKey string) *httpTransport {
	return &httpTransport{
		endpoint:   endpoint,
		apiKey:     apiKey,
		httpClient: &http.Client{},
		ingestURL:  endpoint + "/v1/ingest",
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
