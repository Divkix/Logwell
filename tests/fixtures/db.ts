import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { nanoid } from 'nanoid';
import * as schema from '../../src/lib/server/db/schema';

/**
 * Type for project creation/selection
 */
export type ProjectInsert = typeof schema.project.$inferInsert;
export type ProjectSelect = typeof schema.project.$inferSelect;

/**
 * Generates a unique API key in the format: svl_<32-random-chars>
 */
export function generateApiKey(): string {
  return `svl_${nanoid(32)}`;
}

/**
 * Factory function to create test projects
 */
export function createProjectFactory(overrides: Partial<ProjectInsert> = {}): ProjectInsert {
  return {
    id: nanoid(),
    name: `test-project-${nanoid(8)}`,
    apiKey: generateApiKey(),
    ...overrides,
  };
}

/**
 * Seed multiple projects into the database
 */
export async function seedProjects(
  db: PgliteDatabase<typeof schema>,
  count: number = 3,
  overrides: Partial<ProjectInsert> = {},
): Promise<ProjectSelect[]> {
  const projects: ProjectInsert[] = Array.from({ length: count }, () =>
    createProjectFactory(overrides),
  );

  return await db.insert(schema.project).values(projects).returning();
}

/**
 * Seed a single project into the database
 */
export async function seedProject(
  db: PgliteDatabase<typeof schema>,
  overrides: Partial<ProjectInsert> = {},
): Promise<ProjectSelect> {
  const project = createProjectFactory(overrides);
  const [result] = await db.insert(schema.project).values(project).returning();
  return result;
}

/**
 * Generic seeder for test data
 */
export async function seedTestData(
  db: PgliteDatabase<typeof schema>,
  data: {
    projects?: ProjectInsert[];
  },
): Promise<void> {
  if (data.projects && data.projects.length > 0) {
    await db.insert(schema.project).values(data.projects);
  }
}
