import { json } from "@sveltejs/kit";
import { sql } from "drizzle-orm";
import { type DatabaseClient, getDbClient } from "$lib/server/db/db";
import type { RequestEvent } from "./$types";

// Track server start time for uptime calculation
const serverStartTime = Date.now();

/**
 * Check database connectivity by executing a simple query.
 * Returns `null` when the client could not be constructed (e.g. missing env).
 */
async function checkDatabase(
  db: DatabaseClient | null,
): Promise<{ connected: boolean; error?: string }> {
  if (!db) {
    return { connected: false, error: "Database client not available" };
  }
  try {
    // Execute a simple query to verify connectivity
    await db.execute(sql`SELECT 1`);
    return { connected: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error";
    return { connected: false, error: message };
  }
}

/**
 * Health check response type
 */
interface HealthResponse {
  status: "healthy" | "unhealthy";
  database: "connected" | "disconnected";
  timestamp: string;
  uptime: number;
  version: string;
  error?: string;
}

/**
 * GET /api/health
 *
 * Health check endpoint for monitoring and Docker health checks.
 * Does NOT require authentication (public endpoint).
 *
 * Returns:
 * - 200 OK: All systems healthy
 * - 503 Service Unavailable: Database or other critical system down
 *
 * Response body:
 * {
 *   status: "healthy" | "unhealthy",
 *   database: "connected" | "disconnected",
 *   timestamp: string (ISO 8601),
 *   uptime: number (seconds),
 *   version: string,
 *   error?: string (only when unhealthy)
 * }
 */
export async function GET(event: RequestEvent): Promise<Response> {
  let db: DatabaseClient | null = null;
  try {
    db = await getDbClient(event.locals);
  } catch {
    // Production singleton failed to load (e.g. missing DATABASE_URL)
  }
  const dbStatus = await checkDatabase(db);

  const isHealthy = dbStatus.connected;
  const uptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1000);

  const responseBody: HealthResponse = {
    status: isHealthy ? "healthy" : "unhealthy",
    database: dbStatus.connected ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
    uptime: uptimeSeconds,
    version: __APP_VERSION__,
  };

  // Include generic error message when unhealthy (log the real error server-side)
  if (!isHealthy && dbStatus.error) {
    console.error("[health] Database connectivity check failed:", dbStatus.error);
    responseBody.error = "database unavailable";
  }

  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-cache, no-store, must-revalidate",
  });

  return json(responseBody, {
    status: isHealthy ? 200 : 503,
    headers,
  });
}
