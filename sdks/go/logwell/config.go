package logwell

import (
	"net/http"
	"net/url"
	"regexp"
	"time"
)

// Default configuration values.
const (
	DefaultBatchSize     = 10
	DefaultFlushInterval = 5 * time.Second
	DefaultMaxQueueSize  = 1000
	DefaultMaxRetries    = 3
)

// Validation bounds.
const (
	MinBatchSize     = 1
	MaxBatchSize     = 500
	MinFlushInterval = 100 * time.Millisecond
	MaxFlushInterval = 60 * time.Second
	MinMaxQueueSize  = 1
	MaxMaxQueueSize  = 10000
	MinMaxRetries    = 0
	MaxMaxRetries    = 10
)

// apiKeyRegex matches valid Logwell API keys: lw_ followed by 32+ alphanumeric chars including - and _.
var apiKeyRegex = regexp.MustCompile(`^lw_[a-zA-Z0-9_-]{32,}$`)

// Config holds all configuration options for the Logwell client.
type Config struct {
	// Endpoint is the Logwell server URL (required).
	Endpoint string

	// APIKey is the Logwell API key (required).
	APIKey string

	// Service is the service name to attach to all logs.
	Service string

	// Metadata is default metadata to attach to all logs.
	Metadata map[string]any

	// BatchSize is the number of logs to batch before sending.
	// Default: 10, Range: 1-500.
	BatchSize int

	// FlushInterval is the maximum time to wait before flushing.
	// Default: 5s, Range: 100ms-60s.
	FlushInterval time.Duration

	// MaxQueueSize is the maximum number of logs to hold in queue.
	// Default: 1000, Range: 1-10000.
	MaxQueueSize int

	// MaxRetries is the maximum number of retry attempts for failed requests.
	// Default: 3, Range: 0-10.
	MaxRetries int

	// CaptureSourceLocation enables capturing source file and line number.
	// Default: false.
	CaptureSourceLocation bool

	// HTTPClient is a custom HTTP client for making requests.
	// Default: http.DefaultClient.
	HTTPClient *http.Client

	// OnError is called when an error occurs during logging.
	OnError func(*Error)

	// OnFlush is called after a successful flush with the count of logs sent.
	OnFlush func(int)
}

// Option is a functional option for configuring the client.
type Option func(*Config)

// WithBatchSize sets the batch size for log batching.
// Must be between 1 and 500.
func WithBatchSize(n int) Option {
	return func(c *Config) {
		c.BatchSize = n
	}
}

// WithFlushInterval sets the maximum time to wait before flushing.
// Must be between 100ms and 60s.
func WithFlushInterval(d time.Duration) Option {
	return func(c *Config) {
		c.FlushInterval = d
	}
}

// WithMaxQueueSize sets the maximum queue size.
// Must be between 1 and 10000.
func WithMaxQueueSize(n int) Option {
	return func(c *Config) {
		c.MaxQueueSize = n
	}
}

// WithMaxRetries sets the maximum number of retry attempts.
// Must be between 0 and 10.
func WithMaxRetries(n int) Option {
	return func(c *Config) {
		c.MaxRetries = n
	}
}

// WithService sets the service name attached to all logs.
func WithService(s string) Option {
	return func(c *Config) {
		c.Service = s
	}
}

// WithMetadata sets default metadata attached to all logs.
func WithMetadata(m map[string]any) Option {
	return func(c *Config) {
		c.Metadata = m
	}
}

// WithOnError sets the error callback.
func WithOnError(fn func(*Error)) Option {
	return func(c *Config) {
		c.OnError = fn
	}
}

// WithOnFlush sets the flush callback.
func WithOnFlush(fn func(int)) Option {
	return func(c *Config) {
		c.OnFlush = fn
	}
}

// WithCaptureSourceLocation enables or disables source location capture.
func WithCaptureSourceLocation(enabled bool) Option {
	return func(c *Config) {
		c.CaptureSourceLocation = enabled
	}
}

// WithHTTPClient sets a custom HTTP client.
func WithHTTPClient(client *http.Client) Option {
	return func(c *Config) {
		c.HTTPClient = client
	}
}

// newDefaultConfig creates a Config with default values.
func newDefaultConfig(endpoint, apiKey string) *Config {
	return &Config{
		Endpoint:              endpoint,
		APIKey:                apiKey,
		BatchSize:             DefaultBatchSize,
		FlushInterval:         DefaultFlushInterval,
		MaxQueueSize:          DefaultMaxQueueSize,
		MaxRetries:            DefaultMaxRetries,
		CaptureSourceLocation: false,
		HTTPClient:            http.DefaultClient,
	}
}

// validateConfig validates the configuration and returns an error if invalid.
func validateConfig(c *Config) error {
	// Validate endpoint (required, must be valid URL with http or https)
	if c.Endpoint == "" {
		return NewError(ErrInvalidConfig, "endpoint is required")
	}
	parsedURL, err := url.Parse(c.Endpoint)
	if err != nil {
		return NewError(ErrInvalidConfig, "endpoint is not a valid URL: "+err.Error())
	}
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return NewError(ErrInvalidConfig, "endpoint must use http or https scheme")
	}
	if parsedURL.Host == "" {
		return NewError(ErrInvalidConfig, "endpoint must have a host")
	}

	// Validate API key (required, must match regex)
	if c.APIKey == "" {
		return NewError(ErrInvalidConfig, "apiKey is required")
	}
	if !apiKeyRegex.MatchString(c.APIKey) {
		return NewError(ErrInvalidConfig, "apiKey format invalid: must match lw_[a-zA-Z0-9_-]{32,}")
	}

	// Validate BatchSize
	if c.BatchSize < MinBatchSize || c.BatchSize > MaxBatchSize {
		return NewError(ErrInvalidConfig, "batchSize must be between 1 and 500")
	}

	// Validate FlushInterval
	if c.FlushInterval < MinFlushInterval || c.FlushInterval > MaxFlushInterval {
		return NewError(ErrInvalidConfig, "flushInterval must be between 100ms and 60s")
	}

	// Validate MaxQueueSize
	if c.MaxQueueSize < MinMaxQueueSize || c.MaxQueueSize > MaxMaxQueueSize {
		return NewError(ErrInvalidConfig, "maxQueueSize must be between 1 and 10000")
	}

	// Validate MaxRetries
	if c.MaxRetries < MinMaxRetries || c.MaxRetries > MaxMaxRetries {
		return NewError(ErrInvalidConfig, "maxRetries must be between 0 and 10")
	}

	return nil
}
