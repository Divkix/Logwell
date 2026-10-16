import { and, eq, gte, inArray, lte, type SQL, sql } from "drizzle-orm";
import { EXPORT_CONFIG } from "#lib/server/config/performance.js";
import { log } from "#lib/server/db/schema.js";
import { apiError } from "#lib/server/utils/api-error.js";
import { cappedLogCount } from "#lib/server/utils/capped-count.js";
import { escapeCSVField } from "#lib/server/utils/csv-serializer.js";
import { type LogQueryResult, type QueriedLog, queryLogs } from "#lib/server/utils/log-query.js";
import { requireOwnedProjectRoute } from "#lib/server/utils/owned-project.js";
import { buildSearchQuery, searchLengthError } from "#lib/server/utils/search.js";
import { parseLevelFilter } from "#lib/shared/schemas/log.js";
import type { JsonValue } from "#lib/shared/schemas/json.js";
import type { ExportFormat } from "#lib/types/export.js";
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

function validateFormat(formatParam: string | null): ExportFormat | null {
  if (!formatParam) return "json";

  const format = formatParam.toLowerCase();

  if (format === "csv" || format === "json") {
    return format;
  }

  return null;
}

function generateFilename(projectName: string, format: ExportFormat): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").split("T")[0];
  const sanitizedName = projectName.replace(/[^a-zA-Z0-9-_]/g, "-");

  return `logs-${sanitizedName}-${timestamp}.${format}`;
}

function parseValidDate(param: string | null): Date | null {
  if (!param) return null;
  const date = new Date(param);

  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Pull-based export stream: one DB page per pull(), so paging follows the
 * client's read rate and stops once the client cancels (disconnects).
 */
function createPagedExportStream(options: {
  fetchPage: (cursor: string | null) => Promise<LogQueryResult>;
  header: string;
  footer?: string;
  encodePage: (logs: QueriedLog[], isFirstPage: boolean) => string;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let cursor: string | null = null;
  let fetched = 0;
  let cancelled = false;

  const finish = (ctrl: ReadableStreamDefaultController<Uint8Array>) => {
    if (options.footer) ctrl.enqueue(encoder.encode(options.footer));
    ctrl.close();
  };

  return new ReadableStream<Uint8Array>(
    {
      start(ctrl) {
        ctrl.enqueue(encoder.encode(options.header));
      },
      async pull(ctrl) {
        if (fetched >= EXPORT_CONFIG.MAX_LOGS) {
          finish(ctrl);

          return;
        }

        const page = await options.fetchPage(cursor);

        if (cancelled) return;

        if (page.logs.length > 0) {
          ctrl.enqueue(encoder.encode(options.encodePage(page.logs, fetched === 0)));
          fetched += page.logs.length;
        }

        if (page.logs.length === 0 || !page.hasMore || !page.nextCursor) {
          finish(ctrl);

          return;
        }

        cursor = page.nextCursor;
      },
      cancel() {
        cancelled = true;
      },
    },
    // Hold at most one buffered chunk so the next page is fetched only after
    // the client has read the previous one.
    { highWaterMark: 1 },
  );
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
  const authResult = await requireOwnedProjectRoute(event, event.params.id);

  if (authResult instanceof Response) return authResult;

  const { project: projectData, db } = authResult;
  const projectId = event.params.id;

  const url = event.url;
  const formatParam = url.searchParams.get("format");
  const levelParam = url.searchParams.get("level");
  const searchParam = url.searchParams.get("search");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  const format = validateFormat(formatParam);

  if (!format) {
    return apiError(400, "invalid_format", 'Invalid format parameter. Must be "csv" or "json".');
  }

  const searchError = searchLengthError(searchParam);

  if (searchError) return searchError;

  const levels = parseLevelFilter(levelParam);

  const from = parseValidDate(fromParam);
  const to = parseValidDate(toParam);

  const conditions: SQL[] = [eq(log.projectId, projectId)];

  if (levels && levels.length > 0) {
    conditions.push(inArray(log.level, levels));
  }

  if (from) {
    conditions.push(gte(log.timestamp, from));
  }

  if (to) {
    conditions.push(lte(log.timestamp, to));
  }

  if (searchParam?.trim()) {
    const tsquery = buildSearchQuery(searchParam);

    if (tsquery) {
      conditions.push(sql`${log.search} @@ to_tsquery('english', ${tsquery})`);
    }
  }

  const whereClause = and(...conditions);

  // Bounded: stops counting one row past the limit instead of scanning the whole match set.
  const { total } = await cappedLogCount(db, whereClause, EXPORT_CONFIG.MAX_LOGS + 1);

  if (total > EXPORT_CONFIG.MAX_LOGS) {
    return apiError(
      400,
      "export_too_large",
      `Export exceeds maximum limit of ${EXPORT_CONFIG.MAX_LOGS} logs. Please use filters to reduce the result set.`,
    );
  }

  const filename = generateFilename(projectData.name, format);

  const fetchPage = (cursor: string | null) =>
    queryLogs(db, {
      projectId,
      levels,
      from,
      to,
      search: searchParam,
      cursor,
      limit: EXPORT_BATCH_SIZE,
    });

  if (format === "csv") {
    const stream = createPagedExportStream({
      fetchPage,
      header: `${CSV_HEADERS.join(",")}\n`,
      encodePage: (logs) =>
        logs
          .map((l) => {
            const values: JsonValue[] = [
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

            return `${values.map(escapeCSVField).join(",")}\n`;
          })
          .join(""),
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  const stream = createPagedExportStream({
    fetchPage,
    header: "[",
    footer: "]",
    encodePage: (logs, isFirstPage) =>
      (isFirstPage ? "" : ",") +
      logs
        .map((l) => {
          const exportable = {
            id: l.id,
            level: l.level,
            message: l.message,
            timestamp: l.timestamp?.toISOString() ?? "",
            metadata: l.metadata ?? null,
            sourceFile: l.sourceFile,
            lineNumber: l.lineNumber,
            requestId: l.requestId,
            userId: l.userId,
            ipAddress: l.ipAddress,
          };

          return JSON.stringify(exportable);
        })
        .join(","),
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
