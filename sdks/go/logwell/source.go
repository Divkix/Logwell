package logwell

import (
	"runtime"
)

func captureSource(skip int) (file string, line int) {
	_, file, line, ok := runtime.Caller(skip)
	if !ok {
		return "", 0
	}
	return file, line
}
