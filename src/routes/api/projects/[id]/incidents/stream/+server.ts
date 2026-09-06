import { createIncidentStreamResponse } from "$lib/server/live-stream";
import { requireOwnedProjectRoute } from "$lib/server/utils/owned-project";
import type { RequestEvent } from "./$types";

/** POST /api/projects/[id]/incidents/stream — guard + delegate (contract: createProjectStreamResponse). */
export async function POST(event: RequestEvent): Promise<Response> {
  const authResult = await requireOwnedProjectRoute(event, event.params.id);
  if (authResult instanceof Response) return authResult;

  return createIncidentStreamResponse(event.params.id);
}
