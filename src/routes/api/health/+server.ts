import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '$lib/server/db/schema';
import type { RequestEvent } from './$types';

type DatabaseClient = PostgresJsDatabase<typeof schema> | PgliteDatabase<typeof schema>;

// Track server start time for uptime calculation
const serverStartTime = Date.now();

/**
 * Helper to get database client from locals or production db
 * Supports test injection via locals.db
 */
async function getDbClient(locals: App.Locals): Promise<DatabaseClient | null> {
  if (locals.db) {
    return locals.db as DatabaseClient;
  }
  try {
    const { db } = await import('$lib/server/db');
    return db;
  } catch {
    return null;
  }
}

/**
 * Check database connectivity by executing a simple query
 */
async function checkDatabase(
  db: DatabaseClient | null,
): Promise<{ connected: boolean; error?: string }> {
  if (!db) {
    return { connected: false, error: 'Database client not available' };
  }

  try {
    // Execute a simple query to verify connectivity
    await db.execute(sql`SELECT 1`);
    return { connected: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown database error';
    return { connected: false, error: message };
  }
}

/**
 * Health check response type
 */
interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  database: 'connected' | 'disconnected';
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
  const db = await getDbClient(event.locals);
  const dbStatus = await checkDatabase(db);

  const isHealthy = dbStatus.connected;
  const uptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1000);

  const responseBody: HealthResponse = {
    status: isHealthy ? 'healthy' : 'unhealthy',
    database: dbStatus.connected ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
    uptime: uptimeSeconds,
    version: __APP_VERSION__,
  };

  // Include error details when unhealthy
  if (!isHealthy && dbStatus.error) {
    responseBody.error = dbStatus.error;
  }

  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });

  return json(responseBody, {
    status: isHealthy ? 200 : 503,
    headers,
  });
}
