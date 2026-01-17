package logwell

import "sync"

// batchQueue is a thread-safe queue for batching log entries.
// It holds entries until explicitly flushed or batch size is reached.
type batchQueue struct {
	entries []LogEntry
	mu      sync.Mutex
}

// newBatchQueue creates a new batch queue.
func newBatchQueue() *batchQueue {
	return &batchQueue{
		entries: make([]LogEntry, 0),
	}
}

// add appends a log entry to the queue.
func (q *batchQueue) add(entry LogEntry) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.entries = append(q.entries, entry)
}

// flush returns all queued entries and clears the queue.
func (q *batchQueue) flush() []LogEntry {
	q.mu.Lock()
	defer q.mu.Unlock()

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
