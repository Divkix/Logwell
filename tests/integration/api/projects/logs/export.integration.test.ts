import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createAuth } from "#lib/server/auth.js";
import type * as schema from "#lib/server/db/schema.js";
import { setupTestDatabase } from "#lib/server/db/test-db.js";
import { getSession } from "#lib/server/session.js";
import { clearApiKeyCache } from "#lib/server/utils/api-key.js";
import { GET } from "../../../../../src/routes/api/projects/[id]/logs/export/+server";
import { seedLog, seedLogs, seedProject } from "../../../../fixtures/db";

function createRequestEvent(
  request: Request,
  db: PgliteDatabase<typeof schema>,
  params: { id: string },
  locals: Partial<App.Locals> = {},
): Parameters<typeof GET>[0] {
  return {
    request,
    locals: { db, ...locals },
    params,
    url: new URL(request.url),
    platform: undefined,
    route: { id: "/api/projects/[id]/logs/export" },
    isDataRequest: false,
    isSubRequest: false,
    isRemoteRequest: false,
    tracing: { enabled: false, root: undefined, current: undefined },
    cookies: {
      get: () => undefined,
      getAll: () => [],
      set: () => {},
      delete: () => {},
      serialize: () => "",
      parse: () => ({ name: "", value: "" }),
    },
    fetch: globalThis.fetch,
    getClientAddress: () => "127.0.0.1",
    setHeaders: () => {},
  };
}

describe("GET /api/projects/[id]/logs/export", () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;
  let auth: ReturnType<typeof createAuth>;
  let authenticatedLocals: Partial<App.Locals>;
  let userId: string;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
    auth = createAuth(db);
    clearApiKeyCache();

    const signUpResult = await auth.api.signUpEmail({
      body: {
        email: "test@example.com",
        password: "SecureP@ssw0rd123",
        name: "Test User",
      },
    });

    const mockRequest = new Request("http://localhost:5173", {
      headers: {
        cookie: `better-auth.session_token=${signUpResult.token}`,
      },
    });

    const sessionData = await getSession(mockRequest.headers, db);

    if (!sessionData) throw new Error("Session data should not be null");
    userId = sessionData.user.id;

    authenticatedLocals = {
      user: sessionData.user,
      session: sessionData.session,
    };
  });

  afterEach(async () => {
    await cleanup();
  });

  it("exports matching logs as JSON", async () => {
    const testProject = await seedProject(db, { ownerId: userId });
    const log1 = await seedLog(db, testProject.id, { message: "Test log 1" });
    const log2 = await seedLog(db, testProject.id, { message: "Test log 2" });

    const request = new Request(
      `http://localhost/api/projects/${testProject.id}/logs/export?format=json`,
      { method: "GET" },
    );

    const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
    const response = await GET(event);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    const body = await response.json();

    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(body.some((log: { id: string }) => log.id === log1.id)).toBe(true);
    expect(body.some((log: { id: string }) => log.id === log2.id)).toBe(true);
  });

  it("defaults to JSON when format is omitted", async () => {
    const testProject = await seedProject(db, { ownerId: userId });
    await seedLog(db, testProject.id, { message: "default-format log" });

    const request = new Request(`http://localhost/api/projects/${testProject.id}/logs/export`, {
      method: "GET",
    });

    const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
    const response = await GET(event);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toHaveLength(1);
  });

  it("exports CSV with escaped special characters", async () => {
    const testProject = await seedProject(db, { ownerId: userId });
    await seedLog(db, testProject.id, { message: "Test message with, comma" });
    await seedLog(db, testProject.id, { message: 'Test "quoted" message' });
    await seedLog(db, testProject.id, { message: "Test message\nwith newline" });

    const request = new Request(
      `http://localhost/api/projects/${testProject.id}/logs/export?format=csv`,
      { method: "GET" },
    );

    const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
    const response = await GET(event);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    const csvText = await response.text();

    expect(csvText).toContain('"Test message with, comma"');
    expect(csvText).toContain('"Test ""quoted"" message"');
  });

  it("returns 400 for an invalid format parameter", async () => {
    const testProject = await seedProject(db, { ownerId: userId });

    const request = new Request(
      `http://localhost/api/projects/${testProject.id}/logs/export?format=xml`,
      { method: "GET" },
    );

    const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
    const response = await GET(event);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty("error", "invalid_format");
  });

  it("exports every log across multiple pages", async () => {
    const testProject = await seedProject(db, { ownerId: userId });
    await seedLogs(db, testProject.id, 1001);

    const request = new Request(
      `http://localhost/api/projects/${testProject.id}/logs/export?format=json`,
      { method: "GET" },
    );

    const response = await GET(
      createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals),
    );

    const body: { id: string }[] = await response.json();
    expect(body).toHaveLength(1001);
    expect(new Set(body.map((l) => l.id)).size).toBe(1001);
  });

  it("fetches pages only as fast as the client reads", async () => {
    const testProject = await seedProject(db, { ownerId: userId });
    await seedLogs(db, testProject.id, 1001);
    const url = `http://localhost/api/projects/${testProject.id}/logs/export?format=csv`;
    const selectSpy = vi.spyOn(db, "select");

    const full = await GET(
      createRequestEvent(new Request(url), db, { id: testProject.id }, authenticatedLocals),
    );

    await full.text();
    const fullExportSelects = selectSpy.mock.calls.length;
    selectSpy.mockClear();

    const stalled = await GET(
      createRequestEvent(new Request(url), db, { id: testProject.id }, authenticatedLocals),
    );

    const reader = stalled.body!.getReader();

    try {
      await reader.read(); // header only, then the client stops reading
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(selectSpy.mock.calls.length).toBeLessThan(fullExportSelects);
    } finally {
      await reader.cancel();
      selectSpy.mockRestore();
    }
  });
});
