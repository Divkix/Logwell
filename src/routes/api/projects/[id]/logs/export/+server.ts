import { and, count, desc, eq, gte, inArray, lt, lte, or, type SQL, sql } from "drizzle-orm";
import { EXPORT_CONFIG } from "$lib/server/config/performance";
import { getDbClient } from "$lib/server/db/db";
import { log } from "$lib/server/db/schema";
import { apiError } from "$lib/server/utils/api-error";
import { escapeCSVField } from "$lib/server/utils/csv-serializer";
import { isErrorResponse, requireProjectOwnership } from "$lib/server/utils/project-guard";
import { buildSearchQuery } from "$lib/server/utils/search";
import { LOG_LEVELS, type LogLevel } from "$lib/shared/types";
import type { ExportFormat } from "$lib/types/export";
import type { RequestEvent } from "./$types";

const EXPORT_BATCH_SIZE = 500;

const CSV_HEADERS = [
  "id",
  "timestamp",
  "level",
  "message",
  "metadata",
  "sourceFile",
  "lineNumber",
  "requestId",
  "userId",
  "ipAddress",
] as const;

// TODO: deduplicate with logs/+server.ts parseLevelFilter (RT-10)
function parseLevelFilter(levelParam: string | null): LogLevel[] | null {
  if (!levelParam) return null;

  const levels = levelParam
    .split(",")
    .map((l) => l.trim().toLowerCase())
    .filter((l): l is LogLevel => LOG_LEVELS.includes(l as LogLevel));

  return levels.length > 0 ? levels : null;
}

/**
 * Validate export format parameter
 */
function validateFormat(formatParam: string | null): ExportFormat | null {
  if (!formatParam) return "json"; // Default to JSON

  const format = formatParam.toLowerCase();
  if (format === "csv" || format === "json") {
    return format as ExportFormat;
  }

  return null;
}

/**
 * Generate filename for export with timestamp
 */
function generateFilename(projectName: string, format: ExportFormat): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").split("T")[0];
  const sanitizedName = projectName.replace(/[^a-zA-Z0-9-_]/g, "-");
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
  const formatParam = url.searchParams.get("format");
  const levelParam = url.searchParams.get("level");
  const searchParam = url.searchParams.get("search");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  // Validate format
  const format = validateFormat(formatParam);
  if (!format) {
    return apiError(400, "invalid_format", 'Invalid format parameter. Must be "csv" or "json".');
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
    return apiError(
      400,
      "export_too_large",
      `Export exceeds maximum limit of ${EXPORT_CONFIG.MAX_LOGS} logs. Please use filters to reduce the result set.`,
    );
  }

  // Generate filename
  const filename = generateFilename(projectData.name, format);

  const encoder = new TextEncoder();

  if (format === "csv") {
    const stream = new ReadableStream({
      async start(ctrl) {
        try {
          ctrl.enqueue(encoder.encode(`${CSV_HEADERS.join(",")}\n`));

          // Cursor-based pagination to avoid loading all rows at once
          let cursorTimestamp: Date | null = null;
          let cursorId: string | null = null;
          let fetched = 0;

          while (fetched < EXPORT_CONFIG.MAX_LOGS) {
            const batchConditions: SQL[] = [...conditions];
            if (cursorTimestamp !== null && cursorId !== null) {
              batchConditions.push(
                or(
                  lt(log.timestamp, cursorTimestamp),
                  and(eq(log.timestamp, cursorTimestamp), lt(log.id, cursorId)),
                ) as SQL,
              );
            }

            const batch = await db
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
              .where(and(...batchConditions))
              .orderBy(desc(log.timestamp), desc(log.id))
              .limit(EXPORT_BATCH_SIZE);

            if (batch.length === 0) break;

            for (const l of batch) {
              const values: unknown[] = [
                l.id,
                l.timestamp?.toISOString() ?? "",
                l.level,
                l.message,
                l.metadata ? JSON.stringify(l.metadata) : null,
                l.sourceFile,
                l.lineNumber,
                l.requestId,
                l.userId,
                l.ipAddress,
              ];
              ctrl.enqueue(encoder.encode(`${values.map(escapeCSVField).join(",")}\n`));
            }

            fetched += batch.length;
            const last = batch.at(-1)!;
            cursorTimestamp = last.timestamp as Date;
            cursorId = last.id;

            if (batch.length < EXPORT_BATCH_SIZE) break;
          }

          ctrl.close();
        } catch (err) {
          ctrl.error(err);
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // JSON format — stream as array
  const stream = new ReadableStream({
    async start(ctrl) {
      try {
        ctrl.enqueue(encoder.encode("["));

        let cursorTimestamp: Date | null = null;
        let cursorId: string | null = null;
        let fetched = 0;
        let first = true;

        while (fetched < EXPORT_CONFIG.MAX_LOGS) {
          const batchConditions: SQL[] = [...conditions];
          if (cursorTimestamp !== null && cursorId !== null) {
            batchConditions.push(
              or(
                lt(log.timestamp, cursorTimestamp),
                and(eq(log.timestamp, cursorTimestamp), lt(log.id, cursorId)),
              ) as SQL,
            );
          }

          const batch = await db
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
            .where(and(...batchConditions))
            .orderBy(desc(log.timestamp), desc(log.id))
            .limit(EXPORT_BATCH_SIZE);

          if (batch.length === 0) break;

          for (const l of batch) {
            const exportable = {
              id: l.id,
              level: l.level,
              message: l.message,
              timestamp: l.timestamp?.toISOString() ?? "",
              metadata: l.metadata ? JSON.stringify(l.metadata) : null,
              sourceFile: l.sourceFile,
              lineNumber: l.lineNumber,
              requestId: l.requestId,
              userId: l.userId,
              ipAddress: l.ipAddress,
            };
            ctrl.enqueue(encoder.encode(`${first ? "" : ","}${JSON.stringify(exportable)}`));
            first = false;
          }

          fetched += batch.length;
          const last = batch.at(-1)!;
          cursorTimestamp = last.timestamp as Date;
          cursorId = last.id;

          if (batch.length < EXPORT_BATCH_SIZE) break;
        }

        ctrl.enqueue(encoder.encode("]"));
        ctrl.close();
      } catch (err) {
        ctrl.error(err);
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
