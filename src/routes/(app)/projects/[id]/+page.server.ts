import { getDbClient } from "$lib/server/db/db";
import { InvalidCursorError, queryLogs } from "$lib/server/utils/log-query";
import { requireProjectOwnershipPage } from "$lib/server/utils/project-guard";
import { parseLevelFilter } from "$lib/shared/schemas/log";
import { env } from "$lib/server/config/env";
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

  const filter = {
    projectId,
    levels,
    from: fromDate,
    to: null,
    search: searchParam,
    cursor: cursorParam,
    limit,
    offset,
  };

  let result: Awaited<ReturnType<typeof queryLogs>>;
  try {
    result = await queryLogs(db, filter);
  } catch (err) {
    if (!(err instanceof InvalidCursorError)) throw err;
    console.error("[page/logs] invalid cursor, falling back to first page:", err);
    result = await queryLogs(db, { ...filter, cursor: null });
  }

  const total = result.total ?? 0;

  return {
    project: {
      id: projectData.id,
      name: projectData.name,
      apiKeyHash: projectData.apiKeyHash,
      retentionDays: projectData.retentionDays,
      createdAt: projectData.createdAt?.toISOString() ?? null,
      updatedAt: projectData.updatedAt?.toISOString() ?? null,
    },
    logs: result.logs.map((l) => ({
      ...l,
      timestamp: l.timestamp?.toISOString() ?? null,
    })),
    pagination: {
      total,
      totalIsCapped: result.totalIsCapped,
      hasMore: result.hasMore,
      limit,
      offset,
      nextCursor: result.nextCursor,
    },
    filters: {
      levels: levels ?? [],
      search: searchParam ?? "",
      range: rangeParam,
    },
    appUrl: env.ORIGIN || event.url.origin,
  };
};
