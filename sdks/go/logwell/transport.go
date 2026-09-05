package logwell

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"strings"
	"time"
)

const (
	defaultMaxRetries = 3
	baseRetryDelay    = 100 * time.Millisecond
	maxRetryDelay     = 10 * time.Second
	jitterFactor      = 0.3
)

type httpTransport struct {
	endpoint   string
	apiKey     string
	httpClient *http.Client
	ingestURL  string
	maxRetries int
}

func newHTTPTransport(endpoint, apiKey string) *httpTransport {
	return &httpTransport{
		endpoint:   endpoint,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 30 * time.Second},
		ingestURL:  strings.TrimRight(endpoint, "/") + "/v1/ingest",
		maxRetries: defaultMaxRetries,
	}
}

func newHTTPTransportFromConfig(cfg *Config) *httpTransport {
	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 30 * time.Second}
	} else if httpClient == http.DefaultClient || httpClient.Timeout == 0 {
		httpClient = &http.Client{
			Transport:     httpClient.Transport,
			CheckRedirect: httpClient.CheckRedirect,
			Jar:           httpClient.Jar,
			Timeout:       30 * time.Second,
		}
	}
	return &httpTransport{
		endpoint:   cfg.Endpoint,
		apiKey:     cfg.APIKey,
		httpClient: httpClient,
		ingestURL:  strings.TrimRight(cfg.Endpoint, "/") + "/v1/ingest",
		maxRetries: cfg.MaxRetries,
	}
}

func (t *httpTransport) sendWithRetry(ctx context.Context, logs []LogEntry) (*IngestResponse, error) {
	var lastErr error

	for attempt := 0; attempt <= t.maxRetries; attempt++ {
		if attempt > 0 {
			delay := t.calculateBackoff(attempt)
			select {
			case <-ctx.Done():
				return nil, NewErrorWithCause(ErrNetworkError, "context canceled during retry", ctx.Err())
			case <-time.After(delay):
			}
		}

		resp, err := t.send(ctx, logs)
		if err == nil {
			return resp, nil
		}

		lastErr = err

		if !t.isRetryableError(err) {
			return nil, err
		}

		if ctx.Err() != nil {
			return nil, NewErrorWithCause(ErrNetworkError, "context canceled", ctx.Err())
		}
	}

	return nil, lastErr
}

func (t *httpTransport) calculateBackoff(attempt int) time.Duration {
	delay := baseRetryDelay * (1 << attempt)

	if delay > maxRetryDelay {
		delay = maxRetryDelay
	}

	jitter := time.Duration(float64(delay) * jitterFactor * rand.Float64())
	delay += jitter

	return delay
}

func (t *httpTransport) isRetryableError(err error) bool {
	logwellErr, ok := err.(*Error)
	if !ok {
		return true
	}

	if logwellErr.StatusCode >= 400 && logwellErr.StatusCode < 500 && logwellErr.StatusCode != 429 {
		return false
	}

	switch logwellErr.Code {
	case ErrNetworkError:
		return true
	case ErrServerError:
		return true
	case ErrRateLimited:
		return true
	case ErrUnauthorized, ErrValidationError:
		return false
	default:
		return false
	}
}

func (t *httpTransport) send(ctx context.Context, logs []LogEntry) (*IngestResponse, error) {
	bodyBytes, err := json.Marshal(logs)
	if err != nil {
		return nil, NewErrorWithCause(ErrValidationError, "failed to marshal logs", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.ingestURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, NewErrorWithCause(ErrNetworkError, "failed to create request", err)
	}

	req.Header.Set("Authorization", "Bearer "+t.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := t.httpClient.Do(req)
	if err != nil {
		return nil, NewErrorWithCause(ErrNetworkError, "request failed", err)
	}
	defer func() { _ = resp.Body.Close() }()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, NewErrorWithCause(ErrNetworkError, "failed to read response", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		errorMsg := t.parseErrorMessage(respBody, resp.StatusCode)
		return nil, t.createError(resp.StatusCode, errorMsg)
	}

	var ingestResp IngestResponse
	if err := json.Unmarshal(respBody, &ingestResp); err != nil {
		return nil, NewErrorWithCause(ErrServerError, "failed to parse response", err)
	}

	return &ingestResp, nil
}

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
