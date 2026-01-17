package logwell

import (
	"context"
	"sync"
)

// ErrClientShutdown is returned when attempting to log after shutdown.
var ErrClientShutdown = NewError(ErrValidationError, "client has been shut down")

// Client is the main entry point for sending logs to Logwell.
type Client struct {
	config *Config

	queue     *batchQueue
	transport *httpTransport

	// parent is set for child loggers; nil for root clients.
	// Child loggers share the parent's queue and transport.
	parent *Client

	mu       sync.Mutex
	shutdown bool
}

// ChildOption configures a child logger created via Client.Child().
type ChildOption func(*childConfig)

type childConfig struct {
	service  string
	metadata map[string]any
}

// ChildWithService sets the service name for the child logger.
// If not set, the child inherits the parent's service name.
func ChildWithService(service string) ChildOption {
	return func(c *childConfig) {
		c.service = service
	}
}

// ChildWithMetadata sets metadata for the child logger.
// This metadata is merged with the parent's metadata (child values override parent).
func ChildWithMetadata(metadata map[string]any) ChildOption {
	return func(c *childConfig) {
		c.metadata = metadata
	}
}

// New creates a new Logwell client with the given endpoint and API key.
// Returns an error if the configuration is invalid.
//
// Example:
//
//	client, err := logwell.New(
//	    "https://logs.example.com",
//	    "lw_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
//	    logwell.WithService("my-app"),
//	    logwell.WithBatchSize(50),
//	)
func New(endpoint, apiKey string, opts ...Option) (*Client, error) {
	// Create config with defaults
	cfg := newDefaultConfig(endpoint, apiKey)

	// Apply options
	for _, opt := range opts {
		opt(cfg)
	}

	// Validate config
	if err := validateConfig(cfg); err != nil {
		return nil, err
	}

	transport := newHTTPTransport(endpoint, apiKey)

	// Create client first so we can pass flush callback to queue
	c := &Client{
		config:    cfg,
		transport: transport,
	}

	// Create queue with timer-based auto-flush and overflow protection
	c.queue = newBatchQueue(cfg.FlushInterval, c.flush, cfg.MaxQueueSize, cfg.OnError)

	return c, nil
}

// Child creates a child logger that shares the parent's queue and transport.
// Child loggers inherit the parent's service name and metadata by default.
// Use ChildWithService to override the service name, and ChildWithMetadata
// to add additional metadata (which merges with and overrides parent metadata).
//
// Example:
//
//	child := client.Child(
//	    logwell.ChildWithService("payment-service"),
//	    logwell.ChildWithMetadata(map[string]any{"request_id": "abc123"}),
//	)
//	child.Info("Processing payment")
func (c *Client) Child(opts ...ChildOption) *Client {
	// Apply child options
	cfg := &childConfig{}
	for _, opt := range opts {
		opt(cfg)
	}

	// Determine the root client (for accessing queue/transport)
	root := c
	if c.parent != nil {
		root = c.parent
	}

	// Build child config
	childCfg := &Config{
		Endpoint:              c.config.Endpoint,
		APIKey:                c.config.APIKey,
		Service:               c.config.Service,
		BatchSize:             c.config.BatchSize,
		FlushInterval:         c.config.FlushInterval,
		MaxQueueSize:          c.config.MaxQueueSize,
		CaptureSourceLocation: c.config.CaptureSourceLocation,
		OnError:               c.config.OnError,
		// Merge parent metadata with child metadata (child overrides parent)
		Metadata: mergeMetadata(c.config.Metadata, cfg.metadata),
	}

	// Override service if specified
	if cfg.service != "" {
		childCfg.Service = cfg.service
	}

	return &Client{
		config:    childCfg,
		queue:     root.queue,
		transport: root.transport,
		parent:    root,
	}
}

// Debug logs a message at DEBUG level.
// Accepts optional metadata maps that will be merged (later maps override earlier).
func (c *Client) Debug(message string, metadata ...map[string]any) {
	c.log(LevelDebug, message, metadata...)
}

// Info logs a message at INFO level.
// Accepts optional metadata maps that will be merged (later maps override earlier).
func (c *Client) Info(message string, metadata ...map[string]any) {
	c.log(LevelInfo, message, metadata...)
}

// Warn logs a message at WARN level.
// Accepts optional metadata maps that will be merged (later maps override earlier).
func (c *Client) Warn(message string, metadata ...map[string]any) {
	c.log(LevelWarn, message, metadata...)
}

// Error logs a message at ERROR level.
// Accepts optional metadata maps that will be merged (later maps override earlier).
func (c *Client) Error(message string, metadata ...map[string]any) {
	c.log(LevelError, message, metadata...)
}

// Fatal logs a message at FATAL level.
// Accepts optional metadata maps that will be merged (later maps override earlier).
func (c *Client) Fatal(message string, metadata ...map[string]any) {
	c.log(LevelFatal, message, metadata...)
}

// Log sends a custom log entry directly.
// Use this when you need full control over the log entry.
// The entry's timestamp will be set to now if empty, and service will be set from config if empty.
// Returns without logging if the client has been shut down.
func (c *Client) Log(entry LogEntry) {
	c.mu.Lock()
	if c.shutdown {
		c.mu.Unlock()
		return
	}
	c.mu.Unlock()

	// Set defaults if not provided
	if entry.Timestamp == "" {
		entry.Timestamp = now()
	}
	if entry.Service == "" {
		entry.Service = c.config.Service
	}
	// Merge config metadata with entry metadata
	entry.Metadata = mergeMetadata(c.config.Metadata, entry.Metadata)

	c.mu.Lock()
	c.queue.add(entry)
	shouldFlush := c.queue.size() >= c.config.BatchSize
	c.mu.Unlock()

	if shouldFlush {
		c.flush()
	}
}

// log is the internal logging method used by all level methods.
// Returns without logging if the client has been shut down.
func (c *Client) log(level LogLevel, message string, metadata ...map[string]any) {
	c.mu.Lock()
	if c.shutdown {
		c.mu.Unlock()
		return
	}
	c.mu.Unlock()

	entry := LogEntry{
		Level:     level,
		Message:   message,
		Timestamp: now(),
		Service:   c.config.Service,
		Metadata:  mergeMetadata(c.config.Metadata, mergeMetadata(metadata...)),
	}

	// Capture source location if enabled
	// Skip 3 frames: captureSource -> log -> Debug/Info/Warn/Error/Fatal
	if c.config.CaptureSourceLocation {
		entry.SourceFile, entry.LineNumber = captureSource(3)
	}

	c.mu.Lock()
	c.queue.add(entry)
	shouldFlush := c.queue.size() >= c.config.BatchSize
	c.mu.Unlock()

	if shouldFlush {
		c.flush()
	}
}

// flush sends all queued log entries to the server.
// Internal method - does not respect context cancellation.
func (c *Client) flush() {
	entries := c.queue.flush()
	if len(entries) == 0 {
		return
	}

	// Send logs (fire and forget for now, error handling added later)
	ctx := context.Background()
	_, _ = c.transport.send(ctx, entries)
}

// Flush sends all queued log entries immediately.
// Respects context cancellation and timeout.
// Returns any error from the transport layer.
func (c *Client) Flush(ctx context.Context) error {
	entries := c.queue.flush()
	if len(entries) == 0 {
		return nil
	}

	_, err := c.transport.sendWithRetry(ctx, entries)
	return err
}

// Shutdown gracefully shuts down the client.
// It stops accepting new logs, flushes any remaining queued logs,
// and cleans up resources.
// Respects context cancellation and timeout.
// Returns any error from flushing remaining logs.
//
// For child loggers, Shutdown only marks the child as shut down;
// it does NOT affect the parent or other children. The parent must
// be shut down separately to flush remaining logs and stop the timer.
func (c *Client) Shutdown(ctx context.Context) error {
	c.mu.Lock()
	if c.shutdown {
		c.mu.Unlock()
		return nil // Already shut down
	}
	c.shutdown = true
	c.mu.Unlock()

	// Child loggers don't own the queue/transport, so they shouldn't
	// stop the timer or flush. Only mark themselves as shut down.
	if c.parent != nil {
		return nil
	}

	// Stop the queue timer to prevent further auto-flushes
	c.queue.stopTimer()

	// Flush remaining logs with context
	return c.Flush(ctx)
}

// mergeMetadata combines multiple metadata maps into one.
// Later maps override earlier ones for duplicate keys.
func mergeMetadata(maps ...map[string]any) map[string]any {
	if len(maps) == 0 {
		return nil
	}

	result := make(map[string]any)
	for _, m := range maps {
		for k, v := range m {
			result[k] = v
		}
	}

	if len(result) == 0 {
		return nil
	}

	return result
}
