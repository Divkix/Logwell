/**
 * Integration tests for (app) page server loaders.
 *
 * Proves that:
 * 1. Page loaders route DB access through getDbClient(event.locals), so an
 *    injected PGlite test DB is honoured (the seam works end-to-end).
 * 2. A non-owner receives a SvelteKit 404 error (error PAGE, not a JSON blob)
 *    for each migrated loader — preserving the existence-hiding invariant.
 */

import type { HttpError } from "@sveltejs/kit";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createAuth } from "$lib/server/auth";
import type * as schema from "$lib/server/db/schema";
import { setupTestDatabase } from "$lib/server/db/test-db";
import { getSession } from "$lib/server/session";
import { seedProject } from "../../fixtures/db";

// Import load functions as any to avoid the void | PageData union type issues
// from SvelteKit's generated types in test contexts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LoadFn = (event: never) => Promise<any>;

const loadDashboard = (await import("../../../src/routes/(app)/+page.server")).load as LoadFn;
const loadProjectLogs = (await import("../../../src/routes/(app)/projects/[id]/+page.server"))
  .load as LoadFn;
const loadProjectSettings = (
  await import("../../../src/routes/(app)/projects/[id]/settings/+page.server")
).load as LoadFn;
const loadProjectStats = (
  await import("../../../src/routes/(app)/projects/[id]/stats/+page.server")
).load as LoadFn;
const loadProjectIncidents = (
  await import("../../../src/routes/(app)/projects/[id]/incidents/+page.server")
).load as LoadFn;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    },
    fetch: globalThis.fetch,
    getClientAddress: () => "127.0.0.1",
    setHeaders: () => {},
    depends: () => {},
    parent: async () => ({}),
  } as unknown;
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
    const httpError = err as HttpError;
    expect(httpError.status).toBe(404);
    expect(httpError.body).toMatchObject({ message: "Project not found" });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Dashboard (root list loader)
  // -------------------------------------------------------------------------
  describe("(app)/+page.server.ts — dashboard list loader", () => {
    it("returns only the authenticated owner's projects via injected PGlite DB", async () => {
      const ownedProject = await seedProject(db, { name: "owned-project", ownerId: owner.userId });
      await seedProject(db, { name: "other-project", ownerId: nonOwner.userId });

      const event = createLoadEvent(db, {}, owner.locals);
      const data = await loadDashboard(event as never);

      expect(data.projects).toHaveLength(1);
      expect(data.projects[0]!.id).toBe(ownedProject.id);
    });

    it("returns empty array when owner has no projects", async () => {
      const event = createLoadEvent(db, {}, owner.locals);
      const data = await loadDashboard(event as never);
      expect(data.projects).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Projects/[id] — logs loader
  // -------------------------------------------------------------------------
  describe("(app)/projects/[id]/+page.server.ts — logs loader", () => {
    it("returns project data via injected PGlite DB for the owner", async () => {
      const proj = await seedProject(db, { name: "test-proj", ownerId: owner.userId });

      const event = createLoadEvent(db, { id: proj.id }, owner.locals);
      const data = await loadProjectLogs(event as never);

      expect(data.project.id).toBe(proj.id);
      expect(data.project.name).toBe("test-proj");
    });

    it("throws SvelteKit 404 for a non-owner (existence hidden)", async () => {
      const proj = await seedProject(db, { name: "other-proj", ownerId: owner.userId });

      const event = createLoadEvent(db, { id: proj.id }, nonOwner.locals);
      await expectSvelteKit404(loadProjectLogs(event as never));
    });

    it("throws SvelteKit 404 for a project that does not exist", async () => {
      const event = createLoadEvent(db, { id: "nonexistent-id" }, owner.locals);
      await expectSvelteKit404(loadProjectLogs(event as never));
    });
  });

  // -------------------------------------------------------------------------
  // Projects/[id]/stats — stats loader
  // -------------------------------------------------------------------------
  describe("(app)/projects/[id]/stats/+page.server.ts — stats loader", () => {
    it("returns stats data via injected PGlite DB for the owner", async () => {
      const proj = await seedProject(db, { name: "stats-proj", ownerId: owner.userId });

      const event = createLoadEvent(db, { id: proj.id }, owner.locals);
      const data = await loadProjectStats(event as never);

      expect(data.project.id).toBe(proj.id);
      expect(data.stats).toBeDefined();
    });

    it("throws SvelteKit 404 for a non-owner", async () => {
      const proj = await seedProject(db, { name: "stats-proj", ownerId: owner.userId });

      const event = createLoadEvent(db, { id: proj.id }, nonOwner.locals);
      await expectSvelteKit404(loadProjectStats(event as never));
    });
  });

  // -------------------------------------------------------------------------
  // Projects/[id]/settings — settings loader
  // -------------------------------------------------------------------------
  describe("(app)/projects/[id]/settings/+page.server.ts — settings loader", () => {
    it("returns settings data via injected PGlite DB for the owner", async () => {
      const proj = await seedProject(db, { name: "settings-proj", ownerId: owner.userId });

      const event = createLoadEvent(db, { id: proj.id }, owner.locals);
      const data = await loadProjectSettings(event as never);

      expect(data.project.id).toBe(proj.id);
      expect(data.project.retentionDays).toBeDefined();
    });

    it("throws SvelteKit 404 for a non-owner", async () => {
      const proj = await seedProject(db, { name: "settings-proj", ownerId: owner.userId });

      const event = createLoadEvent(db, { id: proj.id }, nonOwner.locals);
      await expectSvelteKit404(loadProjectSettings(event as never));
    });
  });

  // -------------------------------------------------------------------------
  // Projects/[id]/incidents — incidents loader
  // -------------------------------------------------------------------------
  describe("(app)/projects/[id]/incidents/+page.server.ts — incidents loader", () => {
    it("returns incidents data via injected PGlite DB for the owner", async () => {
      const proj = await seedProject(db, { name: "incidents-proj", ownerId: owner.userId });

      const event = createLoadEvent(db, { id: proj.id }, owner.locals);
      const data = await loadProjectIncidents(event as never);

      expect(data.project.id).toBe(proj.id);
      expect(data.incidents).toBeDefined();
    });

    it("throws SvelteKit 404 for a non-owner", async () => {
      const proj = await seedProject(db, { name: "incidents-proj", ownerId: owner.userId });

      const event = createLoadEvent(db, { id: proj.id }, nonOwner.locals);
      await expectSvelteKit404(loadProjectIncidents(event as never));
    });
  });
});
