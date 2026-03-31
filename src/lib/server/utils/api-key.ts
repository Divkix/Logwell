import { eq } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { nanoid } from 'nanoid';
import type * as schema from '../db/schema';
import { project } from '../db/schema';

/**
 * Custom error class for API key validation errors
 * Compatible with SvelteKit's error handling
 */
export class ApiKeyError extends Error {
  status: number;
  body: { message: string };

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiKeyError';
    this.status = status;
    this.body = { message };
  }
}

/**
 * API Key cache entry with project ID and expiration time
 */
interface CacheEntry {
  projectId: string;
  expiresAt: number;
}

/**
 * In-memory cache for validated API keys
 * Maps API key to project ID with TTL
 */
const API_KEY_CACHE = new Map<string, CacheEntry>();

/**
 * Cache TTL in milliseconds (5 minutes)
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Regex pattern for API key validation
 * Format: lw_[32 alphanumeric characters including - and _]
 */
const API_KEY_REGEX = /^lw_[A-Za-z0-9_-]{32}$/;

/**
 * Generates a new API key with format: lw_[32 random alphanumeric characters]
 * Uses nanoid for cryptographically secure random generation
 *
 * @returns API key string in format lw_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 */
export function generateApiKey(): string {
  return `lw_${nanoid(32)}`;
}

/**
 * Validates API key format using regex pattern
 * Does not check if key exists in database
 *
 * @param key - API key to validate
 * @returns true if key matches format, false otherwise
 */
export function validateApiKeyFormat(key: string): boolean {
  if (!key || typeof key !== 'string') {
    return false;
  }
  return API_KEY_REGEX.test(key);
}

/**
 * Validates API key from request Authorization header and returns project ID
 * Implements caching with 5-minute TTL for performance
 *
 * Flow:
 * 1. Extract Bearer token from Authorization header
 * 2. Validate format using regex
 * 3. Check in-memory cache (return if valid and not expired)
 * 4. Query database if not in cache
 * 5. Update cache on successful validation
 * 6. Return project ID
 *
 * @param request - Request object containing Authorization header
 * @param dbClient - Optional database client for testing (uses default if not provided)
 * @returns Project ID associated with the API key
 * @throws ApiKeyError(401) if Authorization header missing, malformed, invalid format, or key not found
 */
export async function validateApiKey(
  request: Request,
  dbClient?: PgliteDatabase<typeof schema> | PostgresJsDatabase<typeof schema>,
): Promise<string> {
  // Extract Authorization header
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new ApiKeyError(401, 'Missing or invalid authorization header');
  }

  // Extract API key from Bearer token
  const apiKey = authHeader.substring(7); // Remove 'Bearer ' prefix

  // Validate format first (fast fail)
  if (!validateApiKeyFormat(apiKey)) {
    throw new ApiKeyError(401, 'Invalid API key format');
  }

  // Check cache
  const cached = API_KEY_CACHE.get(apiKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.projectId;
  }

  // Lazy load default db only when needed (avoids issues in unit tests)
  const db =
    dbClient ?? ((await import('../db').then((m) => m.db)) as PostgresJsDatabase<typeof schema>);

  // Query database
  const [result] = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.apiKey, apiKey));

  if (!result) {
    throw new ApiKeyError(401, 'Invalid API key');
  }

  // Update cache
  API_KEY_CACHE.set(apiKey, {
    projectId: result.id,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return result.id;
}

/**
 * Invalidates a specific API key from the cache
 * Should be called when:
 * - API key is regenerated
 * - Project is deleted
 * - Manual cache invalidation needed
 *
 * @param apiKey - API key to remove from cache
 */
export function invalidateApiKeyCache(apiKey: string): void {
  API_KEY_CACHE.delete(apiKey);
}

/**
 * Clears all entries from the API key cache
 * Useful for testing and administrative operations
 */
export function clearApiKeyCache(): void {
  API_KEY_CACHE.clear();
}
