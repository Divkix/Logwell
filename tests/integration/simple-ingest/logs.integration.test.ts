import { eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type * as schema from "../../../src/lib/server/db/schema";
import { log } from "../../../src/lib/server/db/schema";
import { setupTestDatabase } from "../../../src/lib/server/db/test-db";
import { logEventBus } from "../../../src/lib/server/events";
import { clearApiKeyCache } from "../../../src/lib/server/utils/api-key";
import { POST } from "../../../src/routes/v1/ingest/+server";
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
  return new Request("http://localhost/v1/ingest", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

// Parser-specific contract for the simple-ingest adapter: the 200
// accepted/rejected shape plus field mapping. Shared guards (auth, rate
// limit, batch caps) live in the ingest pipeline suite.
describe("POST /v1/ingest (simple mapping)", () => {
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

  it("returns 200 with accepted/rejected counts on partial batches", async () => {
    const project = await seedProjectWithApiKey(db);

    const response = await POST(
      createRequestEvent(
        post(
          [
            { level: "info", message: "good" },
            { level: "bogus", message: "bad" },
          ],
          project.apiKey,
        ),
        db,
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accepted).toBe(1);
    expect(body.rejected).toBe(1);
    expect(body.errors).toHaveLength(1);

    const rows = await db.select().from(log).where(eq(log.projectId, project.id));
    expect(rows).toHaveLength(1);
  });

  it("maps request/user/ip metadata and stores empty metadata as NULL", async () => {
    const project = await seedProjectWithApiKey(db);

    const response = await POST(
      createRequestEvent(
        post(
          {
            level: "info",
            message: "mapped",
            metadata: {
              "request.id": "req-1",
              "enduser.id": "user-1",
              "client.address": "10.0.0.1",
            },
          },
          project.apiKey,
        ),
        db,
      ),
    );
    expect(response.status).toBe(200);

    const empty = await POST(
      createRequestEvent(
        post({ level: "info", message: "no-meta", metadata: {} }, project.apiKey),
        db,
      ),
    );
    expect(empty.status).toBe(200);

    const rows = await db.select().from(log).where(eq(log.projectId, project.id));
    expect(rows).toHaveLength(2);
    const mapped = rows.find((row) => row.message === "mapped")!;
    expect(mapped.requestId).toBe("req-1");
    expect(mapped.userId).toBe("user-1");
    expect(mapped.ipAddress).toBe("10.0.0.1");
    // Empty {} metadata stores as NULL
    expect(rows.find((row) => row.message === "no-meta")!.metadata).toBeNull();
  });

  it("returns 400 validation_error for an empty array", async () => {
    const project = await seedProjectWithApiKey(db);

    const response = await POST(createRequestEvent(post([], project.apiKey), db));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("validation_error");
  });
});
