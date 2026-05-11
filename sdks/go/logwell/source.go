package logwell

import (
	"runtime"
)

// captureSource captures the source file and line number at the call site.
// The skip parameter specifies how many stack frames to skip.
// Returns the full file path and line number.
// If capture fails, returns empty string and 0.
func captureSource(skip int) (file string, line int) {
	_, file, line, ok := runtime.Caller(skip)
	if !ok {
		return "", 0
	}
	// Return the full path (aligned with TS/Python SDKs)
	return file, line
}
