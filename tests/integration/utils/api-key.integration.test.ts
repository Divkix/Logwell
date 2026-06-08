import { eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { nanoid } from "nanoid";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type * as schema from "../../../src/lib/server/db/schema";
import { project } from "../../../src/lib/server/db/schema";
import { setupTestDatabase } from "../../../src/lib/server/db/test-db";
import {
  clearApiKeyCache,
  generateApiKey,
  hashApiKey,
  invalidateApiKeyCache,
  validateApiKey,
} from "../../../src/lib/server/utils/api-key";
import { getOrCreateDefaultUser } from "../../fixtures/db";

describe("API Key Validation with Database", () => {
  let db: PgliteDatabase<typeof schema>;
  let userId: string;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    const user = await getOrCreateDefaultUser(db);
    userId = user.id;
    // Clear cache before each test
    clearApiKeyCache();
  });

  it("validateApiKey returns projectId for valid key", async () => {
    const projectId = nanoid();
    const apiKey = generateApiKey();
    const projectName = "test-project";

    // Create project in database
    await db.insert(project).values({
      id: projectId,
      name: projectName,
      apiKeyHash: hashApiKey(apiKey),
      ownerId: userId,
    });

    // Create mock request with Authorization header
    const request = new Request("http://localhost", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    // Validate API key
    const validatedProjectId = await validateApiKey(request, db);

    expect(validatedProjectId).toBe(projectId);
  });

  it("validateApiKey throws 401 for missing Authorization header", async () => {
    const request = new Request("http://localhost");

    await expect(validateApiKey(request, db)).rejects.toThrow(
      "Missing or invalid authorization header",
    );
  });

  it("validateApiKey throws 401 for malformed Authorization header (not Bearer)", async () => {
    const apiKey = generateApiKey();
    const request = new Request("http://localhost", {
      headers: {
        Authorization: `Basic ${apiKey}`,
      },
    });

    await expect(validateApiKey(request, db)).rejects.toThrow(
      "Missing or invalid authorization header",
    );
  });

  it("validateApiKey throws 401 for invalid format", async () => {
    const invalidKey = "invalid_key_format";
    const request = new Request("http://localhost", {
      headers: {
        Authorization: `Bearer ${invalidKey}`,
      },
    });

    await expect(validateApiKey(request, db)).rejects.toThrow("Invalid API key format");
  });

  it("validateApiKey throws 401 for non-existent key", async () => {
    const nonExistentKey = generateApiKey();
    const request = new Request("http://localhost", {
      headers: {
        Authorization: `Bearer ${nonExistentKey}`,
      },
    });

    await expect(validateApiKey(request, db)).rejects.toThrow("Invalid API key");
  });

  it("validateApiKey caches validated keys", async () => {
    const projectId = nanoid();
    const apiKey = generateApiKey();
    const projectName = "cache-test-project";

    // Create project
    await db.insert(project).values({
      id: projectId,
      name: projectName,
      apiKeyHash: hashApiKey(apiKey),
      ownerId: userId,
    });

    const request1 = new Request("http://localhost", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    // First call - should query database
    const result1 = await validateApiKey(request1, db);
    expect(result1).toBe(projectId);

    // Delete project from database (to prove cache is working)
    await db.delete(project).where(eq(project.id, projectId));

    const request2 = new Request("http://localhost", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    // Second call - should use cache (not fail even though DB record deleted)
    const result2 = await validateApiKey(request2, db);
    expect(result2).toBe(projectId);
  });

  it("validateApiKey returns cached result without DB query", async () => {
    const projectId = nanoid();
    const apiKey = generateApiKey();
    const projectName = "query-count-test";

    // Create project
    await db.insert(project).values({
      id: projectId,
      name: projectName,
      apiKeyHash: hashApiKey(apiKey),
      ownerId: userId,
    });

    const request1 = new Request("http://localhost", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    // First validation - queries DB
    await validateApiKey(request1, db);

    // Spy on database select to verify it's not called again
    const selectSpy = vi.spyOn(db, "select");

    const request2 = new Request("http://localhost", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    // Second validation - should use cache
    const result = await validateApiKey(request2, db);
    expect(result).toBe(projectId);

    // Verify database was not queried
    expect(selectSpy).not.toHaveBeenCalled();

    selectSpy.mockRestore();
  });

  it("validateApiKey respects cache TTL (5 minutes)", async () => {
    const projectId = nanoid();
    const apiKey = generateApiKey();
    const projectName = "ttl-test-project";

    // Create project
    await db.insert(project).values({
      id: projectId,
      name: projectName,
      apiKeyHash: hashApiKey(apiKey),
      ownerId: userId,
    });

    const request = new Request("http://localhost", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    // Mock Date.now() to test TTL
    const originalDateNow = Date.now;
    let currentTime = originalDateNow();
    Date.now = vi.fn(() => currentTime);

    // First call - cache entry created
    await validateApiKey(request, db);

    // Advance time by 4 minutes (cache should still be valid)
    currentTime += 4 * 60 * 1000;
    const result1 = await validateApiKey(request, db);
    expect(result1).toBe(projectId);

    // Delete project to test cache expiry
    await db.delete(project).where(eq(project.id, projectId));

    // Advance time by 2 more minutes (total 6 minutes - cache expired)
    currentTime += 2 * 60 * 1000;

    // Should fail because cache expired and DB record deleted
    await expect(validateApiKey(request, db)).rejects.toThrow("Invalid API key");

    // Restore Date.now
    Date.now = originalDateNow;
  });

  it("invalidateApiKeyCache removes cached entry", async () => {
    const projectId = nanoid();
    const apiKey = generateApiKey();
    const projectName = "invalidate-test";

    // Create project
    await db.insert(project).values({
      id: projectId,
      name: projectName,
      apiKeyHash: hashApiKey(apiKey),
      ownerId: userId,
    });

    const request = new Request("http://localhost", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    // First call - creates cache entry
    await validateApiKey(request, db);

    // Invalidate the cache
    invalidateApiKeyCache(apiKey);

    // Delete project from database
    await db.delete(project).where(eq(project.id, projectId));

    // Next call should fail (cache was invalidated, DB record deleted)
    await expect(validateApiKey(request, db)).rejects.toThrow("Invalid API key");
  });

  it("clearApiKeyCache removes all entries", async () => {
    const project1Id = nanoid();
    const apiKey1 = generateApiKey();
    const project2Id = nanoid();
    const apiKey2 = generateApiKey();

    // Create two projects
    await db.insert(project).values([
      {
        id: project1Id,
        name: "project-1",
        apiKeyHash: hashApiKey(apiKey1),
        ownerId: userId,
      },
      {
        id: project2Id,
        name: "project-2",
        apiKeyHash: hashApiKey(apiKey2),
        ownerId: userId,
      },
    ]);

    const request1 = new Request("http://localhost", {
      headers: { Authorization: `Bearer ${apiKey1}` },
    });
    const request2 = new Request("http://localhost", {
      headers: { Authorization: `Bearer ${apiKey2}` },
    });

    // Validate both keys (creates cache entries)
    await validateApiKey(request1, db);
    await validateApiKey(request2, db);

    // Clear all cache
    clearApiKeyCache();

    // Delete both projects
    await db.delete(project).where(eq(project.id, project1Id));
    await db.delete(project).where(eq(project.id, project2Id));

    // Both validations should fail (cache cleared, DB records deleted)
    await expect(validateApiKey(request1, db)).rejects.toThrow("Invalid API key");
    await expect(validateApiKey(request2, db)).rejects.toThrow("Invalid API key");
  });
});
