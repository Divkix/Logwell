package logwell

import "time"

// LogLevel represents log severity levels matching the Logwell server.
type LogLevel string

// Log level constants.
const (
	LevelDebug LogLevel = "debug"
	LevelInfo  LogLevel = "info"
	LevelWarn  LogLevel = "warn"
	LevelError LogLevel = "error"
	LevelFatal LogLevel = "fatal"
)

// M is a shorthand for metadata maps.
type M map[string]any

// LogEntry represents a single log entry to be sent to Logwell.
type LogEntry struct {
	// Level is the log severity level (required).
	Level LogLevel `json:"level"`

	// Message is the log message content (required).
	Message string `json:"message"`

	// Timestamp is the ISO8601 timestamp. Auto-generated if not provided.
	Timestamp string `json:"timestamp,omitempty"`

	// Service is the service name for this log entry.
	Service string `json:"service,omitempty"`

	// Metadata contains arbitrary key-value data.
	Metadata M `json:"metadata,omitempty"`

	// SourceFile is the source file path where the log was called.
	SourceFile string `json:"sourceFile,omitempty"`

	// LineNumber is the line number where the log was called.
	LineNumber int `json:"lineNumber,omitempty"`
}

// IngestResponse represents the response from the Logwell ingest API.
type IngestResponse struct {
	// Accepted is the number of logs accepted.
	Accepted int `json:"accepted"`

	// Rejected is the number of logs rejected.
	Rejected int `json:"rejected,omitempty"`

	// Errors contains error messages for rejected logs.
	Errors []string `json:"errors,omitempty"`
}

// ingestRequest is the internal request structure for the ingest API.
type ingestRequest struct {
	Logs []LogEntry `json:"logs"`
}

// Now returns the current time formatted as ISO8601.
// Used internally for timestamp generation.
func now() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}
