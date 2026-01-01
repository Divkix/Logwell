import { eq } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { nanoid } from 'nanoid';
import { beforeEach, describe, expect, it } from 'vitest';
import type * as schema from '../../../src/lib/server/db/schema';
import { project } from '../../../src/lib/server/db/schema';
import { setupTestDatabase } from '../../../src/lib/server/db/test-db';

/**
 * Generates a unique API key in the format: svl_<32-random-chars>
 */
function generateApiKey(): string {
  return `svl_${nanoid(32)}`;
}

describe('Project Table Schema', () => {
  let db: PgliteDatabase<typeof schema>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
  });

  it('should create a project with API key', async () => {
    const projectId = nanoid();
    const apiKey = generateApiKey();
    const projectName = 'test-project';

    const [createdProject] = await db
      .insert(project)
      .values({
        id: projectId,
        name: projectName,
        apiKey: apiKey,
      })
      .returning();

    expect(createdProject).toBeDefined();
    expect(createdProject.id).toBe(projectId);
    expect(createdProject.name).toBe(projectName);
    expect(createdProject.apiKey).toBe(apiKey);
    expect(createdProject.createdAt).toBeInstanceOf(Date);
    expect(createdProject.updatedAt).toBeInstanceOf(Date);
  });

  it('should enforce unique project names', async () => {
    const projectName = 'duplicate-name';
    const apiKey1 = generateApiKey();
    const apiKey2 = generateApiKey();

    // Create first project
    await db.insert(project).values({
      id: nanoid(),
      name: projectName,
      apiKey: apiKey1,
    });

    // Attempt to create second project with same name should fail
    await expect(
      db.insert(project).values({
        id: nanoid(),
        name: projectName,
        apiKey: apiKey2,
      }),
    ).rejects.toThrow();
  });

  it('should find project by API key', async () => {
    const projectId = nanoid();
    const apiKey = generateApiKey();
    const projectName = 'api-key-test';

    // Create project
    await db.insert(project).values({
      id: projectId,
      name: projectName,
      apiKey: apiKey,
    });

    // Find by API key
    const [foundProject] = await db.select().from(project).where(eq(project.apiKey, apiKey));

    expect(foundProject).toBeDefined();
    expect(foundProject.id).toBe(projectId);
    expect(foundProject.name).toBe(projectName);
    expect(foundProject.apiKey).toBe(apiKey);
  });
});
