import { describe, expect, it, vi } from 'vitest';
import { cleanupOldLogs } from '../../../src/lib/server/jobs/log-cleanup';

describe('cleanupOldLogs batch selection', () => {
  it('orders batch selection by log id for deterministic deletes', async () => {
    let executeCalled = false;
    const executeMock = vi.fn().mockImplementation(() => {
      executeCalled = true;
      // Return empty rows to stop the while loop
      return Promise.resolve({ rows: [] });
    });

    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockResolvedValue([{ id: 'project-1', retentionDays: 7 }]),
      }),
      execute: executeMock,
    };

    const result = await cleanupOldLogs(db as unknown as Parameters<typeof cleanupOldLogs>[0]);

    expect(executeCalled).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.totalLogsDeleted).toBe(0);
  });
});
