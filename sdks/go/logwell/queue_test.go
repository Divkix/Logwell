package logwell

import (
    "sync"
    "sync/atomic"
    "testing"
    "time"
)

// TestQueue_BasicAdd tests that entries can be added to the queue.
func TestQueue_BasicAdd(t *testing.T) {
    q := newBatchQueue(0, nil, 0, nil)

    entry := LogEntry{Level: LevelInfo, Message: "test message"}
    q.add(entry)

    if q.size() != 1 {
        t.Errorf("size() = %d, want 1", q.size())
    }
}

// TestQueue_Flush tests that flush returns all entries and clears the queue.
func TestQueue_Flush(t *testing.T) {
    q := newBatchQueue(0, nil, 0, nil)

    q.add(LogEntry{Level: LevelInfo, Message: "message 1"})
    q.add(LogEntry{Level: LevelWarn, Message: "message 2"})
    q.add(LogEntry{Level: LevelError, Message: "message 3"})

    entries := q.flush()

    if len(entries) != 3 {
        t.Fatalf("len(entries) = %d, want 3", len(entries))
    }

    // Verify queue is cleared
    if q.size() != 0 {
        t.Errorf("size() after flush = %d, want 0", q.size())
    }

    // Verify entries are returned in FIFO order
    if entries[0].Message != "message 1" {
        t.Errorf("entries[0].Message = %q, want %q", entries[0].Message, "message 1")
    }
    if entries[1].Message != "message 2" {
        t.Errorf("entries[1].Message = %q, want %q", entries[1].Message, "message 2")
    }
    if entries[2].Message != "message 3" {
        t.Errorf("entries[2].Message = %q, want %q", entries[2].Message, "message 3")
    }
}

// TestQueue_FlushClearsQueue tests that flush leaves the queue empty.
func TestQueue_FlushClearsQueue(t *testing.T) {
    q := newBatchQueue(0, nil, 0, nil)

    q.add(LogEntry{Level: LevelInfo, Message: "test"})
    q.add(LogEntry{Level: LevelInfo, Message: "test2"})

    _ = q.flush()

    // Second flush should return nil
    entries := q.flush()
    if entries != nil {
        t.Errorf("second flush returned %d entries, want nil", len(entries))
    }
}

// TestQueue_EmptyFlush tests that flushing an empty queue returns nil.
func TestQueue_EmptyFlush(t *testing.T) {
    q := newBatchQueue(0, nil, 0, nil)

    entries := q.flush()
    if entries != nil {
        t.Errorf("flush() on empty queue = %v, want nil", entries)
    }
}

// TestQueue_Size tests that size returns the correct count.
func TestQueue_Size(t *testing.T) {
    q := newBatchQueue(0, nil, 0, nil)

    if q.size() != 0 {
        t.Errorf("initial size() = %d, want 0", q.size())
    }

    q.add(LogEntry{Level: LevelInfo, Message: "1"})
    if q.size() != 1 {
        t.Errorf("size() after 1 add = %d, want 1", q.size())
    }

    q.add(LogEntry{Level: LevelInfo, Message: "2"})
    q.add(LogEntry{Level: LevelInfo, Message: "3"})
    if q.size() != 3 {
        t.Errorf("size() after 3 adds = %d, want 3", q.size())
    }

    q.flush()
    if q.size() != 0 {
        t.Errorf("size() after flush = %d, want 0", q.size())
    }
}

// TestQueue_FIFO tests that entries are returned in FIFO order.
func TestQueue_FIFO(t *testing.T) {
    q := newBatchQueue(0, nil, 0, nil)

    for i := 0; i < 10; i++ {
        q.add(LogEntry{Level: LevelInfo, Message: string(rune('A' + i))})
    }

    entries := q.flush()
    if len(entries) != 10 {
        t.Fatalf("len(entries) = %d, want 10", len(entries))
    }

    for i := 0; i < 10; i++ {
        expected := string(rune('A' + i))
        if entries[i].Message != expected {
            t.Errorf("entries[%d].Message = %q, want %q", i, entries[i].Message, expected)
        }
    }
}

// TestQueue_TimerFlush tests that auto-flush fires after interval.
func TestQueue_TimerFlush(t *testing.T) {
    var flushed int32
    flushFn := func() {
        atomic.AddInt32(&flushed, 1)
    }

    // Use short interval for testing
    q := newBatchQueue(50*time.Millisecond, flushFn, 0, nil)

    q.add(LogEntry{Level: LevelInfo, Message: "test"})

    // Wait for timer to fire
    time.Sleep(100 * time.Millisecond)

    if atomic.LoadInt32(&flushed) != 1 {
        t.Errorf("flushed = %d, want 1", flushed)
    }
}

// TestQueue_TimerResetOnAdd tests that timer resets on each add.
func TestQueue_TimerResetOnAdd(t *testing.T) {
    var flushed int32
    flushFn := func() {
        atomic.AddInt32(&flushed, 1)
    }

    // Use interval that's long enough to add multiple entries
    q := newBatchQueue(80*time.Millisecond, flushFn, 0, nil)

    // Add first entry
    q.add(LogEntry{Level: LevelInfo, Message: "1"})

    // Wait less than interval then add another
    time.Sleep(40 * time.Millisecond)
    q.add(LogEntry{Level: LevelInfo, Message: "2"})

    // Wait less than interval then add another
    time.Sleep(40 * time.Millisecond)
    q.add(LogEntry{Level: LevelInfo, Message: "3"})

    // At this point, 80ms have passed but timer should have reset each time
    // so no flush should have occurred yet
    if atomic.LoadInt32(&flushed) != 0 {
        t.Errorf("flushed = %d, want 0 (timer should reset on add)", flushed)
    }

    // Wait for final timer to fire
    time.Sleep(100 * time.Millisecond)

    if atomic.LoadInt32(&flushed) != 1 {
        t.Errorf("flushed = %d, want 1", flushed)
    }
}

// TestQueue_TimerStopsOnFlush tests that manual flush stops the timer.
func TestQueue_TimerStopsOnFlush(t *testing.T) {
    var flushed int32
    flushFn := func() {
        atomic.AddInt32(&flushed, 1)
    }

    q := newBatchQueue(50*time.Millisecond, flushFn, 0, nil)

    q.add(LogEntry{Level: LevelInfo, Message: "test"})

    // Manually flush before timer fires
    _ = q.flush()

    // Wait long enough for timer to have fired if it wasn't stopped
    time.Sleep(100 * time.Millisecond)

    // Timer callback should not have been called since we flushed manually
    if atomic.LoadInt32(&flushed) != 0 {
        t.Errorf("flushed = %d, want 0 (timer should stop on manual flush)", flushed)
    }
}

// TestQueue_OverflowDropsOldest tests that overflow drops the oldest entry.
func TestQueue_OverflowDropsOldest(t *testing.T) {
    q := newBatchQueue(0, nil, 3, nil)

    q.add(LogEntry{Level: LevelInfo, Message: "first"})
    q.add(LogEntry{Level: LevelInfo, Message: "second"})
    q.add(LogEntry{Level: LevelInfo, Message: "third"})

    // Queue is at capacity (3)
    if q.size() != 3 {
        t.Errorf("size() = %d, want 3", q.size())
    }

    // Add fourth entry - should drop "first"
    q.add(LogEntry{Level: LevelInfo, Message: "fourth"})

    if q.size() != 3 {
        t.Errorf("size() after overflow = %d, want 3", q.size())
    }

    entries := q.flush()

    // Should have: second, third, fourth (first was dropped)
    if len(entries) != 3 {
        t.Fatalf("len(entries) = %d, want 3", len(entries))
    }

    if entries[0].Message != "second" {
        t.Errorf("entries[0].Message = %q, want %q", entries[0].Message, "second")
    }
    if entries[1].Message != "third" {
        t.Errorf("entries[1].Message = %q, want %q", entries[1].Message, "third")
    }
    if entries[2].Message != "fourth" {
        t.Errorf("entries[2].Message = %q, want %q", entries[2].Message, "fourth")
    }
}

// TestQueue_OverflowCallsOnError tests that overflow calls the error callback.
func TestQueue_OverflowCallsOnError(t *testing.T) {
    var errorCount int32
    var lastError *Error

    onError := func(err *Error) {
        atomic.AddInt32(&errorCount, 1)
        lastError = err
    }

    q := newBatchQueue(0, nil, 2, onError)

    q.add(LogEntry{Level: LevelInfo, Message: "first"})
    q.add(LogEntry{Level: LevelInfo, Message: "second"})

    // Queue is at capacity
    if atomic.LoadInt32(&errorCount) != 0 {
        t.Errorf("errorCount = %d, want 0 (no overflow yet)", errorCount)
    }

    // This should trigger overflow
    q.add(LogEntry{Level: LevelInfo, Message: "third"})

    if atomic.LoadInt32(&errorCount) != 1 {
        t.Errorf("errorCount = %d, want 1", errorCount)
    }
    if lastError == nil {
        t.Fatal("lastError = nil, want error")
    }
    if lastError.Code != ErrQueueOverflow {
        t.Errorf("lastError.Code = %q, want %q", lastError.Code, ErrQueueOverflow)
    }
}

// TestQueue_OverflowMultiple tests multiple overflows in sequence.
func TestQueue_OverflowMultiple(t *testing.T) {
    var errorCount int32

    onError := func(err *Error) {
        atomic.AddInt32(&errorCount, 1)
    }

    q := newBatchQueue(0, nil, 2, onError)

    // Add 5 entries to queue with capacity 2
    q.add(LogEntry{Level: LevelInfo, Message: "1"})
    q.add(LogEntry{Level: LevelInfo, Message: "2"})
    q.add(LogEntry{Level: LevelInfo, Message: "3"}) // overflow 1
    q.add(LogEntry{Level: LevelInfo, Message: "4"}) // overflow 2
    q.add(LogEntry{Level: LevelInfo, Message: "5"}) // overflow 3

    if atomic.LoadInt32(&errorCount) != 3 {
        t.Errorf("errorCount = %d, want 3", errorCount)
    }

    if q.size() != 2 {
        t.Errorf("size() = %d, want 2", q.size())
    }

    entries := q.flush()
    // Should have last 2 entries: 4 and 5
    if entries[0].Message != "4" {
        t.Errorf("entries[0].Message = %q, want %q", entries[0].Message, "4")
    }
    if entries[1].Message != "5" {
        t.Errorf("entries[1].Message = %q, want %q", entries[1].Message, "5")
    }
}

// TestQueue_NoTimerWhenNotConfigured tests that no timer fires when interval is 0.
func TestQueue_NoTimerWhenNotConfigured(t *testing.T) {
    var flushed int32
    flushFn := func() {
        atomic.AddInt32(&flushed, 1)
    }

    // Zero interval means no timer
    q := newBatchQueue(0, flushFn, 0, nil)

    q.add(LogEntry{Level: LevelInfo, Message: "test"})

    time.Sleep(50 * time.Millisecond)

    if atomic.LoadInt32(&flushed) != 0 {
        t.Errorf("flushed = %d, want 0 (no timer should fire)", flushed)
    }
}

// TestQueue_NoTimerWithNilFlushFn tests that no timer fires when flushFn is nil.
func TestQueue_NoTimerWithNilFlushFn(t *testing.T) {
    // Interval set but no flushFn - should not panic
    q := newBatchQueue(50*time.Millisecond, nil, 0, nil)

    q.add(LogEntry{Level: LevelInfo, Message: "test"})

    time.Sleep(100 * time.Millisecond)

    // Just verify no panic occurred
    if q.size() != 1 {
        t.Errorf("size() = %d, want 1", q.size())
    }
}

// TestQueue_StopTimer tests the stopTimer method.
func TestQueue_StopTimer(t *testing.T) {
    var flushed int32
    flushFn := func() {
        atomic.AddInt32(&flushed, 1)
    }

    q := newBatchQueue(50*time.Millisecond, flushFn, 0, nil)

    q.add(LogEntry{Level: LevelInfo, Message: "test"})

    // Stop timer before it fires
    q.stopTimer()

    time.Sleep(100 * time.Millisecond)

    if atomic.LoadInt32(&flushed) != 0 {
        t.Errorf("flushed = %d, want 0 (timer should be stopped)", flushed)
    }

    // Queue should still have the entry
    if q.size() != 1 {
        t.Errorf("size() = %d, want 1", q.size())
    }
}

// TestQueue_Concurrency tests thread safety of queue operations.
func TestQueue_Concurrency(t *testing.T) {
    q := newBatchQueue(0, nil, 0, nil)

    var wg sync.WaitGroup
    numGoroutines := 10
    entriesPerGoroutine := 100

    // Concurrently add entries
    for i := 0; i < numGoroutines; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for j := 0; j < entriesPerGoroutine; j++ {
                q.add(LogEntry{Level: LevelInfo, Message: "test"})
            }
        }(i)
    }

    wg.Wait()

    expectedSize := numGoroutines * entriesPerGoroutine
    if q.size() != expectedSize {
        t.Errorf("size() = %d, want %d", q.size(), expectedSize)
    }

    entries := q.flush()
    if len(entries) != expectedSize {
        t.Errorf("len(entries) = %d, want %d", len(entries), expectedSize)
    }
}

// TestQueue_ConcurrentAddAndFlush tests concurrent adds and flushes.
func TestQueue_ConcurrentAddAndFlush(t *testing.T) {
    q := newBatchQueue(0, nil, 0, nil)

    var wg sync.WaitGroup
    var totalFlushed int32

    // Goroutine adding entries
    wg.Add(1)
    go func() {
        defer wg.Done()
        for i := 0; i < 1000; i++ {
            q.add(LogEntry{Level: LevelInfo, Message: "test"})
        }
    }()

    // Goroutine flushing
    wg.Add(1)
    go func() {
        defer wg.Done()
        for i := 0; i < 100; i++ {
            entries := q.flush()
            atomic.AddInt32(&totalFlushed, int32(len(entries)))
            time.Sleep(1 * time.Millisecond)
        }
    }()

    wg.Wait()

    // Final flush to get remaining
    remaining := q.flush()
    total := atomic.LoadInt32(&totalFlushed) + int32(len(remaining))

    if total != 1000 {
        t.Errorf("total entries = %d, want 1000", total)
    }
}

// TestQueue_FlushPreservesEntryData tests that flush preserves all entry fields.
func TestQueue_FlushPreservesEntryData(t *testing.T) {
    q := newBatchQueue(0, nil, 0, nil)

    timestamp := "2024-01-16T12:00:00.000Z"
    entry := LogEntry{
        Level:      LevelError,
        Message:    "test error",
        Service:    "test-service",
        Timestamp:  timestamp,
        SourceFile: "test.go",
        LineNumber: 42,
        Metadata:   M{"key": "value", "count": 123},
    }

    q.add(entry)

    entries := q.flush()
    if len(entries) != 1 {
        t.Fatalf("len(entries) = %d, want 1", len(entries))
    }

    got := entries[0]

    if got.Level != LevelError {
        t.Errorf("Level = %q, want %q", got.Level, LevelError)
    }
    if got.Message != "test error" {
        t.Errorf("Message = %q, want %q", got.Message, "test error")
    }
    if got.Service != "test-service" {
        t.Errorf("Service = %q, want %q", got.Service, "test-service")
    }
    if got.Timestamp != timestamp {
        t.Errorf("Timestamp = %v, want %v", got.Timestamp, timestamp)
    }
    if got.SourceFile != "test.go" {
        t.Errorf("SourceFile = %q, want %q", got.SourceFile, "test.go")
    }
    if got.LineNumber != 42 {
        t.Errorf("LineNumber = %d, want 42", got.LineNumber)
    }
    if got.Metadata["key"] != "value" {
        t.Errorf("Metadata[key] = %v, want %q", got.Metadata["key"], "value")
    }
    if got.Metadata["count"] != 123 {
        t.Errorf("Metadata[count] = %v, want 123", got.Metadata["count"])
    }
}

// TestQueue_MultipleAddsFollowedByFlush tests adding many entries then flushing.
func TestQueue_MultipleAddsFollowedByFlush(t *testing.T) {
    q := newBatchQueue(0, nil, 0, nil)

    // Add 100 entries
    for i := 0; i < 100; i++ {
        q.add(LogEntry{Level: LevelInfo, Message: "entry"})
    }

    if q.size() != 100 {
        t.Errorf("size() = %d, want 100", q.size())
    }

    entries := q.flush()
    if len(entries) != 100 {
        t.Errorf("len(entries) = %d, want 100", len(entries))
    }

    if q.size() != 0 {
        t.Errorf("size() after flush = %d, want 0", q.size())
    }
}

// TestQueue_OverflowNoCallback tests overflow behavior when no callback is set.
func TestQueue_OverflowNoCallback(t *testing.T) {
    // No onError callback
    q := newBatchQueue(0, nil, 2, nil)

    q.add(LogEntry{Level: LevelInfo, Message: "first"})
    q.add(LogEntry{Level: LevelInfo, Message: "second"})
    q.add(LogEntry{Level: LevelInfo, Message: "third"}) // overflow

    // Should not panic and should still drop oldest
    if q.size() != 2 {
        t.Errorf("size() = %d, want 2", q.size())
    }

    entries := q.flush()
    if entries[0].Message != "second" {
        t.Errorf("entries[0].Message = %q, want %q", entries[0].Message, "second")
    }
    if entries[1].Message != "third" {
        t.Errorf("entries[1].Message = %q, want %q", entries[1].Message, "third")
    }
}

// TestQueue_TimerAfterFlush tests that new entries after flush start a new timer.
func TestQueue_TimerAfterFlush(t *testing.T) {
    var flushed int32
    flushFn := func() {
        atomic.AddInt32(&flushed, 1)
    }

    q := newBatchQueue(50*time.Millisecond, flushFn, 0, nil)

    // First add and flush
    q.add(LogEntry{Level: LevelInfo, Message: "first"})
    q.flush()

    // Add another entry - should start new timer
    q.add(LogEntry{Level: LevelInfo, Message: "second"})

    // Wait for timer
    time.Sleep(100 * time.Millisecond)

    if atomic.LoadInt32(&flushed) != 1 {
        t.Errorf("flushed = %d, want 1", flushed)
    }
}
