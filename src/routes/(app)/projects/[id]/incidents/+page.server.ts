import { and, count, desc, eq, gte, lt, or, type SQL } from "drizzle-orm";
import { INCIDENT_CONFIG } from "$lib/server/config/performance";
import { getDbClient } from "$lib/server/db/db";
import { incident } from "$lib/server/db/schema";
import { decodeCursor, encodeCursor } from "$lib/server/utils/cursor";
import { requireProjectOwnershipPage } from "$lib/server/utils/project-guard";
import { getIncidentStatus } from "$lib/server/utils/incidents";
import { INCIDENT_STATUSES, type IncidentRange, type IncidentStatus } from "$lib/shared/types";
import { getTimeRangeStart } from "$lib/utils/format";
import { parseTimeRange } from "$lib/utils/time-range";
import type { PageServerLoad } from "./$types";

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 20;
const MAX_LIMIT = 200;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export const load: PageServerLoad = async (event) => {
  const projectId = event.params.id;
  const { project: projectData } = await requireProjectOwnershipPage(event, projectId);
  const db = await getDbClient(event.locals);

  const params = event.url.searchParams;
  const limit = clamp(
    params.get("limit")
      ? Number.parseInt(params.get("limit") || "", 10) || DEFAULT_LIMIT
      : DEFAULT_LIMIT,
    MIN_LIMIT,
    MAX_LIMIT,
  );
  const cursorParam = params.get("cursor");
  const statusParam = params.get("status") || "open";
  const status: IncidentStatus = INCIDENT_STATUSES.includes(statusParam as IncidentStatus)
    ? (statusParam as IncidentStatus)
    : "open";
  const range: IncidentRange = parseTimeRange(params.get("range")) ?? "24h";

  const rangeStart = getTimeRangeStart(range);
  const resolvedThreshold = new Date(Date.now() - INCIDENT_CONFIG.AUTO_RESOLVE_MINUTES * 60 * 1000);
  const conditions: SQL[] = [eq(incident.projectId, projectId), gte(incident.lastSeen, rangeStart)];

  if (status === "open") {
    conditions.push(gte(incident.lastSeen, resolvedThreshold));
  } else if (status === "resolved") {
    conditions.push(lt(incident.lastSeen, resolvedThreshold));
  }

  if (cursorParam) {
    try {
      const { timestamp: cursorTimestamp, id: cursorId } = decodeCursor(cursorParam);
      conditions.push(
        or(
          lt(incident.lastSeen, cursorTimestamp),
          and(eq(incident.lastSeen, cursorTimestamp), lt(incident.id, cursorId)),
        ) as SQL,
      );
    } catch (err) {
      // Invalid cursor - log and fall back to first page (consistent with API behavior)
      console.error("[page/incidents] invalid cursor, falling back to first page:", err);
    }
  }

  const whereClause = and(...conditions);
  const [countResult] = await db.select({ count: count() }).from(incident).where(whereClause);
  const total = countResult?.count ?? 0;

  const incidents = await db
    .select()
    .from(incident)
    .where(whereClause)
    .orderBy(desc(incident.lastSeen), desc(incident.id))
    .limit(limit + 1);

  const hasMore = incidents.length > limit;
  const incidentsToReturn = hasMore ? incidents.slice(0, limit) : incidents;

  const nextCursor =
    hasMore && incidentsToReturn.length > 0
      ? encodeCursor(incidentsToReturn.at(-1)!.lastSeen as Date, incidentsToReturn.at(-1)!.id)
      : null;

  return {
    project: {
      id: projectData.id,
      name: projectData.name,
    },
    incidents: incidentsToReturn.map((i) => ({
      id: i.id,
      projectId: i.projectId,
      fingerprint: i.fingerprint,
      title: i.title,
      normalizedMessage: i.normalizedMessage,
      serviceName: i.serviceName,
      sourceFile: i.sourceFile,
      lineNumber: i.lineNumber,
      highestLevel: i.highestLevel,
      firstSeen: i.firstSeen.toISOString(),
      lastSeen: i.lastSeen.toISOString(),
      totalEvents: i.totalEvents,
      status: getIncidentStatus(i.lastSeen),
    })),
    pagination: {
      total,
      hasMore,
      nextCursor,
      limit,
    },
    filters: {
      status,
      range,
      selectedIncidentId: params.get("incident"),
    },
  };
};
