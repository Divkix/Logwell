import type { PgliteDatabase } from "drizzle-orm/pglite";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type * as schema from "../../../src/lib/server/db/schema";
import { setupTestDatabase } from "../../../src/lib/server/db/test-db";
import { InvalidCursorError, queryLogs } from "../../../src/lib/server/utils/log-query";
import { seedLog, seedProject } from "../../fixtures/db";

describe("queryLogs module", () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;
  let projectId: string;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
    projectId = (await seedProject(db)).id;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("filters by level and reports totals on the first page", async () => {
    await seedLog(db, projectId, { level: "info", message: "all good" });
    await seedLog(db, projectId, { level: "error", message: "it broke" });

    const result = await queryLogs(db, { projectId, levels: ["error"], limit: 100 });

    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]!.message).toBe("it broke");
    expect(result.total).toBe(1);
    expect(result.totalIsCapped).toBe(false);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("paginates by cursor without duplicates or gaps", async () => {
    for (let i = 0; i < 5; i++) {
      await seedLog(db, projectId, {
        level: "info",
        message: `log ${i}`,
        timestamp: new Date(Date.now() + i * 1000),
      });
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await queryLogs(db, { projectId, limit: 2, cursor });
      if (cursor) expect(page.total).toBeNull();
      else expect(page.total).toBe(5);
      seen.push(...page.logs.map((entry) => entry.id));
      cursor = page.nextCursor;
      pages += 1;
      if (!page.hasMore) break;
    } while (cursor);

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(pages).toBe(3);
  });

  it("throws InvalidCursorError for malformed cursors", async () => {
    await expect(queryLogs(db, { projectId, limit: 10, cursor: "not-a-cursor" })).rejects.toThrow(
      InvalidCursorError,
    );
  });

  it("narrows by full-text search", async () => {
    await seedLog(db, projectId, { level: "info", message: "database connection pool ready" });
    await seedLog(db, projectId, { level: "info", message: "unrelated startup message" });

    const result = await queryLogs(db, { projectId, search: "database", limit: 100 });

    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]!.message).toContain("database");
  });

  it("narrows by time range", async () => {
    const base = Date.now();
    await seedLog(db, projectId, {
      level: "info",
      message: "old",
      timestamp: new Date(base - 3600_000),
    });
    await seedLog(db, projectId, { level: "info", message: "new", timestamp: new Date(base) });

    const result = await queryLogs(db, {
      projectId,
      from: new Date(base - 60_000),
      to: new Date(base + 60_000),
      limit: 100,
    });

    expect(result.logs.map((entry) => entry.message)).toEqual(["new"]);
  });

  it("supports offset for back-compat callers", async () => {
    for (let i = 0; i < 3; i++) {
      await seedLog(db, projectId, {
        level: "info",
        message: `log ${i}`,
        timestamp: new Date(Date.now() + i * 1000),
      });
    }

    const first = await queryLogs(db, { projectId, limit: 10 });
    const skipped = await queryLogs(db, { projectId, limit: 10, offset: 1 });

    expect(first.logs).toHaveLength(3);
    expect(skipped.logs).toHaveLength(2);
    expect(skipped.logs[0]!.id).toBe(first.logs[1]!.id);
  });

  it("ignores cursor offset and isolates projects", async () => {
    const otherId = (await seedProject(db, { name: `other-${nanoid(8)}` })).id;
    await seedLog(db, projectId, { level: "info", message: "mine" });
    await seedLog(db, otherId, { level: "info", message: "theirs" });

    const result = await queryLogs(db, { projectId, limit: 100 });
    expect(result.logs.map((entry) => entry.message)).toEqual(["mine"]);
  });
});
