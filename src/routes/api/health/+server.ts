import { sql } from "drizzle-orm";
import { type DatabaseClient, getHealthDbClient } from "#lib/server/db/db.js";
import type { RequestEvent } from "./$types";

const serverStartTime = Date.now();

/**
 * Overall deadline for the database probe, well under the 10s Docker/compose HEALTHCHECK
 * timeout so the endpoint always answers (503) instead of letting curl time out.
 */
const HEALTH_CHECK_TIMEOUT_MS = 3000;

async function checkDatabase(
  db: DatabaseClient | null,
): Promise<{ connected: boolean; error?: string }> {
  if (!db) {
    return { connected: false, error: "Database client not available" };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`database check timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`)),
      HEALTH_CHECK_TIMEOUT_MS,
    );
  });

  try {
    // race() subscribes to both promises, so a probe that settles after the deadline is still
    // handled and never becomes an unhandled rejection.
    await Promise.race([db.execute(sql`SELECT 1`), deadline]);

    return { connected: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error";

    return { connected: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

interface HealthResponse {
  status: "healthy" | "unhealthy";
  database: "connected" | "disconnected";
  timestamp: string;
  uptime: number;
  error?: string;
}

/**
 * GET /api/health
 *
 * Health check endpoint for monitoring and Docker health checks.
 * Does NOT require authentication (public endpoint), so it reports no version or build detail.
 * Probes the database over a dedicated connection with a 3s deadline.
 *
 * Returns:
 * - 200 OK: All systems healthy
 * - 503 Service Unavailable: Database down or the probe timed out
 *
 * Response body:
 * {
 *   status: "healthy" | "unhealthy",
 *   database: "connected" | "disconnected",
 *   timestamp: string (ISO 8601),
 *   uptime: number (seconds),
 *   error?: string (only when unhealthy)
 * }
 */
export async function GET(event: RequestEvent): Promise<Response> {
  let db: DatabaseClient | null = null;

  try {
    db = await getHealthDbClient(event.locals);
  } catch {}

  const dbStatus = await checkDatabase(db);

  const isHealthy = dbStatus.connected;
  const uptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1000);

  const responseBody: HealthResponse = {
    status: isHealthy ? "healthy" : "unhealthy",
    database: dbStatus.connected ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
    uptime: uptimeSeconds,
  };

  if (!isHealthy && dbStatus.error) {
    console.error("[health] Database connectivity check failed:", dbStatus.error);
    responseBody.error = "database unavailable";
  }

  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-cache, no-store, must-revalidate",
  });

  return Response.json(responseBody, {
    status: isHealthy ? 200 : 503,
    headers,
  });
}
