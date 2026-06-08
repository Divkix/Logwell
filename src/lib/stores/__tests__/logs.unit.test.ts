import { describe, expect, it } from 'vitest';
import type { ClientLog } from '../logs.svelte';

describe('ClientLog type', () => {
  it('can create a ClientLog-shaped object', () => {
    const log: ClientLog = {
      id: 'log-1',
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
    };
    expect(log.id).toBe('log-1');
    expect(log.level).toBe('info');
  });
});
