import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DatabaseClient } from "$lib/server/db/db";
import { project } from "../db/schema";

export class ApiKeyError extends Error {
  status: number;
  body: { message: string };

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiKeyError";
    this.status = status;
    this.body = { message };
  }
}

interface CacheEntry {
  projectId: string;
  keyHash: string;
  expiresAt: number;
}

interface NegativeCacheEntry {
  expiresAt: number;
}

const API_KEY_CACHE = new Map<string, CacheEntry>();

const NEGATIVE_CACHE = new Map<string, NegativeCacheEntry>();

const CACHE_TTL_MS = 5 * 60 * 1000;

const NEGATIVE_CACHE_TTL_MS = 30 * 1000;

const MAX_CACHE_SIZE = 1000;

const MAX_NEGATIVE_CACHE_SIZE = 5000;

const API_KEY_REGEX = /^lw_[A-Za-z0-9_-]{32}$/;

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): string {
  return `lw_${nanoid(32)}`;
}

export function validateApiKeyFormat(key: string): boolean {
  if (!key || typeof key !== "string") {
    return false;
  }
  return API_KEY_REGEX.test(key);
}

function evictCacheEntry(): void {
  const now = Date.now();
  for (const [key, entry] of API_KEY_CACHE) {
    if (entry.expiresAt <= now) {
      API_KEY_CACHE.delete(key);
      return;
    }
  }
  const firstKey = API_KEY_CACHE.keys().next().value;
  if (firstKey !== undefined) {
    API_KEY_CACHE.delete(firstKey);
  }
}

function setNegativeCache(keyHash: string): void {
  const now = Date.now();
  for (const [k, v] of NEGATIVE_CACHE) {
    if (v.expiresAt <= now) NEGATIVE_CACHE.delete(k);
  }
  if (NEGATIVE_CACHE.size >= MAX_NEGATIVE_CACHE_SIZE) {
    const oldest = NEGATIVE_CACHE.keys().next().value;
    if (oldest !== undefined) NEGATIVE_CACHE.delete(oldest);
  }
  NEGATIVE_CACHE.set(keyHash, { expiresAt: now + NEGATIVE_CACHE_TTL_MS });
}

export async function validateApiKey(request: Request, dbClient?: DatabaseClient): Promise<string> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new ApiKeyError(401, "Missing or invalid authorization header");
  }

  const apiKey = authHeader.substring(7);

  if (!validateApiKeyFormat(apiKey)) {
    throw new ApiKeyError(401, "Invalid API key format");
  }

  const keyHash = hashApiKey(apiKey);

  const negCached = NEGATIVE_CACHE.get(keyHash);
  if (negCached) {
    if (negCached.expiresAt > Date.now()) {
      throw new ApiKeyError(401, "Invalid API key");
    }
    NEGATIVE_CACHE.delete(keyHash);
  }

  const cached = API_KEY_CACHE.get(keyHash);
  if (cached && cached.expiresAt > Date.now() && cached.keyHash === keyHash) {
    return cached.projectId;
  }

  const db = dbClient ?? (await import("$lib/server/db")).db;

  const [result] = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.apiKeyHash, keyHash));

  if (!result) {
    setNegativeCache(keyHash);
    throw new ApiKeyError(401, "Invalid API key");
  }

  if (API_KEY_CACHE.size >= MAX_CACHE_SIZE) {
    evictCacheEntry();
  }

  API_KEY_CACHE.set(keyHash, {
    projectId: result.id,
    keyHash,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  NEGATIVE_CACHE.delete(keyHash);

  return result.id;
}

export function invalidateApiKeyCacheByHash(keyHash: string): void {
  API_KEY_CACHE.delete(keyHash);
  NEGATIVE_CACHE.delete(keyHash);
}

export function clearApiKeyCache(): void {
  API_KEY_CACHE.clear();
  NEGATIVE_CACHE.clear();
}
