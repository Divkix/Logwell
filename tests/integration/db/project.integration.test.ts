import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { nanoid } from "nanoid";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import * as schema from "../../../src/lib/server/db/schema";
import { project } from "../../../src/lib/server/db/schema";
import { setupTestDatabase } from "../../../src/lib/server/db/test-db";
import { getOrCreateDefaultUser } from "../../fixtures/db";

/**
 * Generates a unique API key in the format: lw_<32-random-chars>
 */
function generateApiKey(): string {
  return `lw_${nanoid(32)}`;
}

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

describe("Project Table Schema", () => {
  let db: PgliteDatabase<typeof schema>;
  let userId: string;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    const user = await getOrCreateDefaultUser(db);
    userId = user.id;
  });

  it("should create a project with API key", async () => {
    const projectId = nanoid();
    const apiKey = generateApiKey();
    const projectName = "test-project";

    const [createdProject] = await db
      .insert(project)
      .values({
        id: projectId,
        name: projectName,
        apiKeyHash: hashApiKey(apiKey),
        ownerId: userId,
      })
      .returning();

    expect(createdProject).toBeDefined();
    expect(createdProject!.id).toBe(projectId);
    expect(createdProject!.name).toBe(projectName);
    expect(createdProject!.apiKeyHash).toBe(hashApiKey(apiKey));
    expect(createdProject!.createdAt).toBeInstanceOf(Date);
    expect(createdProject!.updatedAt).toBeInstanceOf(Date);
  });

  it("should enforce unique project names per owner", async () => {
    const projectName = "duplicate-name";
    const apiKey1 = generateApiKey();
    const apiKey2 = generateApiKey();

    // Create first project for user1
    await db.insert(project).values({
      id: nanoid(),
      name: projectName,
      apiKeyHash: hashApiKey(apiKey1),
      ownerId: userId,
    });

    // Attempt to create second project with same name for same user should fail
    await expect(
      db.insert(project).values({
        id: nanoid(),
        name: projectName,
        apiKeyHash: hashApiKey(apiKey2),
        ownerId: userId,
      }),
    ).rejects.toThrow();

    // Create a different user
    const otherUserId = nanoid();
    await db.insert(schema.user).values({
      id: otherUserId,
      name: "Other User",
      email: `other-${otherUserId}@example.com`,
      emailVerified: false,
    });

    // Same project name for different user should succeed
    const apiKey3 = generateApiKey();
    const [otherProject] = await db
      .insert(project)
      .values({
        id: nanoid(),
        name: projectName,
        apiKeyHash: hashApiKey(apiKey3),
        ownerId: otherUserId,
      })
      .returning();

    expect(otherProject).toBeDefined();
    expect(otherProject!.name).toBe(projectName);
    expect(otherProject!.ownerId).toBe(otherUserId);
  });

  it("should find project by API key", async () => {
    const projectId = nanoid();
    const apiKey = generateApiKey();
    const projectName = "api-key-test";

    // Create project
    await db.insert(project).values({
      id: projectId,
      name: projectName,
      apiKeyHash: hashApiKey(apiKey),
      ownerId: userId,
    });

    // Find by API key hash
    const [foundProject] = await db
      .select()
      .from(project)
      .where(eq(project.apiKeyHash, hashApiKey(apiKey)));

    expect(foundProject).toBeDefined();
    expect(foundProject!.id).toBe(projectId);
    expect(foundProject!.name).toBe(projectName);
    expect(foundProject!.apiKeyHash).toBe(hashApiKey(apiKey));
  });
});
