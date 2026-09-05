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
	onError      func(*Error)
}

func newBatchQueue(flushInterval time.Duration, flushFn func(), maxQueueSize int, onError func(*Error)) *batchQueue {
	return &batchQueue{
		entries:       make([]LogEntry, 0),
		flushInterval: flushInterval,
		flushFn:       flushFn,
		maxQueueSize:  maxQueueSize,
		onError:       onError,
	}
}

func (q *batchQueue) add(entry LogEntry) {
	q.mu.Lock()

	if q.maxQueueSize > 0 && len(q.entries) >= q.maxQueueSize {
		q.entries = q.entries[1:]

		if q.onError != nil {
			onError := q.onError
			q.mu.Unlock()
			onError(NewError(ErrQueueOverflow, "queue overflow: dropping oldest entry"))
			q.mu.Lock()
		}
	}

	q.entries = append(q.entries, entry)

	q.startTimerLocked()

	q.mu.Unlock()
}

func (q *batchQueue) prepend(entries []LogEntry) {
	q.mu.Lock()
	defer q.mu.Unlock()

	if len(entries) == 0 {
		return
	}

	combined := make([]LogEntry, 0, len(entries)+len(q.entries))
	combined = append(combined, entries...)
	combined = append(combined, q.entries...)
	if q.maxQueueSize > 0 && len(combined) > q.maxQueueSize {
		dropped := len(combined) - q.maxQueueSize
		combined = combined[:q.maxQueueSize]

		if q.onError != nil {
			onError := q.onError
			q.mu.Unlock()
			onError(NewError(ErrQueueOverflow, fmt.Sprintf("queue overflow: dropping %d oldest entries", dropped)))
			q.mu.Lock()
		}
	}
	q.entries = combined

	q.startTimerLocked()
}

func (q *batchQueue) startTimerLocked() {
	if q.flushInterval <= 0 || q.flushFn == nil {
		return
	}

	if q.timer != nil {
		atomic.AddInt64(&q.generation, 1)
		q.timer.Stop()
		q.timer = nil
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
