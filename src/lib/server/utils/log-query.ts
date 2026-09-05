import { and, desc, eq, gte, inArray, lte, type SQL, sql } from "drizzle-orm";
import type { DatabaseClient } from "$lib/server/db/db";
import { log, type LogLevel } from "$lib/server/db/schema";
import { cappedLogCount } from "$lib/server/utils/capped-count";
import {
  cursorRowLessThan,
  decodeCursor,
  encodeCursor,
  microsColumn,
} from "$lib/server/utils/cursor";
import { buildSearchQuery } from "$lib/server/utils/search";

export class InvalidCursorError extends Error {
  constructor(message = "Invalid cursor") {
    super(message);
    this.name = "InvalidCursorError";
  }
}

export interface LogQueryFilter {
  projectId: string;
  levels?: LogLevel[] | null;
  from?: Date | null;
  to?: Date | null;
  search?: string | null;
  cursor?: string | null;
  limit: number;
  offset?: number;
}

export interface QueriedLog {
  id: string;
  projectId: string;
  incidentId: string | null;
  fingerprint: string | null;
  serviceName: string | null;
  level: LogLevel;
  message: string;
  metadata: unknown;
  sourceFile: string | null;
  lineNumber: number | null;
  requestId: string | null;
  userId: string | null;
  ipAddress: string | null;
  timestamp: Date;
}

export interface LogQueryResult {
  logs: QueriedLog[];
  total: number | null;
  totalIsCapped: boolean;
  hasMore: boolean;
  nextCursor: string | null;
}

export async function queryLogs(
  db: DatabaseClient,
  filter: LogQueryFilter,
): Promise<LogQueryResult> {
  const conditions: SQL[] = [eq(log.projectId, filter.projectId)];

  if (filter.cursor) {
    let cursorMicros: number;
    let cursorId: string;
    try {
      ({ micros: cursorMicros, id: cursorId } = decodeCursor(filter.cursor));
    } catch (error) {
      throw new InvalidCursorError(error instanceof Error ? error.message : "Invalid cursor");
    }
    conditions.push(cursorRowLessThan(log.timestamp, log.id, cursorMicros, cursorId));
  }

  if (filter.levels && filter.levels.length > 0) {
    conditions.push(inArray(log.level, filter.levels));
  }

  if (filter.from) {
    conditions.push(gte(log.timestamp, filter.from));
  }
  if (filter.to) {
    conditions.push(lte(log.timestamp, filter.to));
  }

  if (filter.search?.trim()) {
    const tsquery = buildSearchQuery(filter.search);
    if (tsquery) {
      conditions.push(sql`${log.search} @@ to_tsquery('english', ${tsquery})`);
    }
  }

  const whereClause = and(...conditions);

  const countResult = filter.cursor ? undefined : await cappedLogCount(db, whereClause);

  const rows = await db
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
      micros: microsColumn(log.timestamp),
    })
    .from(log)
    .where(whereClause)
    .orderBy(desc(log.timestamp), desc(log.id))
    .limit(filter.limit + 1)
    .offset(filter.cursor ? 0 : (filter.offset ?? 0));

  const hasMore = rows.length > filter.limit;
  const page = hasMore ? rows.slice(0, filter.limit) : rows;
  const last = page.at(-1);
  const nextCursor = hasMore && last ? encodeCursor(Math.round(last.micros), last.id) : null;
  const logsToReturn = page.map(
    // oxlint-disable-next-line no-unused-vars
    ({ micros, ...queried }) => queried,
  );

  return {
    logs: logsToReturn,
    total: countResult?.total ?? null,
    totalIsCapped: countResult?.capped ?? false,
    hasMore,
    nextCursor,
  };
}
