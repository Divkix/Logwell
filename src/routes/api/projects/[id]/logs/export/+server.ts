import { json } from '@sveltejs/kit';
import { and, count, desc, eq, gte, inArray, lte, type SQL, sql } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { EXPORT_CONFIG } from '$lib/server/config/performance';
import type * as schema from '$lib/server/db/schema';
import { log } from '$lib/server/db/schema';
import { serializeToCsv } from '$lib/server/utils/csv-serializer';
import { isErrorResponse, requireProjectOwnership } from '$lib/server/utils/project-guard';
import { buildSearchQuery } from '$lib/server/utils/search';
import { LOG_LEVELS, type LogLevel } from '$lib/shared/types';
import type { ExportableLog, ExportFormat } from '$lib/types/export';
import type { RequestEvent } from './$types';

type DatabaseClient = PostgresJsDatabase<typeof schema> | PgliteDatabase<typeof schema>;

/**
 * Helper to get database client from locals or production db
 * Supports test injection via locals.db
 */
async function getDbClient(locals: App.Locals): Promise<DatabaseClient> {
  if (locals.db) {
    return locals.db as DatabaseClient;
  }
  const { db } = await import('$lib/server/db');
  return db;
}

/**
 * Parse and validate level filter from query string
 * Returns array of valid log levels or null if no filter
 */
function parseLevelFilter(levelParam: string | null): LogLevel[] | null {
  if (!levelParam) return null;

  const levels = levelParam
    .split(',')
    .map((l) => l.trim().toLowerCase())
    .filter((l): l is LogLevel => LOG_LEVELS.includes(l as LogLevel));

  return levels.length > 0 ? levels : null;
}

/**
 * Validate export format parameter
 */
function validateFormat(formatParam: string | null): ExportFormat | null {
  if (!formatParam) return 'json'; // Default to JSON

  const format = formatParam.toLowerCase();
  if (format === 'csv' || format === 'json') {
    return format as ExportFormat;
  }

  return null;
}

/**
 * Generate filename for export with timestamp
 */
function generateFilename(projectName: string, format: ExportFormat): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const sanitizedName = projectName.replace(/[^a-zA-Z0-9-_]/g, '-');
  return `logs-${sanitizedName}-${timestamp}.${format}`;
}

/**
 * GET /api/projects/[id]/logs/export
 *
 * Export logs in CSV or JSON format with optional filters.
 * Requires session authentication and project ownership.
 *
 * Query Parameters:
 * - format: string ('csv' | 'json', default: 'json') - Export format
 * - level: string - Filter by level (comma-separated, e.g., "error,fatal")
 * - search: string - Full-text search query
 * - from: string (ISO 8601) - Start timestamp filter
 * - to: string (ISO 8601) - End timestamp filter
 *
 * Response Headers:
 * - Content-Type: application/json OR text/csv; charset=utf-8
 * - Content-Disposition: attachment; filename="logs-{projectName}-{timestamp}.{ext}"
 *
 * Error responses:
 * - 303 redirect to /login: Not authenticated
 * - 400 invalid_format: Invalid format parameter
 * - 400 export_too_large: Export exceeds maximum log limit (10,000)
 * - 404 not_found: Project does not exist or not owned by user
 */
export async function GET(event: RequestEvent): Promise<Response> {
  // Require authentication and project ownership
  const authResult = await requireProjectOwnership(event, event.params.id);
  if (isErrorResponse(authResult)) return authResult;

  const { project: projectData } = authResult;
  const db = await getDbClient(event.locals);
  const projectId = event.params.id;

  // Parse query parameters
  const url = event.url;
  const formatParam = url.searchParams.get('format');
  const levelParam = url.searchParams.get('level');
  const searchParam = url.searchParams.get('search');
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');

  // Validate format
  const format = validateFormat(formatParam);
  if (!format) {
    return json(
      {
        error: 'invalid_format',
        message: 'Invalid format parameter. Must be "csv" or "json".',
      },
      { status: 400 },
    );
  }

  // Parse level filter
  const levels = parseLevelFilter(levelParam);

  // Parse time range
  const fromDate = fromParam ? new Date(fromParam) : null;
  const toDate = toParam ? new Date(toParam) : null;

  // Build WHERE conditions
  const conditions: SQL[] = [eq(log.projectId, projectId)];

  // Level filter
  if (levels && levels.length > 0) {
    conditions.push(inArray(log.level, levels));
  }

  // Time range filters
  if (fromDate && !Number.isNaN(fromDate.getTime())) {
    conditions.push(gte(log.timestamp, fromDate));
  }
  if (toDate && !Number.isNaN(toDate.getTime())) {
    conditions.push(lte(log.timestamp, toDate));
  }

  // Full-text search
  if (searchParam?.trim()) {
    const tsquery = buildSearchQuery(searchParam);
    if (tsquery) {
      conditions.push(sql`${log.search} @@ to_tsquery('english', ${tsquery})`);
    }
  }

  const whereClause = and(...conditions);

  // Check count doesn't exceed limit
  const [countResult] = await db.select({ count: count() }).from(log).where(whereClause);
  const total = countResult?.count ?? 0;

  if (total > EXPORT_CONFIG.MAX_LOGS) {
    return json(
      {
        error: 'export_too_large',
        message: `Export exceeds maximum limit of ${EXPORT_CONFIG.MAX_LOGS} logs. Please use filters to reduce the result set.`,
      },
      { status: 400 },
    );
  }

  // Fetch all logs (up to limit)
  const logs = await db
    .select({
      id: log.id,
      level: log.level,
      message: log.message,
      metadata: log.metadata,
      sourceFile: log.sourceFile,
      lineNumber: log.lineNumber,
      requestId: log.requestId,
      userId: log.userId,
      ipAddress: log.ipAddress,
      timestamp: log.timestamp,
    })
    .from(log)
    .where(whereClause)
    .orderBy(desc(log.timestamp))
    .limit(EXPORT_CONFIG.MAX_LOGS);

  // Transform logs to exportable format
  const exportableLogs: ExportableLog[] = logs.map((l) => ({
    id: l.id,
    level: l.level,
    message: l.message,
    timestamp: l.timestamp?.toISOString() ?? '',
    metadata: l.metadata ? JSON.stringify(l.metadata) : null,
    sourceFile: l.sourceFile,
    lineNumber: l.lineNumber,
    requestId: l.requestId,
    userId: l.userId,
    ipAddress: l.ipAddress,
  }));

  // Generate filename
  const filename = generateFilename(projectData.name, format);

  // Serialize and return based on format
  if (format === 'csv') {
    const csvContent = serializeToCsv(exportableLogs);

    return new Response(csvContent, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  // JSON format
  return new Response(JSON.stringify(exportableLogs), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
}
