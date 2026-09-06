import { eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type * as schema from "../../../src/lib/server/db/schema";
import { log } from "../../../src/lib/server/db/schema";
import { setupTestDatabase } from "../../../src/lib/server/db/test-db";
import { logEventBus } from "../../../src/lib/server/events";
import { clearApiKeyCache } from "../../../src/lib/server/utils/api-key";
import { POST } from "../../../src/routes/v1/logs/+server";
import { seedProjectWithApiKey } from "../../fixtures/db";

function createRequestEvent(request: Request, db: PgliteDatabase<typeof schema>) {
  return {
    request,
    locals: { db },
    params: {},
    url: new URL(request.url),
  } as unknown as Parameters<typeof POST>[0];
}

function post(body: unknown, apiKey?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return new Request("http://localhost/v1/logs", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

// Parser-specific mapping contract for the OTLP adapter. Shared guards
// (auth, rate limit, batch caps) live in the ingest pipeline suite.
describe("POST /v1/logs (OTLP mapping)", () => {
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

  it("maps OTLP fields onto the log row", async () => {
    const project = await seedProjectWithApiKey(db);

    const payload = {
      resourceLogs: [
        {
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: "api" } }],
          },
          scopeLogs: [
            {
              scope: { name: "logger", version: "2.0.0" },
              logRecords: [
                {
                  timeUnixNano: "1700000000000000000",
                  severityNumber: 17,
                  severityText: "ERROR",
                  body: { stringValue: "Database failed" },
                  attributes: [
                    { key: "request.id", value: { stringValue: "req-123" } },
                    { key: "code.filepath", value: { stringValue: "src/db.ts" } },
                    { key: "code.lineno", value: { intValue: "45" } },
                    { key: "enduser.id", value: { stringValue: "user-456" } },
                    { key: "client.address", value: { stringValue: "192.168.1.1" } },
                  ],
                  traceId: "5B8EFFF798038103D269B633813FC60C",
                  spanId: "EEE19B7EC3C1B174",
                },
              ],
            },
          ],
        },
      ],
    };

    const response = await POST(createRequestEvent(post(payload, project.apiKey), db));
    expect(response.status).toBe(200);

    const [inserted] = await db.select().from(log).where(eq(log.projectId, project.id));
    expect(inserted).toBeTruthy();
    expect(inserted!.message).toBe("Database failed");
    expect(inserted!.level).toBe("error");
    expect(inserted!.severityNumber).toBe(17);
    expect(inserted!.severityText).toBe("ERROR");
    expect(inserted!.timeUnixNano).toBe("1700000000000000000");
    expect(inserted!.sourceFile).toBe("src/db.ts");
    expect(inserted!.lineNumber).toBe(45);
    expect(inserted!.requestId).toBe("req-123");
    expect(inserted!.userId).toBe("user-456");
    expect(inserted!.ipAddress).toBe("192.168.1.1");
    expect(inserted!.resourceAttributes).toEqual({ "service.name": "api" });
    expect(inserted!.scopeName).toBe("logger");
    expect(inserted!.scopeVersion).toBe("2.0.0");
    expect(inserted!.traceId).toBe("5b8efff798038103d269b633813fc60c");
    expect(inserted!.spanId).toBe("eee19b7ec3c1b174");
  });

  it("returns partial success when invalid log records are present", async () => {
    const project = await seedProjectWithApiKey(db);

    const payload = {
      resourceLogs: [
        {
          scopeLogs: [{ logRecords: [null, { body: { stringValue: "ok" } }] }],
        },
      ],
    };

    const response = await POST(createRequestEvent(post(payload, project.apiKey), db));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accepted).toBe(1);
    expect(body.rejected).toBe(1);
    expect(body.errors).toHaveLength(1);
  });
});
