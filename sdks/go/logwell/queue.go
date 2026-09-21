package logwell

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

type batchQueue struct {
	entries []LogEntry
	mu      sync.Mutex

	flushInterval time.Duration
	flushFn       func()
	timer         *time.Timer
	generation    int64

	maxQueueSize int
}

func newBatchQueue(flushInterval time.Duration, flushFn func(), maxQueueSize int) *batchQueue {
	return &batchQueue{
		entries:       make([]LogEntry, 0),
		flushInterval: flushInterval,
		flushFn:       flushFn,
		maxQueueSize:  maxQueueSize,
	}
}

// add appends entry, dropping the oldest entry when the queue is full.
// A non-nil return means an entry was dropped; the caller reports it, so
// user callbacks never run while the queue or client lock is held.
func (q *batchQueue) add(entry LogEntry) *Error {
	q.mu.Lock()
	defer q.mu.Unlock()

	var overflowErr *Error
	if q.maxQueueSize > 0 && len(q.entries) >= q.maxQueueSize {
		q.entries = q.entries[1:]
		overflowErr = NewError(ErrQueueOverflow, "queue overflow: dropping oldest entry")
	}

	q.entries = append(q.entries, entry)

	q.startTimerLocked()

	return overflowErr
}

// prepend puts entries back at the head of the queue, dropping the oldest
// entries when the queue is full. A non-nil return means entries were dropped.
func (q *batchQueue) prepend(entries []LogEntry) *Error {
	q.mu.Lock()
	defer q.mu.Unlock()

	if len(entries) == 0 {
		return nil
	}

	combined := make([]LogEntry, 0, len(entries)+len(q.entries))
	combined = append(combined, entries...)
	combined = append(combined, q.entries...)
	var overflowErr *Error
	if q.maxQueueSize > 0 && len(combined) > q.maxQueueSize {
		dropped := len(combined) - q.maxQueueSize
		combined = combined[:q.maxQueueSize]
		overflowErr = NewError(ErrQueueOverflow, fmt.Sprintf("queue overflow: dropping %d oldest entries", dropped))
	}
	q.entries = combined

	q.startTimerLocked()

	return overflowErr
}

// startTimerLocked arms the auto-flush timer if it is not already running.
// The interval is a maximum wait, so entries added while a timer is pending
// must not push the deadline back.
func (q *batchQueue) startTimerLocked() {
	if q.flushInterval <= 0 || q.flushFn == nil {
		return
	}

	if q.timer != nil {
		return
	}

	gen := atomic.LoadInt64(&q.generation)
	flushFn := q.flushFn
	q.timer = time.AfterFunc(q.flushInterval, func() {
		if atomic.LoadInt64(&q.generation) != gen {
			return
		}
		flushFn()
	})
}

func (q *batchQueue) flush() []LogEntry {
	q.mu.Lock()
	defer q.mu.Unlock()

	if q.timer != nil {
		atomic.AddInt64(&q.generation, 1)
		q.timer.Stop()
		q.timer = nil
	}

	if len(q.entries) == 0 {
		return nil
	}

	entries := q.entries
	q.entries = make([]LogEntry, 0)

	return entries
}

func (q *batchQueue) size() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.entries)
}

func (q *batchQueue) stopTimer() {
	q.mu.Lock()
	defer q.mu.Unlock()
	atomic.AddInt64(&q.generation, 1)
	if q.timer != nil {
		q.timer.Stop()
		q.timer = nil
	}
}
