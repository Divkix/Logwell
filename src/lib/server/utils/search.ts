import { desc, sql } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../db/schema';
import { type Log, log } from '../db/schema';

/**
 * Database client type union for testing and production
 */
type DatabaseClient = PgliteDatabase<typeof schema> | PostgresJsDatabase<typeof schema>;

/**
 * Builds a PostgreSQL tsquery string from a search term
 * Converts space-separated terms to AND operator (&)
 * Escapes special PostgreSQL tsquery characters: & | ! ( ) : * \ ' "
 *
 * @param searchTerm - Raw search string from user input
 * @returns Sanitized tsquery string with terms joined by ' & '
 *
 * @example
 * buildSearchQuery('database connection failed')
 * // Returns: 'database & connection & failed'
 *
 * @example
 * buildSearchQuery('error! (warning)')
 * // Returns: 'error & warning'
 */
export function buildSearchQuery(searchTerm: string): string {
  if (!searchTerm || typeof searchTerm !== 'string') {
    return '';
  }

  // PostgreSQL tsquery special characters that need to be removed
  // & | ! ( ) : * \ ' "
  const specialCharsRegex = /[&|!():*\\'"]/g;

  // Remove special characters, then split on whitespace
  const sanitized = searchTerm.replace(specialCharsRegex, ' ');

  // Split on whitespace, filter empty strings, and join with ' & '
  const terms = sanitized.split(/\s+/).filter((term) => term.length > 0);

  return terms.join(' & ');
}

/**
 * Searches logs using PostgreSQL full-text search with tsvector/tsquery
 * Orders results by ts_rank (relevance) DESC, then timestamp DESC
 *
 * Flow:
 * 1. Sanitize search term using buildSearchQuery
 * 2. Query logs using @@ to_tsquery operator
 * 3. Order by ts_rank for relevance, then timestamp for recency
 * 4. Apply limit (default 100)
 *
 * Search ranking:
 * - Message field has weight 'A' (highest priority)
 * - Metadata field has weight 'B' (lower priority)
 *
 * @param projectId - Project ID to filter logs
 * @param searchTerm - User's search query
 * @param dbClient - Database client (PGlite for tests, PostgresJs for production)
 * @param options - Optional configuration
 * @param options.limit - Maximum number of results to return (default: 100)
 * @returns Array of matching logs ordered by relevance and timestamp
 *
 * @example
 * const logs = await searchLogs('project-123', 'database connection', db);
 * // Returns logs matching both "database" AND "connection"
 *
 * @example
 * const logs = await searchLogs('project-123', 'error', db, { limit: 10 });
 * // Returns top 10 most relevant logs matching "error"
 */
export async function searchLogs(
  projectId: string,
  searchTerm: string,
  dbClient: DatabaseClient,
  options?: { limit?: number },
): Promise<Log[]> {
  const query = buildSearchQuery(searchTerm);

  // Return empty array if no valid search terms
  if (!query) {
    return [];
  }

  const limit = options?.limit ?? 100;

  // Execute full-text search query with ranking
  const results = await dbClient
    .select({
      id: log.id,
      projectId: log.projectId,
      incidentId: log.incidentId,
      fingerprint: log.fingerprint,
      serviceName: log.serviceName,
      level: log.level,
      message: log.message,
      metadata: log.metadata,
      sourceFile: log.sourceFile,
      lineNumber: log.lineNumber,
      requestId: log.requestId,
      userId: log.userId,
      ipAddress: log.ipAddress,
      timestamp: log.timestamp,
      search: log.search,
      // Calculate rank for ordering
      rank: sql<number>`ts_rank(${log.search}, to_tsquery('english', ${query}))`,
    })
    .from(log)
    .where(
      sql`${log.projectId} = ${projectId} AND ${log.search} @@ to_tsquery('english', ${query})`,
    )
    .orderBy(
      // Order by rank DESC (most relevant first)
      sql`ts_rank(${log.search}, to_tsquery('english', ${query})) DESC`,
      // Then by timestamp DESC (newest first)
      desc(log.timestamp),
    )
    .limit(limit);

  // Remove the rank field from results (only used for ordering)
  return results.map(({ rank, ...logData }) => logData) as Log[];
}
