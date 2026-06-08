package logwell

import (
	"context"
	"errors"
	"sync"
	"time"
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

	// flushWG tracks in-flight async flush goroutines so Shutdown can wait for them.
	flushWG sync.WaitGroup
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

	transport := newHTTPTransportFromConfig(cfg)

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
		OnFlush:               c.config.OnFlush,
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

	// Capture source location if enabled and not already set
	if c.config.CaptureSourceLocation && entry.SourceFile == "" {
		if file, line := captureSource(2); file != "" {
			entry.SourceFile = file
			entry.LineNumber = line
		}
	}

	// Set defaults if not provided
	if entry.Timestamp == "" {
		entry.Timestamp = now()
	}
	if entry.Service == "" {
		entry.Service = c.config.Service
	}
	// Merge config metadata with entry metadata
	entry.Metadata = mergeMetadata(c.config.Metadata, entry.Metadata)

	c.enqueue(entry)
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

	c.enqueue(entry)
}

// enqueue admits an entry into the shared root queue and, if the batch size is
// reached, spawns an async flush. Admission and flush-goroutine spawning are
// coordinated under the root's mutex and re-check the root's shutdown flag, so
// once Shutdown begins no new entries are admitted and no new flush goroutines
// are started (preventing races with flushWG.Wait()).
func (c *Client) enqueue(entry LogEntry) {
	root := c
	if c.parent != nil {
		root = c.parent
	}

	root.mu.Lock()
	// Re-check the root's shutdown flag under the same lock that guards the
	// enqueue and async-flush spawn. A child may still be active while the
	// shared root is shutting down; reject admission in that case.
	if root.shutdown {
		root.mu.Unlock()
		return
	}
	c.queue.add(entry)
	shouldFlush := c.queue.size() >= c.config.BatchSize
	if shouldFlush {
		// Register the in-flight flush while still holding root.mu so it is
		// guaranteed to be observed by Shutdown's flushWG.Wait().
		root.flushWG.Add(1)
	}
	root.mu.Unlock()

	if shouldFlush {
		go func() {
			defer root.flushWG.Done()
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			// Flush handles OnError callback internally; ignore the returned error here.
			_ = c.Flush(ctx)
		}()
	}
}

// flush sends all queued log entries to the server.
// Internal method - does not respect context cancellation.
// Calls OnFlush callback on success and OnError callback on failure.
func (c *Client) flush() {
	entries := c.queue.flush()
	if len(entries) == 0 {
		return
	}

	count := len(entries)

	// Send logs with retry
	ctx := context.Background()
	_, err := c.transport.sendWithRetry(ctx, entries)

	// Call callbacks (non-blocking)
	if err != nil {
		// Re-queue failed entries at the front for retry
		c.queue.prepend(entries)
		if c.config.OnError != nil {
			var logwellErr *Error
			if errors.As(err, &logwellErr) {
				c.config.OnError(logwellErr)
			} else {
				c.config.OnError(NewErrorWithCause(ErrNetworkError, "flush failed", err))
			}
		}
		return
	}

	if c.config.OnFlush != nil {
		c.config.OnFlush(count)
	}
}

// Flush sends all queued log entries immediately.
// Respects context cancellation and timeout.
// Calls OnFlush callback on success and OnError callback on failure.
// Returns any error from the transport layer.
func (c *Client) Flush(ctx context.Context) error {
	entries := c.queue.flush()
	if len(entries) == 0 {
		return nil
	}

	count := len(entries)
	_, err := c.transport.sendWithRetry(ctx, entries)

	// Call callbacks (non-blocking)
	if err != nil {
		// Re-queue failed entries at the front for retry
		c.queue.prepend(entries)
		if c.config.OnError != nil {
			var logwellErr *Error
			if errors.As(err, &logwellErr) {
				c.config.OnError(logwellErr)
			} else {
				c.config.OnError(NewErrorWithCause(ErrNetworkError, "flush failed", err))
			}
		}
		return err
	}

	if c.config.OnFlush != nil {
		c.config.OnFlush(count)
	}

	return nil
}

// Shutdown gracefully shuts down the client.
// It stops accepting new logs, flushes any remaining queued logs,
// and cleans up resources.
// Respects context cancellation and timeout.
// Returns any error from flushing remaining logs. A non-nil error
// means that some logs may not have been delivered to the server.
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

	// Wait for any in-flight async flush goroutines to complete, but respect
	// context cancellation/timeout so Shutdown does not block uninterruptibly.
	done := make(chan struct{})
	go func() {
		c.flushWG.Wait()
		close(done)
	}()
	select {
	case <-done:
		// All in-flight flushes completed.
	case <-ctx.Done():
		return ctx.Err()
	}

	// Flush remaining logs with context
	return c.Flush(ctx)
}

// mergeMetadata combines multiple metadata maps into one.
// Later maps override earlier ones for duplicate keys.
func mergeMetadata(maps ...map[string]any) map[string]any {
	if len(maps) == 0 {
		return nil
	}

	// Fast-path: single non-empty map. Clone it rather than returning the
	// caller's reference, to avoid aliasing/concurrent map access when the
	// entry is later JSON-marshaled.
	if len(maps) == 1 {
		if len(maps[0]) == 0 {
			return nil
		}
		return cloneMetadata(maps[0])
	}

	// Fast-path: two maps where the second (extra) is empty.
	if len(maps) == 2 && len(maps[1]) == 0 {
		if len(maps[0]) == 0 {
			return nil
		}
		return cloneMetadata(maps[0])
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

// cloneMetadata returns a shallow copy of m. m must be non-empty.
func cloneMetadata(m map[string]any) map[string]any {
	clone := make(map[string]any, len(m))
	for k, v := range m {
		clone[k] = v
	}
	return clone
}
