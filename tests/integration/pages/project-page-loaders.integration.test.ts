import { sql } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createAuth } from "#lib/server/auth.js";
import type * as schema from "#lib/server/db/schema.js";
import { setupTestDatabase } from "#lib/server/db/test-db.js";
import { getSession } from "#lib/server/session.js";
import { MAX_SEARCH_LENGTH } from "#lib/shared/schemas/log.js";
import { seedLog, seedProject } from "../../fixtures/db";

// Import load functions as any to avoid the void | PageData union type issues
// from SvelteKit's generated types in test contexts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LoadFn = (event: never) => Promise<any>;

// SAFETY: each +page.server module exports the SvelteKit-generated load function, so module.load is the callable under test.
const loadDashboard = (await import("../../../src/routes/(app)/+page.server")).load as LoadFn;

// SAFETY: each +page.server module exports the SvelteKit-generated load function, so module.load is the callable under test.
const loadProjectLogs = (await import("../../../src/routes/(app)/projects/[id]/+page.server"))
  .load as LoadFn;

// SAFETY: each +page.server module exports the SvelteKit-generated load function, so module.load is the callable under test.
const loadProjectSettings = (
  await import("../../../src/routes/(app)/projects/[id]/settings/+page.server")
).load as LoadFn;

// SAFETY: each +page.server module exports the SvelteKit-generated load function, so module.load is the callable under test.
const loadProjectStats = (
  await import("../../../src/routes/(app)/projects/[id]/stats/+page.server")
).load as LoadFn;

// SAFETY: each +page.server module exports the SvelteKit-generated load function, so module.load is the callable under test.
const loadProjectIncidents = (
  await import("../../../src/routes/(app)/projects/[id]/incidents/+page.server")
).load as LoadFn;

function createLoadEvent(
  db: PgliteDatabase<typeof schema>,
  params: Record<string, string>,
  locals: Partial<App.Locals>,
  url = "http://localhost:5173/",
) {
  return {
    locals: { db, ...locals },
    params,
    url: new URL(url),
    platform: undefined,
    route: { id: "" },
    isDataRequest: false,
    isSubRequest: false,
    isRemoteRequest: false,
    tracing: null,
    request: new Request(url),
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
    depends: () => {},
    parent: async () => ({}),
  };
}

async function createAuthenticatedLocals(
  db: PgliteDatabase<typeof schema>,
  auth: ReturnType<typeof createAuth>,
  email: string,
): Promise<{ locals: Partial<App.Locals>; userId: string }> {
  const result = await auth.api.signUpEmail({
    body: { email, password: "SecureP@ssw0rd123", name: "Test User" },
  });

  const sessionData = await getSession(
    new Request("http://localhost:5173", {
      headers: { cookie: `better-auth.session_token=${result.token}` },
    }).headers,
    db,
  );

  if (!sessionData) throw new Error("Session data must not be null");

  return {
    locals: { user: sessionData.user, session: sessionData.session },
    userId: sessionData.user.id,
  };
}

async function expectSvelteKit404(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
    expect.fail("Expected a SvelteKit 404 error to be thrown");
  } catch (err) {
    expect(err).toMatchObject({
      status: 404,
      body: { status: 404, message: "Project not found" },
    });
  }
}

describe("(app) page loaders — injected PGlite DB seam", () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;
  let auth: ReturnType<typeof createAuth>;
  let owner: { locals: Partial<App.Locals>; userId: string };
  let nonOwner: { locals: Partial<App.Locals>; userId: string };

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
    auth = createAuth(db);

    owner = await createAuthenticatedLocals(db, auth, "owner@example.com");
    nonOwner = await createAuthenticatedLocals(db, auth, "nonowner@example.com");
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("(app)/+page.server.ts — dashboard list loader", () => {
    it("returns only the authenticated owner's projects via injected PGlite DB", async () => {
      const ownedProject = await seedProject(db, { name: "owned-project", ownerId: owner.userId });
      await seedProject(db, { name: "other-project", ownerId: nonOwner.userId });

      const event = createLoadEvent(db, {}, owner.locals);
      // SAFETY: createLoadEvent builds every event member these load functions read (url, params, locals, cookies, fetch, setHeaders, getClientAddress, depends, parent); tracing stays null because no load function reads it.
      const data = await loadDashboard(event as never);

      expect(data.projects).toHaveLength(1);
      expect(data.projects[0]!.id).toBe(ownedProject.id);
    });

    it("omits soft-deleted projects", async () => {
      const kept = await seedProject(db, { name: "kept", ownerId: owner.userId });
      await seedProject(db, { name: "gone", ownerId: owner.userId, deletedAt: new Date() });

      const event = createLoadEvent(db, {}, owner.locals);
      // SAFETY: createLoadEvent builds every event member these load functions read (url, params, locals, cookies, fetch, setHeaders, getClientAddress, depends, parent); tracing stays null because no load function reads it.
      const data = await loadDashboard(event as never);

      expect(data.projects.map((p: { id: string }) => p.id)).toEqual([kept.id]);
    });

    it("returns bounded log counts and the latest activity per project", async () => {
      const busy = await seedProject(db, { name: "busy-project", ownerId: owner.userId });
      await seedProject(db, { name: "empty-project", ownerId: owner.userId });
      await seedLog(db, busy.id, { timestamp: new Date(Date.now() - 60_000) });
      const latest = await seedLog(db, busy.id);

      const event = createLoadEvent(db, {}, owner.locals);
      // SAFETY: createLoadEvent builds every event member these load functions read (url, params, locals, cookies, fetch, setHeaders, getClientAddress, depends, parent); tracing stays null because no load function reads it.
      const data = await loadDashboard(event as never);

      const byName = Object.fromEntries(
        data.projects.map((p: { name: string }) => [p.name, p] as const),
      );

      expect(byName["busy-project"]).toMatchObject({
        logCount: 2,
        logCountCapped: false,
        lastActivity: latest.timestamp.toISOString(),
      });
      expect(byName["empty-project"]).toMatchObject({
        logCount: 0,
        logCountCapped: false,
        lastActivity: null,
      });
    });
  });

  describe("(app)/projects/[id]/+page.server.ts — logs loader", () => {
    it("returns project data via injected PGlite DB for the owner", async () => {
      const proj = await seedProject(db, { name: "test-proj", ownerId: owner.userId });

      const event = createLoadEvent(db, { id: proj.id }, owner.locals);
      // SAFETY: createLoadEvent builds every event member these load functions read (url, params, locals, cookies, fetch, setHeaders, getClientAddress, depends, parent); tracing stays null because no load function reads it.
      const data = await loadProjectLogs(event as never);

      expect(data.project.id).toBe(proj.id);
      expect(data.project.name).toBe("test-proj");
      expect(data.project.apiKeyHash).toBeUndefined();
    });

    it("normalizes an unknown range to the default window and bounds the query", async () => {
      const proj = await seedProject(db, { name: "range-proj", ownerId: owner.userId });
      await seedLog(db, proj.id, {
        message: "outside-window",
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
      });
      await seedLog(db, proj.id, { message: "inside-window" });

      const event = createLoadEvent(
        db,
        { id: proj.id },
        owner.locals,
        `http://localhost:5173/projects/${proj.id}?range=30d`,
      );

      // SAFETY: createLoadEvent builds every event member these load functions read (url, params, locals, cookies, fetch, setHeaders, getClientAddress, depends, parent); tracing stays null because no load function reads it.
      const data = await loadProjectLogs(event as never);

      expect(data.filters.range).toBe("1h");
      expect(new Date(data.filters.from).getTime()).toBeGreaterThan(
        Date.now() - 60 * 60 * 1000 - 5000,
      );
      expect(data.logs.map((entry: { message: string }) => entry.message)).toEqual([
        "inside-window",
      ]);
    });

    it("throws SvelteKit 400 for an offset past 10000", async () => {
      const proj = await seedProject(db, { name: "deep-offset", ownerId: owner.userId });

      const event = createLoadEvent(
        db,
        { id: proj.id },
        owner.locals,
        `http://localhost:5173/projects/${proj.id}?offset=10001`,
      );

      // SAFETY: createLoadEvent builds every event member these load functions read (url, params, locals, cookies, fetch, setHeaders, getClientAddress, depends, parent); tracing stays null because no load function reads it.
      await expect(loadProjectLogs(event as never)).rejects.toMatchObject({
        status: 400,
        body: { message: "offset must be at most 10000; use cursor pagination for deeper pages" },
      });
    });

    it("falls back to the first page for an invalid cursor, whatever the offset", async () => {
      const proj = await seedProject(db, { name: "bad-cursor", ownerId: owner.userId });
      await seedLog(db, proj.id, { message: "first-page" });

      const event = createLoadEvent(
        db,
        { id: proj.id },
        owner.locals,
        `http://localhost:5173/projects/${proj.id}?cursor=garbage&offset=10001`,
      );

      // SAFETY: createLoadEvent builds every event member these load functions read (url, params, locals, cookies, fetch, setHeaders, getClientAddress, depends, parent); tracing stays null because no load function reads it.
      const data = await loadProjectLogs(event as never);

      expect(data.logs.map((entry: { message: string }) => entry.message)).toEqual(["first-page"]);
      expect(data.pagination.offset).toBe(0);
    });

    it("cuts an over-long search to the length the logs API accepts", async () => {
      const proj = await seedProject(db, { name: "search-proj", ownerId: owner.userId });
      await seedLog(db, proj.id, { message: "needle in the logs" });
      const search = `needle${" x".repeat(MAX_SEARCH_LENGTH)}`;

      const event = createLoadEvent(
        db,
        { id: proj.id },
        owner.locals,
        `http://localhost:5173/projects/${proj.id}?search=${encodeURIComponent(search)}`,
      );

      // SAFETY: createLoadEvent builds every event member these load functions read (url, params, locals, cookies, fetch, setHeaders, getClientAddress, depends, parent); tracing stays null because no load function reads it.
      const data = await loadProjectLogs(event as never);

      expect(data.filters.search).toBe(search.slice(0, MAX_SEARCH_LENGTH));
    });

    it("throws SvelteKit 404 for a non-owner (existence hidden)", async () => {
      const proj = await seedProject(db, { name: "other-proj", ownerId: owner.userId });

      const event = createLoadEvent(db, { id: proj.id }, nonOwner.locals);
      // SAFETY: createLoadEvent builds every event member these load functions read (url, params, locals, cookies, fetch, setHeaders, getClientAddress, depends, parent); tracing stays null because no load function reads it.
      await expectSvelteKit404(loadProjectLogs(event as never));
    });

    it("throws SvelteKit 404 for a soft-deleted project", async () => {
      const proj = await seedProject(db, { ownerId: owner.userId, deletedAt: new Date() });

      const event = createLoadEvent(db, { id: proj.id }, owner.locals);
      // SAFETY: createLoadEvent builds every event member these load functions read (url, params, locals, cookies, fetch, setHeaders, getClientAddress, depends, parent); tracing stays null because no load function reads it.
      await expectSvelteKit404(loadProjectLogs(event as never));
    });

    it("throws SvelteKit 404 for a project that does not exist", async () => {
      const event = createLoadEvent(db, { id: "nonexistent-id" }, owner.locals);
      // SAFETY: createLoadEvent builds every event member these load functions read (url, params, locals, cookies, fetch, setHeaders, getClientAddress, depends, parent); tracing stays null because no load function reads it.
      await expectSvelteKit404(loadProjectLogs(event as never));
    });
  });

  describe("(app)/projects/[id]/stats/+page.server.ts — stats loader", () => {
    it("throws SvelteKit 404 for a non-owner", async () => {
      const proj = await seedProject(db, { name: "stats-proj", ownerId: owner.userId });

      const event = createLoadEvent(db, { id: proj.id }, nonOwner.locals);
      // SAFETY: createLoadEvent builds every event member these load functions read (url, params, locals, cookies, fetch, setHeaders, getClientAddress, depends, parent); tracing stays null because no load function reads it.
      await expectSvelteKit404(loadProjectStats(event as never));
    });

    it("normalizes an unknown range to the default window and bounds the count", async () => {
      const proj = await seedProject(db, { name: "stats-range-proj", ownerId: owner.userId });
      await seedLog(db, proj.id, {
        message: "outside-window",
        timestamp: new Date(Date.now() - 30 * 60 * 60 * 1000),
      });
      await seedLog(db, proj.id, { message: "inside-window" });

      const event = createLoadEvent(
        db,
        { id: proj.id },
        owner.locals,
        `http://localhost:5173/projects/${proj.id}/stats?range=30d`,
      );

      // SAFETY: createLoadEvent builds every event member these load functions read (url, params, locals, cookies, fetch, setHeaders, getClientAddress, depends, parent); tracing stays null because no load function reads it.
      const data = await loadProjectStats(event as never);

      expect(data.filters.range).toBe("24h");
      expect(new Date(data.filters.from).getTime()).toBeGreaterThan(
        Date.now() - 24 * 60 * 60 * 1000 - 5000,
      );
      expect(data.stats.totalLogs).toBe(1);
    });
  });

  describe("(app)/projects/[id]/settings/+page.server.ts — settings loader", () => {
    it("throws SvelteKit 404 for a non-owner", async () => {
      const proj = await seedProject(db, { name: "settings-proj", ownerId: owner.userId });

      const event = createLoadEvent(db, { id: proj.id }, nonOwner.locals);
      // SAFETY: createLoadEvent builds every event member these load functions read (url, params, locals, cookies, fetch, setHeaders, getClientAddress, depends, parent); tracing stays null because no load function reads it.
      await expectSvelteKit404(loadProjectSettings(event as never));
    });

    it("returns the bounded log total and the oldest log date", async () => {
      const proj = await seedProject(db, { name: "settings-stats", ownerId: owner.userId });
      const oldest = await seedLog(db, proj.id, { timestamp: new Date(Date.now() - 3_600_000) });
      await seedLog(db, proj.id);

      const event = createLoadEvent(db, { id: proj.id }, owner.locals);
      // SAFETY: createLoadEvent builds every event member these load functions read (url, params, locals, cookies, fetch, setHeaders, getClientAddress, depends, parent); tracing stays null because no load function reads it.
      const data = await loadProjectSettings(event as never);

      expect(data.stats).toEqual({
        totalLogs: 2,
        totalLogsCapped: false,
        oldestLogDate: oldest.timestamp.toISOString(),
      });
    });
  });

  describe("(app)/projects/[id]/incidents/+page.server.ts — incidents loader", () => {
    it("throws SvelteKit 404 for a non-owner", async () => {
      const proj = await seedProject(db, { name: "incidents-proj", ownerId: owner.userId });

      const event = createLoadEvent(db, { id: proj.id }, nonOwner.locals);
      // SAFETY: createLoadEvent builds every event member these load functions read (url, params, locals, cookies, fetch, setHeaders, getClientAddress, depends, parent); tracing stays null because no load function reads it.
      await expectSvelteKit404(loadProjectIncidents(event as never));
    });

    it("does not skip incidents that share the cursor's millisecond", async () => {
      const proj = await seedProject(db, { name: "incidents-page-cursor", ownerId: owner.userId });

      // 25 incidents one microsecond apart inside the same millisecond: the default page
      // holds 20, so the next cursor points into a millisecond that still has rows after it.
      const baseEpoch = Math.floor(Date.now() / 1000) + 0.123456;
      const seededIds: string[] = [];

      for (let i = 0; i < 25; i++) {
        const id = `inc-page-same-ms-${i}`;
        seededIds.push(id);
        await db.execute(sql`
          INSERT INTO "incident"
            ("id", "project_id", "fingerprint", "title", "normalized_message", "highest_level", "first_seen", "last_seen", "total_events")
          VALUES (${id}, ${proj.id}, ${`fp-page-same-ms-${i}`}, ${`Incident ${i}`}, ${`incident ${i}`}, 'error', to_timestamp(${baseEpoch + i * 0.000001}), to_timestamp(${baseEpoch + i * 0.000001}), 1)
        `);
      }

      const collectedIds: string[] = [];
      let cursor: string | null = null;

      for (let page = 0; page < 10; page++) {
        // limit=20 keeps the page below the 25 seeded rows (the loader defaults to 50).
        const url = cursor
          ? `http://localhost:5173/projects/${proj.id}/incidents?limit=20&cursor=${encodeURIComponent(cursor)}`
          : `http://localhost:5173/projects/${proj.id}/incidents?limit=20`;

        // SAFETY: createLoadEvent builds every event member these load functions read (url, params, locals, cookies, fetch, setHeaders, getClientAddress, depends, parent); tracing stays null because no load function reads it.
        const data = await loadProjectIncidents(
          createLoadEvent(db, { id: proj.id }, owner.locals, url) as never,
        );

        collectedIds.push(...data.incidents.map((i: { id: string }) => i.id));

        if (!data.pagination.hasMore) break;
        cursor = data.pagination.nextCursor;
      }

      expect(collectedIds).toHaveLength(25);
      expect(new Set(collectedIds).size).toBe(25);

      for (const id of seededIds) {
        expect(collectedIds.filter((c) => c === id)).toHaveLength(1);
      }
    });
  });
});
