import { and, desc, eq, gte, inArray, lt, or, type SQL, sql } from "drizzle-orm";
import { env } from "$lib/server/config/env";
import { getDbClient } from "$lib/server/db/db";
import { log } from "$lib/server/db/schema";
import { cappedLogCount } from "$lib/server/utils/capped-count";
import { decodeCursor, encodeCursor } from "$lib/server/utils/cursor";
import { requireProjectOwnershipPage } from "$lib/server/utils/project-guard";
import { buildSearchQuery } from "$lib/server/utils/search";
import { parseLevelFilter } from "$lib/shared/schemas/log";
import { getTimeRangeStart } from "$lib/utils/format";
import { parseTimeRange } from "$lib/utils/time-range";
import type { PageServerLoad } from "./$types";

const DEFAULT_LIMIT = 100;
const MIN_LIMIT = 1;
const MAX_LIMIT = 500;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export const load: PageServerLoad = async (event) => {
  const projectId = event.params.id;
  const { project: projectData } = await requireProjectOwnershipPage(event, projectId);
  const db = await getDbClient(event.locals);

  const url = event.url;
  const limitParam = url.searchParams.get("limit");
  const offsetParam = url.searchParams.get("offset");
  const cursorParam = url.searchParams.get("cursor");
  const levelParam = url.searchParams.get("level");
  const searchParam = url.searchParams.get("search");
  const rangeParam = url.searchParams.get("range") || "1h";

  const limit = clamp(
    limitParam ? Number.parseInt(limitParam, 10) || DEFAULT_LIMIT : DEFAULT_LIMIT,
    MIN_LIMIT,
    MAX_LIMIT,
  );
  const offset = offsetParam ? Math.max(0, Number.parseInt(offsetParam, 10) || 0) : 0;

  const levels = parseLevelFilter(levelParam);
  const range = parseTimeRange(rangeParam);
  const fromDate = range ? getTimeRangeStart(range) : null;

  const conditions: SQL[] = [eq(log.projectId, projectId)];

  if (cursorParam) {
    try {
      const { timestamp: cursorTimestamp, id: cursorId } = decodeCursor(cursorParam);

      conditions.push(
        or(
          lt(log.timestamp, cursorTimestamp),
          and(eq(log.timestamp, cursorTimestamp), lt(log.id, cursorId)),
        ) as SQL,
      );
    } catch (err) {
      console.error("[page/logs] invalid cursor, falling back to first page:", err);
    }
  }

  if (levels && levels.length > 0) {
    conditions.push(inArray(log.level, levels));
  }

  if (fromDate) {
    conditions.push(gte(log.timestamp, fromDate));
  }

  if (searchParam?.trim()) {
    const tsquery = buildSearchQuery(searchParam);
    if (tsquery) {
      conditions.push(sql`${log.search} @@ to_tsquery('english', ${tsquery})`);
    }
  }

  const whereClause = and(...conditions);

  const pageCountResult = cursorParam ? undefined : await cappedLogCount(db, whereClause);
  const total = pageCountResult?.total ?? 0;
  const totalIsCapped = pageCountResult?.capped ?? false;

  const logs = await db
    .select({
      id: log.id,
      projectId: log.projectId,
      incidentId: log.incidentId,
      fingerprint: log.fingerprint,
      serviceName: log.serviceName,
      level: log.level,
      message: log.message,
      metadata: log.metadata,
      sourceFile: log.sourceFile,
      lineNumber: log.lineNumber,
      requestId: log.requestId,
      userId: log.userId,
      ipAddress: log.ipAddress,
      timestamp: log.timestamp,
    })
    .from(log)
    .where(whereClause)
    .orderBy(desc(log.timestamp), desc(log.id))
    .limit(limit + 1)
    .offset(cursorParam ? 0 : offset);

  const hasMore = logs.length > limit;

  const logsToReturn = hasMore ? logs.slice(0, limit) : logs;

  const nextCursor =
    hasMore && logsToReturn.length > 0
      ? encodeCursor(logsToReturn.at(-1)!.timestamp as Date, logsToReturn.at(-1)!.id)
      : null;

  return {
    project: {
      id: projectData.id,
      name: projectData.name,
      apiKeyHash: projectData.apiKeyHash,
      retentionDays: projectData.retentionDays,
      createdAt: projectData.createdAt?.toISOString() ?? null,
      updatedAt: projectData.updatedAt?.toISOString() ?? null,
    },
    logs: logsToReturn.map((l) => ({
      ...l,
      timestamp: l.timestamp?.toISOString() ?? null,
    })),
    pagination: {
      total,
      totalIsCapped,
      hasMore,
      limit,
      offset,
      nextCursor,
    },
    filters: {
      levels: levels ?? [],
      search: searchParam ?? "",
      range: rangeParam,
    },
    appUrl: env.ORIGIN || event.url.origin,
  };
};
