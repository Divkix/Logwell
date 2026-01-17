package logwell

import (
	"sync"
	"time"
)

// batchQueue is a thread-safe queue for batching log entries.
// It holds entries until explicitly flushed, batch size is reached,
// or flush interval elapses.
type batchQueue struct {
	entries []LogEntry
	mu      sync.Mutex

	// Timer-based auto-flush
	flushInterval time.Duration
	flushFn       func()
	timer         *time.Timer

	// Overflow protection
	maxQueueSize int
	onError      func(*Error)
}

// newBatchQueue creates a new batch queue with optional auto-flush and overflow protection.
// If flushInterval > 0 and flushFn is provided, the queue will
// automatically call flushFn after flushInterval of inactivity.
// If maxQueueSize > 0, the queue will drop oldest entries when capacity is reached.
func newBatchQueue(flushInterval time.Duration, flushFn func(), maxQueueSize int, onError func(*Error)) *batchQueue {
	return &batchQueue{
		entries:       make([]LogEntry, 0),
		flushInterval: flushInterval,
		flushFn:       flushFn,
		maxQueueSize:  maxQueueSize,
		onError:       onError,
	}
}

// add appends a log entry to the queue.
// If timer-based auto-flush is configured, starts or resets the timer.
// If the queue is at max capacity, drops the oldest entry and calls onError.
func (q *batchQueue) add(entry LogEntry) {
	q.mu.Lock()

	// Check for overflow - drop oldest entry if at max capacity
	if q.maxQueueSize > 0 && len(q.entries) >= q.maxQueueSize {
		// Drop oldest entry (FIFO)
		q.entries = q.entries[1:]

		// Call onError callback outside the lock to avoid deadlock
		if q.onError != nil {
			onError := q.onError
			q.mu.Unlock()
			onError(NewError(ErrQueueOverflow, "queue overflow: dropping oldest entry"))
			q.mu.Lock()
		}
	}

	q.entries = append(q.entries, entry)

	// Start or reset the flush timer if auto-flush is enabled
	if q.flushInterval > 0 && q.flushFn != nil {
		if q.timer == nil {
			// Start new timer
			q.timer = time.AfterFunc(q.flushInterval, q.flushFn)
		} else {
			// Reset existing timer
			q.timer.Reset(q.flushInterval)
		}
	}

	q.mu.Unlock()
}

// flush returns all queued entries and clears the queue.
// Stops the flush timer if running.
func (q *batchQueue) flush() []LogEntry {
	q.mu.Lock()
	defer q.mu.Unlock()

	// Stop the flush timer if running
	if q.timer != nil {
		q.timer.Stop()
		q.timer = nil
	}

	if len(q.entries) == 0 {
		return nil
	}

	// Take ownership of current entries
	entries := q.entries
	// Allocate new slice for future entries
	q.entries = make([]LogEntry, 0)

	return entries
}

// size returns the current number of entries in the queue.
func (q *batchQueue) size() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.entries)
}

// stopTimer stops the auto-flush timer if running.
// Used during shutdown to prevent timer fires after shutdown starts.
func (q *batchQueue) stopTimer() {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.timer != nil {
		q.timer.Stop()
		q.timer = nil
	}
}
