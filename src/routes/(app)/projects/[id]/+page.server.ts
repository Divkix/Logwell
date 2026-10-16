import { error } from "@sveltejs/kit";
import { InvalidCursorError, OffsetTooLargeError, queryLogs } from "#lib/server/utils/log-query.js";
import { requireOwnedProjectPage } from "#lib/server/utils/owned-project.js";
import { parseLevelFilter } from "#lib/shared/schemas/log.js";
import { env } from "#lib/server/config/env.js";
import { getTimeRangeStart } from "#lib/utils/format.js";
import { parseTimeRange, type TimeRange } from "#lib/utils/time-range.js";
import type { PageServerLoad } from "./$types";

const DEFAULT_LIMIT = 100;

const MIN_LIMIT = 1;

const MAX_LIMIT = 500;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export const load: PageServerLoad = async (event) => {
  const projectId = event.params.id;
  const { project: projectData, db } = await requireOwnedProjectPage(event, projectId);

  const url = event.url;
  const limitParam = url.searchParams.get("limit");
  const offsetParam = url.searchParams.get("offset");
  const cursorParam = url.searchParams.get("cursor");
  const levelParam = url.searchParams.get("level");
  const searchParam = url.searchParams.get("search");
  const range: TimeRange = parseTimeRange(url.searchParams.get("range")) ?? "1h";

  const limit = clamp(
    limitParam ? Number.parseInt(limitParam, 10) || DEFAULT_LIMIT : DEFAULT_LIMIT,
    MIN_LIMIT,
    MAX_LIMIT,
  );

  const offset = offsetParam ? Math.max(0, Number.parseInt(offsetParam, 10) || 0) : 0;

  const levels = parseLevelFilter(levelParam);
  const fromDate = getTimeRangeStart(range);

  let filter = {
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
    if (err instanceof OffsetTooLargeError) error(400, err.message);

    if (!(err instanceof InvalidCursorError)) throw err;
    console.error("[page/logs] invalid cursor, falling back to first page:", err);
    // Offset 0 too: queryLogs ignored the URL offset while the cursor was set, and re-applying
    // it here could throw OffsetTooLargeError outside the 400 mapping above.
    filter = { ...filter, cursor: null, offset: 0 };
    result = await queryLogs(db, filter);
  }

  const total = result.total ?? 0;

  return {
    project: {
      id: projectData.id,
      name: projectData.name,
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
      offset: filter.offset,
      nextCursor: result.nextCursor,
    },
    filters: {
      levels: levels ?? [],
      search: searchParam ?? "",
      range,
      from: fromDate.toISOString(),
    },
    appUrl: env.ORIGIN || event.url.origin,
  };
};
