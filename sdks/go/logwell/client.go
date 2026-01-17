package logwell

import (
	"context"
	"sync"
)

// Default configuration values.
const (
	defaultBatchSize = 10
)

// Client is the main entry point for sending logs to Logwell.
type Client struct {
	endpoint  string
	apiKey    string
	service   string
	batchSize int

	queue     *batchQueue
	transport *httpTransport

	mu sync.Mutex
}

// New creates a new Logwell client with the given endpoint and API key.
// Uses default settings: batchSize=10, service="".
func New(endpoint, apiKey string) *Client {
	queue := newBatchQueue()
	transport := newHTTPTransport(endpoint, apiKey)

	return &Client{
		endpoint:  endpoint,
		apiKey:    apiKey,
		batchSize: defaultBatchSize,
		queue:     queue,
		transport: transport,
	}
}

// Info logs a message at INFO level.
// Accepts optional metadata maps that will be merged (later maps override earlier).
func (c *Client) Info(message string, metadata ...map[string]any) {
	c.log(LevelInfo, message, metadata...)
}

// log is the internal logging method used by all level methods.
func (c *Client) log(level LogLevel, message string, metadata ...map[string]any) {
	entry := LogEntry{
		Level:     level,
		Message:   message,
		Timestamp: now(),
		Service:   c.service,
		Metadata:  mergeMetadata(metadata...),
	}

	c.mu.Lock()
	c.queue.add(entry)
	shouldFlush := c.queue.size() >= c.batchSize
	c.mu.Unlock()

	if shouldFlush {
		c.flush()
	}
}

// flush sends all queued log entries to the server.
func (c *Client) flush() {
	entries := c.queue.flush()
	if len(entries) == 0 {
		return
	}

	// Send logs (fire and forget for now, error handling added later)
	ctx := context.Background()
	_, _ = c.transport.send(ctx, entries)
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
