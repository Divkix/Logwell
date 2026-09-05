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

	parent *Client

	mu       sync.Mutex
	shutdown bool

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
	cfg := newDefaultConfig(endpoint, apiKey)

	for _, opt := range opts {
		opt(cfg)
	}

	if err := validateConfig(cfg); err != nil {
		return nil, err
	}

	transport := newHTTPTransportFromConfig(cfg)

	c := &Client{
		config:    cfg,
		transport: transport,
	}

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
	cfg := &childConfig{}
	for _, opt := range opts {
		opt(cfg)
	}

	root := c
	if c.parent != nil {
		root = c.parent
	}

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
		Metadata:              mergeMetadata(c.config.Metadata, cfg.metadata),
	}

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
func (c *Client) Debug(message string, metadata ...map[string]any) {
	c.log(LevelDebug, message, metadata...)
}

// Info logs a message at INFO level.
func (c *Client) Info(message string, metadata ...map[string]any) {
	c.log(LevelInfo, message, metadata...)
}

// Warn logs a message at WARN level.
func (c *Client) Warn(message string, metadata ...map[string]any) {
	c.log(LevelWarn, message, metadata...)
}

// Error logs a message at ERROR level.
func (c *Client) Error(message string, metadata ...map[string]any) {
	c.log(LevelError, message, metadata...)
}

// Fatal logs a message at FATAL level.
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

	if c.config.CaptureSourceLocation && entry.SourceFile == "" {
		if file, line := captureSource(2); file != "" {
			entry.SourceFile = file
			entry.LineNumber = line
		}
	}

	if entry.Timestamp == "" {
		entry.Timestamp = now()
	}
	if entry.Service == "" {
		entry.Service = c.config.Service
	}
	entry.Metadata = mergeMetadata(c.config.Metadata, entry.Metadata)

	c.enqueue(entry)
}

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

	if c.config.CaptureSourceLocation {
		entry.SourceFile, entry.LineNumber = captureSource(3)
	}

	c.enqueue(entry)
}

func (c *Client) enqueue(entry LogEntry) {
	root := c
	if c.parent != nil {
		root = c.parent
	}

	root.mu.Lock()
	if root.shutdown {
		root.mu.Unlock()
		return
	}
	c.queue.add(entry)
	shouldFlush := c.queue.size() >= c.config.BatchSize
	if shouldFlush {
		root.flushWG.Add(1)
	}
	root.mu.Unlock()

	if shouldFlush {
		go func() {
			defer root.flushWG.Done()
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			_ = c.Flush(ctx)
		}()
	}
}

func (c *Client) flush() {
	entries := c.queue.flush()
	if len(entries) == 0 {
		return
	}

	ctx := context.Background()
	sent, err := c.flushChunks(ctx, entries)

	if err != nil {
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
		c.config.OnFlush(sent)
	}
}

func (c *Client) flushChunks(ctx context.Context, entries []LogEntry) (int, error) {
	batchSize := c.config.BatchSize
	if batchSize < 1 {
		batchSize = 1
	}

	sent := 0
	for i := 0; i < len(entries); i += batchSize {
		end := i + batchSize
		if end > len(entries) {
			end = len(entries)
		}
		chunk := entries[i:end]

		if _, err := c.transport.sendWithRetry(ctx, chunk); err != nil {
			c.queue.prepend(entries[i:])
			return sent, err
		}
		sent += len(chunk)
	}
	return sent, nil
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

	sent, err := c.flushChunks(ctx, entries)

	if err != nil {
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
		c.config.OnFlush(sent)
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
		return nil
	}
	c.shutdown = true
	c.mu.Unlock()

	if c.parent != nil {
		return nil
	}

	c.queue.stopTimer()

	done := make(chan struct{})
	go func() {
		c.flushWG.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-ctx.Done():
		return ctx.Err()
	}

	return c.Flush(ctx)
}

func mergeMetadata(maps ...map[string]any) map[string]any {
	if len(maps) == 0 {
		return nil
	}

	if len(maps) == 1 {
		if len(maps[0]) == 0 {
			return nil
		}
		return cloneMetadata(maps[0])
	}

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

func cloneMetadata(m map[string]any) map[string]any {
	clone := make(map[string]any, len(m))
	for k, v := range m {
		clone[k] = v
	}
	return clone
}
