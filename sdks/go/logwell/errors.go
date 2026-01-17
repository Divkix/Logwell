package logwell

import "fmt"

// ErrorCode represents the type of error that occurred.
type ErrorCode string

// Error code constants matching the TypeScript and Python SDKs.
const (
	// ErrNetworkError indicates a network-level failure (connection, timeout).
	// This error is retryable.
	ErrNetworkError ErrorCode = "NETWORK_ERROR"

	// ErrUnauthorized indicates invalid or missing API key.
	// This error is not retryable.
	ErrUnauthorized ErrorCode = "UNAUTHORIZED"

	// ErrValidationError indicates invalid log data.
	// This error is not retryable.
	ErrValidationError ErrorCode = "VALIDATION_ERROR"

	// ErrRateLimited indicates the API rate limit was exceeded.
	// This error is retryable.
	ErrRateLimited ErrorCode = "RATE_LIMITED"

	// ErrServerError indicates a server-side error (5xx).
	// This error is retryable.
	ErrServerError ErrorCode = "SERVER_ERROR"

	// ErrQueueOverflow indicates the local queue exceeded max size.
	// This error is not retryable.
	ErrQueueOverflow ErrorCode = "QUEUE_OVERFLOW"

	// ErrInvalidConfig indicates invalid client configuration.
	// This error is not retryable.
	ErrInvalidConfig ErrorCode = "INVALID_CONFIG"
)

// Error represents a Logwell SDK error.
type Error struct {
	// Code is the error classification code.
	Code ErrorCode

	// Message is the human-readable error message.
	Message string

	// StatusCode is the HTTP status code (0 if not applicable).
	StatusCode int

	// Retryable indicates whether this error can be retried.
	Retryable bool

	// Cause is the underlying error, if any.
	Cause error
}

// Error implements the error interface.
func (e *Error) Error() string {
	if e.StatusCode > 0 {
		return fmt.Sprintf("logwell: %s [%s] (status %d)", e.Message, e.Code, e.StatusCode)
	}
	return fmt.Sprintf("logwell: %s [%s]", e.Message, e.Code)
}

// Unwrap returns the underlying error for errors.Is/As support.
func (e *Error) Unwrap() error {
	return e.Cause
}

// NewError creates a new Error with the given code and message.
func NewError(code ErrorCode, message string) *Error {
	return &Error{
		Code:      code,
		Message:   message,
		Retryable: isRetryable(code),
	}
}

// NewErrorWithStatus creates a new Error with an HTTP status code.
func NewErrorWithStatus(code ErrorCode, message string, statusCode int) *Error {
	return &Error{
		Code:       code,
		Message:    message,
		StatusCode: statusCode,
		Retryable:  isRetryable(code),
	}
}

// NewErrorWithCause creates a new Error wrapping another error.
func NewErrorWithCause(code ErrorCode, message string, cause error) *Error {
	return &Error{
		Code:      code,
		Message:   message,
		Retryable: isRetryable(code),
		Cause:     cause,
	}
}

// isRetryable returns whether an error code indicates a retryable error.
func isRetryable(code ErrorCode) bool {
	switch code {
	case ErrNetworkError, ErrRateLimited, ErrServerError:
		return true
	default:
		return false
	}
}
