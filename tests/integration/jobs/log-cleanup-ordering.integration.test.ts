import { asc } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { log } from '../../../src/lib/server/db/schema';
import { cleanupOldLogs } from '../../../src/lib/server/jobs/log-cleanup';

describe('cleanupOldLogs batch selection', () => {
  it('orders batch selection by log id for deterministic deletes', async () => {
    let orderByCalled = false;
    const orderByMock = vi.fn().mockImplementation(() => {
      orderByCalled = true;
      return {
        limit: vi.fn().mockResolvedValue([{ id: 'log-1' }]),
      };
    });

    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn().mockResolvedValue([{ id: 'project-1', retentionDays: 7 }]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ count: 1 }]),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: orderByMock,
            }),
          }),
        }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    };

    const result = await cleanupOldLogs(db as unknown as Parameters<typeof cleanupOldLogs>[0]);

    expect(orderByCalled).toBe(true);
    expect(orderByMock).toHaveBeenCalledWith(asc(log.id));
    expect(result.errors).toEqual([]);
    expect(result.totalLogsDeleted).toBe(1);
  });
});
