import { eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createAuth } from "#lib/server/auth.js";
import type * as schema from "#lib/server/db/schema.js";
import { incident, log, project } from "#lib/server/db/schema.js";
import { setupTestDatabase } from "#lib/server/db/test-db.js";
import { logEventBus } from "#lib/server/events.js";
import { cleanupOldLogs } from "#lib/server/jobs/log-cleanup.js";
import { purgeDeletedProjects } from "#lib/server/jobs/project-purge.js";
import { getSession } from "#lib/server/session.js";
import { clearApiKeyCache } from "#lib/server/utils/api-key.js";
import {
  GET as GET_PROJECTS,
  POST as POST_PROJECTS,
} from "../../../../src/routes/api/projects/+server";
import { DELETE, GET as GET_PROJECT } from "../../../../src/routes/api/projects/[id]/+server";
import { POST as INGEST } from "../../../../src/routes/v1/ingest/+server";
import { seedLogs, seedProject, seedProjectWithApiKey } from "../../../fixtures/db";

type ProjectsRouteEvent = Parameters<typeof GET_PROJECTS>[0] & Parameters<typeof GET_PROJECT>[0];

function routeEvent(
  db: PgliteDatabase<typeof schema>,
  locals: Partial<App.Locals>,
  method: string,
  path: string,
  params: Record<string, string> = {},
  body?: string,
): ProjectsRouteEvent {
  const request = new Request(`http://localhost${path}`, {
    method,
    headers: { Origin: "http://localhost", "Content-Type": "application/json" },
    body,
  });

  // SAFETY: the project routes read only event.locals, event.request, event.url and
  // event.params — all set here — and every call passes an authenticated session, so
  // route.id, cookies and the remaining RequestEvent members are never accessed.
  return {
    request,
    locals: { db, ...locals },
    params,
    url: new URL(request.url),
    route: { id: "/api/projects" },
  } as ProjectsRouteEvent;
}

function ingest(db: PgliteDatabase<typeof schema>, apiKey: string) {
  const request = new Request("http://localhost/v1/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify([{ level: "info", message: "hello" }]),
  });

  // SAFETY: the ingest route destructures only { request, locals }.
  return INGEST({ request, locals: { db }, params: {}, url: new URL(request.url) } as Parameters<
    typeof INGEST
  >[0]);
}

describe("DELETE /api/projects/[id] (soft delete + background purge)", () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;
  let locals: Partial<App.Locals>;
  let userId: string;

  beforeEach(async () => {
    ({ db, cleanup } = await setupTestDatabase());
    clearApiKeyCache();
    logEventBus.clear();

    const auth = createAuth(db);

    const { token } = await auth.api.signUpEmail({
      body: { email: "deleter@example.com", password: "SecureP@ssw0rd123", name: "Deleter" },
    });

    const session = await getSession(
      new Headers({ cookie: `better-auth.session_token=${token}` }),
      db,
    );

    if (!session) throw new Error("Session data should not be null");
    userId = session.user.id;
    locals = { user: session.user, session: session.session };
  });

  afterEach(async () => {
    logEventBus.clear();
    await cleanup();
  });

  const deleteProject = (id: string) =>
    DELETE(routeEvent(db, locals, "DELETE", `/api/projects/${id}`, { id }));

  async function seedIncident(projectId: string): Promise<string> {
    const id = nanoid();
    const now = new Date();

    await db.insert(incident).values({
      id,
      projectId,
      fingerprint: `fp-${id}`,
      title: "boom",
      normalizedMessage: "boom",
      highestLevel: "error",
      firstSeen: now,
      lastSeen: now,
      totalEvents: 1,
    });

    return id;
  }

  it("hides the project from every lookup as soon as the request returns", async () => {
    const doomed = await seedProject(db, { ownerId: userId, name: "doomed" });
    const kept = await seedProject(db, { ownerId: userId, name: "kept" });
    await seedLogs(db, doomed.id, 3);

    const response = await deleteProject(doomed.id);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, id: doomed.id });

    const byId = await GET_PROJECT(
      routeEvent(db, locals, "GET", `/api/projects/${doomed.id}`, { id: doomed.id }),
    );

    expect(byId.status).toBe(404);

    const list = await GET_PROJECTS(routeEvent(db, locals, "GET", "/api/projects"));
    const { projects } = await list.json();
    expect(projects.map((p: { id: string }) => p.id)).toEqual([kept.id]);

    // A second delete finds nothing to delete.
    expect((await deleteProject(doomed.id)).status).toBe(404);

    // The data is still there until the purge runs.
    const [row] = await db.select().from(project).where(eq(project.id, doomed.id));
    expect(row?.deletedAt).toBeInstanceOf(Date);
  });

  it("frees the name for a new project immediately", async () => {
    const doomed = await seedProject(db, { ownerId: userId, name: "reused" });
    await deleteProject(doomed.id);

    const created = await POST_PROJECTS(
      routeEvent(db, locals, "POST", "/api/projects", {}, JSON.stringify({ name: "reused" })),
    );

    expect(created.status).toBe(201);
  });

  it("rejects ingest with the deleted project's key immediately, even when cached", async () => {
    const doomed = await seedProjectWithApiKey(db, { ownerId: userId });

    // Warm the API key cache.
    expect((await ingest(db, doomed.apiKey)).status).toBe(200);

    await deleteProject(doomed.id);

    expect((await ingest(db, doomed.apiKey)).status).toBe(401);
    expect(await db.select().from(log).where(eq(log.projectId, doomed.id))).toHaveLength(1);
  });

  it("purges logs, incidents and finally the row, leaving other projects alone", async () => {
    const doomed = await seedProject(db, { ownerId: userId });
    const kept = await seedProject(db, { ownerId: userId });
    await seedLogs(db, doomed.id, 5);
    await seedLogs(db, kept.id, 2);
    await seedIncident(doomed.id);
    await seedIncident(doomed.id);
    const keptIncident = await seedIncident(kept.id);

    await deleteProject(doomed.id);
    const result = await purgeDeletedProjects(db, { batchSize: 2, batchPauseMs: 0 });

    expect(result).toEqual({ projectsPurged: 1, logsDeleted: 5, incidentsDeleted: 2, errors: [] });
    expect(await db.select().from(project).where(eq(project.id, doomed.id))).toHaveLength(0);
    expect(await db.select().from(log).where(eq(log.projectId, doomed.id))).toHaveLength(0);
    expect(await db.select().from(log).where(eq(log.projectId, kept.id))).toHaveLength(2);
    expect((await db.select({ id: incident.id }).from(incident)).map((row) => row.id)).toEqual([
      keptIncident,
    ]);
  });

  it("resumes an interrupted purge on the next run", async () => {
    const doomed = await seedProject(db, { ownerId: userId });
    await seedLogs(db, doomed.id, 5);
    await deleteProject(doomed.id);

    // The process dies after the first batch: the pause between batches never returns.
    const interrupted = await purgeDeletedProjects(db, {
      batchSize: 2,
      batchPauseMs: 1,
      sleep: () => Promise.reject(new Error("SIGTERM")),
    });

    expect(interrupted.projectsPurged).toBe(0);
    expect(interrupted.errors).toEqual([`Failed to purge project ${doomed.id}: SIGTERM`]);
    expect(await db.select().from(log).where(eq(log.projectId, doomed.id))).toHaveLength(3);

    const resumed = await purgeDeletedProjects(db, { batchSize: 2, batchPauseMs: 0 });

    expect(resumed).toMatchObject({ projectsPurged: 1, logsDeleted: 3, errors: [] });
    expect(await db.select().from(project).where(eq(project.id, doomed.id))).toHaveLength(0);
  });

  it("leaves a deleted project's logs to the purge, not retention", async () => {
    const doomed = await seedProject(db, { ownerId: userId, retentionDays: 1 });
    await seedLogs(db, doomed.id, 2, { timestamp: new Date(Date.now() - 7 * 86_400_000) });
    await deleteProject(doomed.id);

    const result = await cleanupOldLogs(db, { batchPauseMs: 0 });

    expect(result.totalLogsDeleted).toBe(0);
    expect(result.projectsProcessed + result.projectsSkipped).toBe(0);
  });
});
