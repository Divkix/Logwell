import { beforeEach, describe, expect, it } from 'vitest';
import { type ClientLog, createLogStreamStore } from '../logs.svelte';

/**
 * Helper function to create sample logs for testing
 */
function createSampleLog(overrides: Partial<ClientLog> = {}): ClientLog {
  return {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    projectId: 'project-1',
    level: 'info',
    message: 'Test log message',
    metadata: null,
    incidentId: null,
    fingerprint: null,
    serviceName: null,
    sourceFile: null,
    lineNumber: null,
    requestId: null,
    userId: null,
    ipAddress: null,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Helper function to create multiple logs with unique IDs
 */
function createSampleLogs(count: number, overrides: Partial<ClientLog> = {}): ClientLog[] {
  return Array.from({ length: count }, (_, i) =>
    createSampleLog({
      id: `log-${i + 1}`,
      message: `Log message ${i + 1}`,
      ...overrides,
    }),
  );
}

describe('Log Stream Store', () => {
  let store: ReturnType<typeof createLogStreamStore>;

  beforeEach(() => {
    store = createLogStreamStore();
  });

  describe('initialization', () => {
    it('initializes with empty logs array', () => {
      expect(store.logs).toEqual([]);
    });

    it('initializes with null projectId', () => {
      expect(store.projectId).toBeNull();
    });

    it('initializes with default maxLogs of 1000', () => {
      expect(store.maxLogs).toBe(1000);
    });

    it('accepts custom maxLogs limit', () => {
      const customStore = createLogStreamStore({ maxLogs: 500 });
      expect(customStore.maxLogs).toBe(500);
    });
  });

  describe('addLogs', () => {
    it('adds logs to empty store', () => {
      const logs = createSampleLogs(3);
      store.addLogs(logs);

      expect(store.logs).toHaveLength(3);
    });

    it('prepends new logs to existing logs', () => {
      const initialLogs = createSampleLogs(2, { message: 'Initial' });
      const newLogs = createSampleLogs(2, { message: 'New' });

      store.addLogs(initialLogs);
      store.addLogs(newLogs);

      // New logs should be at the beginning
      expect(store.logs).toHaveLength(4);
      expect(store.logs[0].message).toBe('New');
      expect(store.logs[1].message).toBe('New');
      expect(store.logs[2].message).toBe('Initial');
      expect(store.logs[3].message).toBe('Initial');
    });

    it('maintains maxLogs limit when adding logs', () => {
      const store = createLogStreamStore({ maxLogs: 5 });

      // Add 3 logs
      store.addLogs(createSampleLogs(3));
      expect(store.logs).toHaveLength(3);

      // Add 4 more logs (total would be 7, but max is 5)
      store.addLogs(createSampleLogs(4));
      expect(store.logs).toHaveLength(5);
    });

    it('keeps newest logs when exceeding maxLogs', () => {
      const store = createLogStreamStore({ maxLogs: 3 });

      // Add initial logs with IDs log-1, log-2, log-3
      store.addLogs([
        createSampleLog({ id: 'old-1' }),
        createSampleLog({ id: 'old-2' }),
        createSampleLog({ id: 'old-3' }),
      ]);

      // Add new logs that will push out old ones
      store.addLogs([createSampleLog({ id: 'new-1' }), createSampleLog({ id: 'new-2' })]);

      // Should have new-1, new-2, old-1 (oldest logs trimmed)
      expect(store.logs).toHaveLength(3);
      expect(store.logs[0].id).toBe('new-1');
      expect(store.logs[1].id).toBe('new-2');
      expect(store.logs[2].id).toBe('old-1');
    });

    it('handles adding single log', () => {
      const log = createSampleLog();
      store.addLogs([log]);

      expect(store.logs).toHaveLength(1);
      expect(store.logs[0]).toEqual(log);
    });

    it('handles adding empty array', () => {
      store.addLogs([]);
      expect(store.logs).toHaveLength(0);
    });
  });

  describe('clearLogs', () => {
    it('clears all logs', () => {
      store.addLogs(createSampleLogs(5));
      expect(store.logs).toHaveLength(5);

      store.clearLogs();
      expect(store.logs).toHaveLength(0);
    });

    it('can add logs after clearing', () => {
      store.addLogs(createSampleLogs(3));
      store.clearLogs();
      store.addLogs(createSampleLogs(2));

      expect(store.logs).toHaveLength(2);
    });
  });

  describe('project change', () => {
    it('clears logs when project changes', () => {
      store.setProjectId('project-1');
      store.addLogs(createSampleLogs(5, { projectId: 'project-1' }));
      expect(store.logs).toHaveLength(5);

      store.setProjectId('project-2');
      expect(store.logs).toHaveLength(0);
    });

    it('does not clear logs when setting same project', () => {
      store.setProjectId('project-1');
      store.addLogs(createSampleLogs(5));

      store.setProjectId('project-1');
      expect(store.logs).toHaveLength(5);
    });

    it('clears logs when project is set to null', () => {
      store.setProjectId('project-1');
      store.addLogs(createSampleLogs(5));

      store.setProjectId(null);
      expect(store.logs).toHaveLength(0);
    });

    it('updates projectId when changed', () => {
      store.setProjectId('project-1');
      expect(store.projectId).toBe('project-1');

      store.setProjectId('project-2');
      expect(store.projectId).toBe('project-2');
    });

    it('sets projectId from null to value', () => {
      expect(store.projectId).toBeNull();

      store.setProjectId('project-1');
      expect(store.projectId).toBe('project-1');
    });
  });

  describe('logCount', () => {
    it('returns 0 for empty store', () => {
      expect(store.logCount).toBe(0);
    });

    it('returns correct count after adding logs', () => {
      store.addLogs(createSampleLogs(5));
      expect(store.logCount).toBe(5);
    });

    it('updates after clearing logs', () => {
      store.addLogs(createSampleLogs(5));
      store.clearLogs();
      expect(store.logCount).toBe(0);
    });
  });

  describe('performance optimizations', () => {
    it('handles rapid successive addLogs calls efficiently', () => {
      const store = createLogStreamStore({ maxLogs: 100 });
      const startTime = performance.now();

      // Simulate rapid SSE updates (50 batches of 5 logs each)
      for (let batch = 0; batch < 50; batch++) {
        store.addLogs(createSampleLogs(5, { message: `Batch ${batch}` }));
      }

      const elapsed = performance.now() - startTime;

      // Should complete in under 100ms (very generous for 250 log operations)
      expect(elapsed).toBeLessThan(100);
      expect(store.logs).toHaveLength(100);
      // Newest logs should be at the beginning
      expect(store.logs[0].message).toContain('Batch 49');
    });

    it('does not leak memory when repeatedly hitting maxLogs limit', () => {
      const store = createLogStreamStore({ maxLogs: 10 });

      // Add 100 batches of 5 logs each
      for (let i = 0; i < 100; i++) {
        store.addLogs(createSampleLogs(5));
      }

      // Should never exceed maxLogs
      expect(store.logs).toHaveLength(10);
    });

    it('efficiently handles single log additions', () => {
      const store = createLogStreamStore({ maxLogs: 1000 });
      const startTime = performance.now();

      // Simulate real-time single log arrivals (common SSE pattern)
      for (let i = 0; i < 200; i++) {
        store.addLogs([createSampleLog({ id: `single-${i}` })]);
      }

      const elapsed = performance.now() - startTime;

      // Should complete in under 50ms
      expect(elapsed).toBeLessThan(50);
      expect(store.logs).toHaveLength(200);
    });

    it('handles large batch additions without creating excessive intermediate arrays', () => {
      const store = createLogStreamStore({ maxLogs: 500 });

      // Add a large batch
      const largeBatch = createSampleLogs(300);
      store.addLogs(largeBatch);

      expect(store.logs).toHaveLength(300);

      // Add another batch that will cause trimming
      const anotherBatch = createSampleLogs(300, { message: 'second batch' });
      store.addLogs(anotherBatch);

      expect(store.logs).toHaveLength(500);
      // First 300 should be from second batch
      expect(store.logs[0].message).toBe('second batch');
    });
  });
});
