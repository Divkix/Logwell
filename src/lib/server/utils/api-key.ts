import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseClient } from '$lib/server/db/db';
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
 * API Key cache entry with project ID, key hash, and expiration time
 */
interface CacheEntry {
  projectId: string;
  keyHash: string;
  expiresAt: number;
}

/**
 * Negative cache entry for rejected keys
 */
interface NegativeCacheEntry {
  expiresAt: number;
}

/**
 * In-memory cache for validated API keys
 * Maps key hash to project ID with TTL
 */
const API_KEY_CACHE = new Map<string, CacheEntry>();

/**
 * Negative cache for invalid keys (30s TTL to avoid repeated DB hits)
 */
const NEGATIVE_CACHE = new Map<string, NegativeCacheEntry>();

/**
 * Cache TTL in milliseconds (5 minutes)
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Negative cache TTL in milliseconds (30 seconds)
 */
const NEGATIVE_CACHE_TTL_MS = 30 * 1000;

/**
 * Maximum number of entries in the positive cache
 */
const MAX_CACHE_SIZE = 1000;

/**
 * Regex pattern for API key validation
 * Format: lw_[32 alphanumeric characters including - and _]
 */
const API_KEY_REGEX = /^lw_[A-Za-z0-9_-]{32}$/;

/**
 * Hash an API key using SHA-256
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

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
 * Evict the oldest expired entry from the positive cache, or evict oldest entry if at max size
 */
function evictCacheEntry(): void {
  const now = Date.now();
  // Find an expired entry first
  for (const [key, entry] of API_KEY_CACHE) {
    if (entry.expiresAt <= now) {
      API_KEY_CACHE.delete(key);
      return;
    }
  }
  // No expired entries — evict oldest (first inserted)
  const firstKey = API_KEY_CACHE.keys().next().value;
  if (firstKey !== undefined) {
    API_KEY_CACHE.delete(firstKey);
  }
}

/**
 * Validates API key from request Authorization header and returns project ID
 * Implements caching with 5-minute TTL for performance
 * Uses SHA-256 hash for cache lookup (never stores raw key in cache)
 *
 * @param request - Request object containing Authorization header
 * @param dbClient - Optional database client for testing (uses default if not provided)
 * @returns Project ID associated with the API key
 * @throws ApiKeyError(401) if Authorization header missing, malformed, invalid format, or key not found
 */
export async function validateApiKey(request: Request, dbClient?: DatabaseClient): Promise<string> {
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

  const keyHash = hashApiKey(apiKey);

  // Check negative cache
  const negCached = NEGATIVE_CACHE.get(keyHash);
  if (negCached && negCached.expiresAt > Date.now()) {
    throw new ApiKeyError(401, 'Invalid API key');
  }

  // Check positive cache — validate stored hash matches
  const cached = API_KEY_CACHE.get(keyHash);
  if (cached && cached.expiresAt > Date.now() && cached.keyHash === keyHash) {
    return cached.projectId;
  }

  // Lazy load default db only when needed (avoids issues in unit tests)
  const db = dbClient ?? (await import('$lib/server/db')).db;

  // Query database by key hash
  const [result] = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.apiKeyHash, keyHash));

  if (!result) {
    // Store in negative cache
    NEGATIVE_CACHE.set(keyHash, { expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS });
    throw new ApiKeyError(401, 'Invalid API key');
  }

  // Evict if at capacity before inserting
  if (API_KEY_CACHE.size >= MAX_CACHE_SIZE) {
    evictCacheEntry();
  }

  // Update positive cache (keyed by hash, never the raw key)
  API_KEY_CACHE.set(keyHash, {
    projectId: result.id,
    keyHash,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  // Remove from negative cache if present
  NEGATIVE_CACHE.delete(keyHash);

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
  const keyHash = hashApiKey(apiKey);
  API_KEY_CACHE.delete(keyHash);
  NEGATIVE_CACHE.delete(keyHash);
}

/**
 * Clears all entries from the API key cache
 * Useful for testing and administrative operations
 */
export function clearApiKeyCache(): void {
  API_KEY_CACHE.clear();
  NEGATIVE_CACHE.clear();
}
