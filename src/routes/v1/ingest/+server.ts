import type { RequestHandler } from "@sveltejs/kit";
import { getDbClient } from "$lib/server/db/db";
import { ingestLogs } from "$lib/server/utils/ingest";
import { parseSimpleIngestBody } from "$lib/server/utils/simple-ingest";

/**
 * POST /v1/ingest (Simple JSON API)
 *
 * Accepts logs in a simple JSON format for easy integration.
 * Uses project API key authentication (Authorization: Bearer lw_xxx).
 *
 * Single log:
 * { "level": "info", "message": "Hello", "service": "my-app", "metadata": {...} }
 *
 * Batch:
 * [{ "level": "info", "message": "Log 1" }, { "level": "error", "message": "Log 2" }]
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  const db = await getDbClient(locals);
  return ingestLogs(request, db, parseSimpleIngestBody);
};
