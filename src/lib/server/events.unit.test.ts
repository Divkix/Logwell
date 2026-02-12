import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Incident, Log } from './db/schema';
import { logEventBus } from './events';

describe('Log Event Bus', () => {
  // Sample log for testing
  const sampleLog: Log = {
    id: 'log-1',
    projectId: 'project-1',
    incidentId: null,
    fingerprint: null,
    serviceName: null,
    level: 'info',
    message: 'Test log message',
    metadata: { key: 'value' },
    timeUnixNano: null,
    observedTimeUnixNano: null,
    severityNumber: null,
    severityText: null,
    body: null,
    droppedAttributesCount: null,
    flags: null,
    traceId: null,
    spanId: null,
    resourceAttributes: null,
    resourceDroppedAttributesCount: null,
    resourceSchemaUrl: null,
    scopeName: null,
    scopeVersion: null,
    scopeAttributes: null,
    scopeDroppedAttributesCount: null,
    scopeSchemaUrl: null,
    sourceFile: 'test.ts',
    lineNumber: 42,
    requestId: 'req-123',
    userId: 'user-1',
    ipAddress: '127.0.0.1',
    timestamp: new Date(),
    search: null,
  };

  const sampleIncident: Incident = {
    id: 'inc-1',
    projectId: 'project-1',
    fingerprint: 'abcd1234',
    title: 'Database timeout',
    normalizedMessage: 'database timeout after {num}ms',
    serviceName: 'api',
    sourceFile: 'db.ts',
    lineNumber: 42,
    highestLevel: 'error',
    firstSeen: new Date(),
    lastSeen: new Date(),
    totalEvents: 5,
    reopenCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    // Clear all listeners before each test
    logEventBus.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('emitLog', () => {
    it('triggers registered listeners', () => {
      const listener = vi.fn();
      logEventBus.onLog('project-1', listener);

      logEventBus.emitLog(sampleLog);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(sampleLog);
    });

    it('triggers multiple listeners for same project', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      logEventBus.onLog('project-1', listener1);
      logEventBus.onLog('project-1', listener2);

      logEventBus.emitLog(sampleLog);

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('does not throw when emitting to project with no listeners', () => {
      expect(() => logEventBus.emitLog(sampleLog)).not.toThrow();
    });
  });

  describe('onLog', () => {
    it('returns unsubscribe function', () => {
      const listener = vi.fn();
      const unsubscribe = logEventBus.onLog('project-1', listener);

      expect(typeof unsubscribe).toBe('function');
    });

    it('registers listener for specific project', () => {
      const listener = vi.fn();
      logEventBus.onLog('project-1', listener);

      // Emit log for the subscribed project
      logEventBus.emitLog(sampleLog);

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('unsubscribe', () => {
    it('removes listener from receiving events', () => {
      const listener = vi.fn();
      const unsubscribe = logEventBus.onLog('project-1', listener);

      // Emit first log - should be received
      logEventBus.emitLog(sampleLog);
      expect(listener).toHaveBeenCalledTimes(1);

      // Unsubscribe
      unsubscribe();

      // Emit second log - should NOT be received
      logEventBus.emitLog({ ...sampleLog, id: 'log-2' });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('only removes the specific listener', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const unsubscribe1 = logEventBus.onLog('project-1', listener1);
      logEventBus.onLog('project-1', listener2);

      // Unsubscribe first listener only
      unsubscribe1();

      logEventBus.emitLog(sampleLog);

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('is idempotent - calling multiple times is safe', () => {
      const listener = vi.fn();
      const unsubscribe = logEventBus.onLog('project-1', listener);

      unsubscribe();
      expect(() => unsubscribe()).not.toThrow();
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  describe('project scoping', () => {
    it('events are project-scoped - only matching project receives events', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      logEventBus.onLog('project-1', listener1);
      logEventBus.onLog('project-2', listener2);

      // Emit log for project-1
      logEventBus.emitLog(sampleLog);

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).not.toHaveBeenCalled();
    });

    it('logs are routed to correct project listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      logEventBus.onLog('project-1', listener1);
      logEventBus.onLog('project-2', listener2);

      // Emit log for project-2
      const project2Log = { ...sampleLog, id: 'log-2', projectId: 'project-2' };
      logEventBus.emitLog(project2Log);

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledWith(project2Log);
    });

    it('same listener can subscribe to multiple projects', () => {
      const listener = vi.fn();
      logEventBus.onLog('project-1', listener);
      logEventBus.onLog('project-2', listener);

      logEventBus.emitLog(sampleLog);
      logEventBus.emitLog({ ...sampleLog, id: 'log-2', projectId: 'project-2' });

      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  describe('getListenerCount', () => {
    it('returns 0 for project with no listeners', () => {
      expect(logEventBus.getListenerCount('non-existent')).toBe(0);
    });

    it('returns correct count of listeners', () => {
      logEventBus.onLog('project-1', vi.fn());
      logEventBus.onLog('project-1', vi.fn());
      logEventBus.onLog('project-2', vi.fn());

      expect(logEventBus.getListenerCount('project-1')).toBe(2);
      expect(logEventBus.getListenerCount('project-2')).toBe(1);
    });

    it('decrements count after unsubscribe', () => {
      const unsubscribe = logEventBus.onLog('project-1', vi.fn());
      logEventBus.onLog('project-1', vi.fn());

      expect(logEventBus.getListenerCount('project-1')).toBe(2);

      unsubscribe();

      expect(logEventBus.getListenerCount('project-1')).toBe(1);
    });
  });

  describe('clear', () => {
    it('removes all listeners from all projects', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      logEventBus.onLog('project-1', listener1);
      logEventBus.onLog('project-2', listener2);

      logEventBus.clear();

      logEventBus.emitLog(sampleLog);
      logEventBus.emitLog({ ...sampleLog, projectId: 'project-2' });

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
    });
  });

  describe('incident events', () => {
    it('triggers registered incident listeners', () => {
      const listener = vi.fn();
      logEventBus.onIncident('project-1', listener);

      logEventBus.emitIncident(sampleIncident);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(sampleIncident);
    });

    it('incident listeners are project-scoped', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      logEventBus.onIncident('project-1', listener1);
      logEventBus.onIncident('project-2', listener2);

      logEventBus.emitIncident(sampleIncident);

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).not.toHaveBeenCalled();
    });

    it('returns incident listener count', () => {
      logEventBus.onIncident('project-1', vi.fn());
      logEventBus.onIncident('project-1', vi.fn());

      expect(logEventBus.getIncidentListenerCount('project-1')).toBe(2);
    });
  });
});
