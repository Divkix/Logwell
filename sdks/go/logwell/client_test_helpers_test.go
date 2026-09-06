package logwell

import (
	"testing"
)

func assertLogCount(t *testing.T, logs []LogEntry, expected int) {
	t.Helper()

	if len(logs) != expected {
		t.Errorf("expected %d logs, got %d", expected, len(logs))
	}
}

func clearTestLogs(ts *testServer) {
	ts.mu.Lock()
	ts.logs = ts.logs[:0]
	ts.mu.Unlock()
}

