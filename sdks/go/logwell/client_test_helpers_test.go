package logwell

import (
	"testing"
	"time"
)

// assertConfigError asserts that an error is a Logwell Error with the expected code.
func assertConfigError(t *testing.T, err error, expectedCode ErrorCode) {
	t.Helper()

	if err == nil {
		t.Fatal("expected error, got nil")
	}

	logwellErr, ok := err.(*Error)
	if !ok {
		t.Fatalf("error type = %T, want *Error", err)
	}

	if logwellErr.Code != expectedCode {
		t.Errorf("error code = %q, want %q", logwellErr.Code, expectedCode)
	}
}

// assertLogCount asserts the number of logs received.
func assertLogCount(t *testing.T, logs []LogEntry, expected int) {
	t.Helper()

	if len(logs) != expected {
		t.Errorf("expected %d logs, got %d", expected, len(logs))
	}
}

// assertLogMetadata asserts that log metadata matches expected key-value pairs.
func assertLogMetadata(t *testing.T, log LogEntry, expected map[string]string) {
	t.Helper()

	for key, expectedValue := range expected {
		if actualValue, ok := log.Metadata[key]; !ok {
			t.Errorf("missing metadata key: %s", key)
		} else if actualValue != expectedValue {
			t.Errorf("Metadata[%s] = %v, want %q", key, actualValue, expectedValue)
		}
	}
}

// clearTestLogs clears the test server's log buffer.
func clearTestLogs(ts *testServer) {
	ts.mu.Lock()
	ts.logs = ts.logs[:0]
	ts.mu.Unlock()
}

// logAndWait sends a log entry and waits for it to be flushed.
func logAndWait(client *Client, ts *testServer, logFn func(string, ...map[string]any), message string, metadata ...map[string]any) LogEntry {
	clearTestLogs(ts)

	if len(metadata) > 0 {
		logFn(message, metadata...)
	} else {
		logFn(message)
	}

	time.Sleep(50 * time.Millisecond)

	logs := ts.getLogs()
	if len(logs) == 0 {
		return LogEntry{}
	}

	return logs[len(logs)-1]
}

// createTestClient creates a client with the given options and error handling.
func createTestClient(t *testing.T, ts *testServer, opts ...Option) *Client {
	t.Helper()

	client, err := New(ts.URL, validAPIKey(), opts...)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	if client == nil {
		t.Fatal("New() returned nil client")
	}

	return client
}

// childLogHelper creates a child logger, sends a log, and returns the received log entry.
func childLogHelper(t *testing.T, parent *Client, ts *testServer, childOpts []ChildOption, message string) LogEntry {
	t.Helper()

	var child *Client
	if len(childOpts) == 0 {
		child = parent.Child()
	} else {
		child = parent.Child(childOpts...)
	}

	clearTestLogs(ts)

	child.Info(message)
	time.Sleep(50 * time.Millisecond)

	logs := ts.getLogs()
	if len(logs) == 0 {
		t.Fatal("expected at least 1 log")
	}

	return logs[len(logs)-1]
}

// setupAndLogWithMetadata creates a client, clears logs, sends a log with metadata, and returns the received log.
func setupAndLogWithMetadata(t *testing.T, ts *testServer, clientOpts []Option, message string, metadata ...map[string]any) LogEntry {
	t.Helper()

	client, err := New(ts.URL, validAPIKey(), clientOpts...)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer client.Shutdown(nil)

	clearTestLogs(ts)

	if len(metadata) > 0 {
		client.Info(message, metadata...)
	} else {
		client.Info(message)
	}

	time.Sleep(50 * time.Millisecond)

	logs := ts.getLogs()
	if len(logs) == 0 {
		t.Fatal("expected at least 1 log")
	}

	return logs[len(logs)-1]
}
