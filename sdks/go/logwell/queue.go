package logwell

import (
	"sync"
	"sync/atomic"
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
	generation    int64 // incremented on each timer stop/restart to detect stale callbacks

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
			// Start new timer with current generation
			gen := atomic.LoadInt64(&q.generation)
			flushFn := q.flushFn
			q.timer = time.AfterFunc(q.flushInterval, func() {
				if atomic.LoadInt64(&q.generation) != gen {
					return // stale callback, ignore
				}
				flushFn()
			})
		} else {
			// Reset existing timer
			q.timer.Reset(q.flushInterval)
		}
	}

	q.mu.Unlock()
}

// prepend adds entries to the front of the queue.
// Used to re-queue entries after a failed flush.
// Enforces maxQueueSize by truncating combined entries if needed.
// Starts or resets the flush timer if auto-flush is enabled.
func (q *batchQueue) prepend(entries []LogEntry) {
	q.mu.Lock()
	defer q.mu.Unlock()

	if len(entries) == 0 {
		return
	}

	// Prepend entries to the front: new slice = entries + existing
	combined := append(entries, q.entries...)
	if q.maxQueueSize > 0 && len(combined) > q.maxQueueSize {
		combined = combined[:q.maxQueueSize] // keep newest (prepended) entries
	}
	q.entries = combined

	// Start or reset the flush timer if auto-flush is enabled
	if q.flushInterval > 0 && q.flushFn != nil {
		if q.timer == nil {
			gen := atomic.LoadInt64(&q.generation)
			flushFn := q.flushFn
			q.timer = time.AfterFunc(q.flushInterval, func() {
				if atomic.LoadInt64(&q.generation) != gen {
					return // stale callback, ignore
				}
				flushFn()
			})
		} else {
			q.timer.Reset(q.flushInterval)
		}
	}
}

// flush returns all queued entries and clears the queue.
// Stops the flush timer if running.
func (q *batchQueue) flush() []LogEntry {
	q.mu.Lock()
	defer q.mu.Unlock()

	// Stop the flush timer if running; bump generation to invalidate stale callbacks
	if q.timer != nil {
		atomic.AddInt64(&q.generation, 1)
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
// Bumps the generation counter so any in-flight timer callbacks become no-ops.
// Used during shutdown to prevent timer fires after shutdown starts.
func (q *batchQueue) stopTimer() {
	q.mu.Lock()
	defer q.mu.Unlock()
	atomic.AddInt64(&q.generation, 1)
	if q.timer != nil {
		q.timer.Stop()
		q.timer = nil
	}
}
