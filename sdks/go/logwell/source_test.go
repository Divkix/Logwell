package logwell

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestCaptureSource(t *testing.T) {
	t.Run("returns full file path not basename", func(t *testing.T) {
		file, line := captureSource(0)
		if file == "" {
			t.Fatal("captureSource returned empty file")
		}
		if line == 0 {
			t.Fatal("captureSource returned line 0")
		}

		// Should be full path, not just basename
		if file == filepath.Base(file) {
			t.Errorf("captureSource returned basename %q, want full path", file)
		}

		// Should contain path separators (absolute path)
		if !strings.Contains(file, string(filepath.Separator)) {
			t.Errorf("captureSource returned %q, expected absolute path with separators", file)
		}
	})

	t.Run("returns different paths for different files", func(t *testing.T) {
		// This test file's path should contain "source_test.go"
		// Use skip=1 to get the caller of captureSource (this test function)
		file, _ := captureSource(1)
		if !strings.HasSuffix(file, "source_test.go") {
			t.Errorf("expected path to end with source_test.go, got %q", file)
		}
	})
}
