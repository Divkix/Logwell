import { createLogStreamResponse } from "$lib/server/live-stream";
import { requireOwnedProjectRoute } from "$lib/server/utils/owned-project";
import type { RequestEvent } from "./$types";

/** POST /api/projects/[id]/logs/stream — guard + delegate (contract: createProjectStreamResponse). */
export async function POST(event: RequestEvent): Promise<Response> {
  const authResult = await requireOwnedProjectRoute(event, event.params.id);
  if (authResult instanceof Response) return authResult;

  return createLogStreamResponse(event.params.id);
}
