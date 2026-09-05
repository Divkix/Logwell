import type { RequestHandler } from "@sveltejs/kit";
import { getDbClient } from "$lib/server/db/db";
import { ingestLogs } from "$lib/server/utils/ingest";
import { parseOtlpIngestBody } from "$lib/server/utils/otlp";

/**
 * POST /v1/logs (OTLP/HTTP JSON)
 *
 * Accepts OTLP log exports via JSON Protobuf mapping.
 * Uses project API key authentication (Authorization: Bearer lw_xxx).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  const db = await getDbClient(locals);
  return ingestLogs(request, db, parseOtlpIngestBody);
};
