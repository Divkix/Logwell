package logwell

import (
	"path/filepath"
	"runtime"
)

// captureSource captures the source file and line number at the call site.
// The skip parameter specifies how many stack frames to skip.
// Returns the base name of the file (not full path) and line number.
// If capture fails, returns empty string and 0.
func captureSource(skip int) (file string, line int) {
	_, file, line, ok := runtime.Caller(skip)
	if !ok {
		return "", 0
	}
	// Return just the base filename, not the full path
	return filepath.Base(file), line
}
