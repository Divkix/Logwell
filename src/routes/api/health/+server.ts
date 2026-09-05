import { json } from "@sveltejs/kit";
import { sql } from "drizzle-orm";
import { type DatabaseClient, getDbClient } from "$lib/server/db/db";
import type { RequestEvent } from "./$types";

const serverStartTime = Date.now();

async function checkDatabase(
  db: DatabaseClient | null,
): Promise<{ connected: boolean; error?: string }> {
  if (!db) {
    return { connected: false, error: "Database client not available" };
  }
  try {
    await db.execute(sql`SELECT 1`);
    return { connected: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error";
    return { connected: false, error: message };
  }
}

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
  } catch {}
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
