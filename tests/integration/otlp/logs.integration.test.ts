import { eq } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type * as schema from '../../../src/lib/server/db/schema';
import { log } from '../../../src/lib/server/db/schema';
import { setupTestDatabase } from '../../../src/lib/server/db/test-db';
import { logEventBus } from '../../../src/lib/server/events';
import { clearApiKeyCache } from '../../../src/lib/server/utils/api-key';
import { POST } from '../../../src/routes/v1/logs/+server';
import { seedProject } from '../../fixtures/db';

function createRequestEvent(request: Request, db: PgliteDatabase<typeof schema>) {
  return {
    request,
    locals: { db },
    params: {},
    url: new URL(request.url),
    platform: undefined,
    route: { id: '/v1/logs' },
    isDataRequest: false,
    isSubRequest: false,
    isRemoteRequest: false,
    tracing: null,
    cookies: {
      get: () => undefined,
      getAll: () => [],
      set: () => {},
      delete: () => {},
      serialize: () => '',
    },
    fetch: globalThis.fetch,
    getClientAddress: () => '127.0.0.1',
    setHeaders: () => {},
  } as unknown;
}

describe('POST /v1/logs (OTLP)', () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
    clearApiKeyCache();
    logEventBus.clear();
  });

  afterEach(async () => {
    logEventBus.clear();
    await cleanup();
  });

  it('returns 401 without Authorization header', async () => {
    const request = new Request('http://localhost/v1/logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ resourceLogs: [] }),
    });

    const event = createRequestEvent(request, db);
    const response = await POST(event as never);

    expect(response.status).toBe(401);
  });

  it('ingests OTLP log records and maps core fields', async () => {
    const project = await seedProject(db);

    const payload = {
      resourceLogs: [
        {
          resource: {
            attributes: [{ key: 'service.name', value: { stringValue: 'api' } }],
            droppedAttributesCount: 0,
          },
          scopeLogs: [
            {
              scope: { name: 'logger', version: '2.0.0' },
              logRecords: [
                {
                  timeUnixNano: '1700000000000000000',
                  severityNumber: 17,
                  severityText: 'ERROR',
                  body: { stringValue: 'Database failed' },
                  attributes: [
                    { key: 'request.id', value: { stringValue: 'req-123' } },
                    { key: 'code.filepath', value: { stringValue: 'src/db.ts' } },
                    { key: 'code.lineno', value: { intValue: '45' } },
                    { key: 'enduser.id', value: { stringValue: 'user-456' } },
                    { key: 'client.address', value: { stringValue: '192.168.1.1' } },
                  ],
                  traceId: '5B8EFFF798038103D269B633813FC60C',
                  spanId: 'EEE19B7EC3C1B174',
                },
              ],
            },
          ],
        },
      ],
    };

    const request = new Request('http://localhost/v1/logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${project.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const event = createRequestEvent(request, db);
    const response = await POST(event as never);

    expect(response.status).toBe(200);

    const [inserted] = await db.select().from(log).where(eq(log.projectId, project.id));
    expect(inserted).toBeTruthy();
    expect(inserted.message).toBe('Database failed');
    expect(inserted.level).toBe('error');
    expect(inserted.severityNumber).toBe(17);
    expect(inserted.severityText).toBe('ERROR');
    expect(inserted.timeUnixNano).toBe('1700000000000000000');
    expect(inserted.metadata).toEqual({
      'request.id': 'req-123',
      'code.filepath': 'src/db.ts',
      'code.lineno': 45,
      'enduser.id': 'user-456',
      'client.address': '192.168.1.1',
    });
    expect(inserted.sourceFile).toBe('src/db.ts');
    expect(inserted.lineNumber).toBe(45);
    expect(inserted.requestId).toBe('req-123');
    expect(inserted.userId).toBe('user-456');
    expect(inserted.ipAddress).toBe('192.168.1.1');
    expect(inserted.resourceAttributes).toEqual({ 'service.name': 'api' });
    expect(inserted.scopeName).toBe('logger');
    expect(inserted.scopeVersion).toBe('2.0.0');
    expect(inserted.traceId).toBe('5b8efff798038103d269b633813fc60c');
    expect(inserted.spanId).toBe('eee19b7ec3c1b174');
  });

  it('returns partial success when invalid log records are present', async () => {
    const project = await seedProject(db);

    const payload = {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [null, { body: { stringValue: 'ok' } }],
            },
          ],
        },
      ],
    };

    const request = new Request('http://localhost/v1/logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${project.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const event = createRequestEvent(request, db);
    const response = await POST(event as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      partialSuccess: {
        rejectedLogRecords: '1',
        errorMessage: '1 log record(s) were rejected during ingestion.',
      },
    });
  });
});
