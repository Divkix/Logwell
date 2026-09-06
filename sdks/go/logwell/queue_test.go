package logwell

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestQueue_TimerFlush(t *testing.T) {
	var flushed int32
	flushFn := func() {
		atomic.AddInt32(&flushed, 1)
	}

	q := newBatchQueue(50*time.Millisecond, flushFn, 0, nil)

	q.add(LogEntry{Level: LevelInfo, Message: "test"})

	time.Sleep(100 * time.Millisecond)

	if atomic.LoadInt32(&flushed) != 1 {
		t.Errorf("flushed = %d, want 1", flushed)
	}
}

func TestQueue_OverflowDropsOldest(t *testing.T) {
	q := newBatchQueue(0, nil, 3, nil)

	q.add(LogEntry{Level: LevelInfo, Message: "first"})
	q.add(LogEntry{Level: LevelInfo, Message: "second"})
	q.add(LogEntry{Level: LevelInfo, Message: "third"})

	if q.size() != 3 {
		t.Errorf("size() = %d, want 3", q.size())
	}

	q.add(LogEntry{Level: LevelInfo, Message: "fourth"})

	if q.size() != 3 {
		t.Errorf("size() after overflow = %d, want 3", q.size())
	}

	entries := q.flush()

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

func TestQueue_Concurrency(t *testing.T) {
	q := newBatchQueue(0, nil, 0, nil)

	var wg sync.WaitGroup
	numGoroutines := 10
	entriesPerGoroutine := 100

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

func TestQueue_ConcurrentAddAndFlush(t *testing.T) {
	q := newBatchQueue(0, nil, 0, nil)

	var wg sync.WaitGroup
	var totalFlushed int32

	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 1000; i++ {
			q.add(LogEntry{Level: LevelInfo, Message: "test"})
		}
	}()

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

	remaining := q.flush()
	total := atomic.LoadInt32(&totalFlushed) + int32(len(remaining))

	if total != 1000 {
		t.Errorf("total entries = %d, want 1000", total)
	}
}
