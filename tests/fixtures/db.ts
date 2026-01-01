import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { nanoid } from 'nanoid';
import * as schema from '../../src/lib/server/db/schema';

/**
 * Type for project creation/selection
 */
export type ProjectInsert = typeof schema.project.$inferInsert;
export type ProjectSelect = typeof schema.project.$inferSelect;

/**
 * Type for log creation/selection
 */
export type LogInsert = typeof schema.log.$inferInsert;
export type LogSelect = typeof schema.log.$inferSelect;

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
 * Factory function to create test logs
 */
export function createLogFactory(overrides: Partial<LogInsert> = {}): LogInsert {
  return {
    id: nanoid(),
    projectId: overrides.projectId || nanoid(), // Will fail if no valid projectId
    level: 'info',
    message: `Test log message ${nanoid(8)}`,
    metadata: null,
    sourceFile: null,
    lineNumber: null,
    requestId: null,
    userId: null,
    ipAddress: null,
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
 * Seed multiple logs into the database
 */
export async function seedLogs(
  db: PgliteDatabase<typeof schema>,
  projectId: string,
  count: number = 10,
  overrides: Partial<LogInsert> = {},
): Promise<LogSelect[]> {
  const logs: LogInsert[] = Array.from({ length: count }, () =>
    createLogFactory({ projectId, ...overrides }),
  );

  return await db.insert(schema.log).values(logs).returning();
}

/**
 * Seed a single log into the database
 */
export async function seedLog(
  db: PgliteDatabase<typeof schema>,
  projectId: string,
  overrides: Partial<LogInsert> = {},
): Promise<LogSelect> {
  const log = createLogFactory({ projectId, ...overrides });
  const [result] = await db.insert(schema.log).values(log).returning();
  return result;
}

/**
 * Generic seeder for test data
 */
export async function seedTestData(
  db: PgliteDatabase<typeof schema>,
  data: {
    projects?: ProjectInsert[];
    logs?: LogInsert[];
  },
): Promise<void> {
  if (data.projects && data.projects.length > 0) {
    await db.insert(schema.project).values(data.projects);
  }

  if (data.logs && data.logs.length > 0) {
    await db.insert(schema.log).values(data.logs);
  }
}
