import { and, eq } from "drizzle-orm";
import { incident } from "#lib/server/db/schema.js";
import { apiError } from "#lib/server/utils/api-error.js";
import { analyzeRecentIncidentEvents } from "#lib/server/utils/incident-analysis.js";
import { getIncidentStatus } from "#lib/server/utils/incidents.js";
import { requireOwnedProjectRoute } from "#lib/server/utils/owned-project.js";
import type { IncidentDetail } from "#lib/shared/schemas/incident.js";
import type { RequestEvent } from "./$types";

/**
 * GET /api/projects/[id]/incidents/[incidentId]
 *
 * Root-cause candidates and correlations cover the incident's most recent 10,000 events
 * (INCIDENT_ANALYSIS_EVENT_LIMIT); `analyzedEvents` says how many that was.
 */
export async function GET(event: RequestEvent): Promise<Response> {
  const authResult = await requireOwnedProjectRoute(event, event.params.id);

  if (authResult instanceof Response) return authResult;

  const { db } = authResult;
  const projectId = event.params.id;
  const incidentId = event.params.incidentId;

  const [incidentRow] = await db
    .select()
    .from(incident)
    .where(and(eq(incident.projectId, projectId), eq(incident.id, incidentId)));

  if (!incidentRow) {
    return apiError(404, "not_found", "Incident not found");
  }

  const analysis = await analyzeRecentIncidentEvents(db, projectId, incidentId);

  return Response.json({
    id: incidentRow.id,
    projectId: incidentRow.projectId,
    fingerprint: incidentRow.fingerprint,
    title: incidentRow.title,
    normalizedMessage: incidentRow.normalizedMessage,
    serviceName: incidentRow.serviceName,
    sourceFile: incidentRow.sourceFile,
    lineNumber: incidentRow.lineNumber,
    highestLevel: incidentRow.highestLevel,
    firstSeen: incidentRow.firstSeen.toISOString(),
    lastSeen: incidentRow.lastSeen.toISOString(),
    totalEvents: incidentRow.totalEvents,
    status: getIncidentStatus(incidentRow.lastSeen),
    ...analysis,
  } satisfies IncidentDetail);
}
