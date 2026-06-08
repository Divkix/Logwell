import { createHash } from 'node:crypto';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { nanoid } from 'nanoid';
import * as schema from '../../src/lib/server/db/schema';

/**
 * Type for project creation/selection
 */
export type ProjectInsert = typeof schema.project.$inferInsert;
export type ProjectSelect = typeof schema.project.$inferSelect;

/**
 * Type for user creation/selection
 */
export type UserInsert = typeof schema.user.$inferInsert;
export type UserSelect = typeof schema.user.$inferSelect;

/**
 * Type for log creation/selection
 */
export type LogInsert = typeof schema.log.$inferInsert;
export type LogSelect = typeof schema.log.$inferSelect;

/**
 * Generates a unique API key in the format: lw_<32-random-chars>
 */
export function generateApiKey(): string {
  return `lw_${nanoid(32)}`;
}

/**
 * Cache for default test user per database instance
 * Uses WeakMap to avoid memory leaks when db instances are garbage collected
 */
const defaultUserCache = new WeakMap<PgliteDatabase<typeof schema>, UserSelect>();

/**
 * Gets or creates a default test user for the given database
 * Used when ownerId is not explicitly provided to seedProject
 */
export async function getOrCreateDefaultUser(
  db: PgliteDatabase<typeof schema>,
): Promise<UserSelect> {
  // Check cache first
  const cached = defaultUserCache.get(db);
  if (cached) return cached;

  // Create a default test user
  const userId = nanoid();
  const [user] = await db
    .insert(schema.user)
    .values({
      id: userId,
      name: 'Test User',
      email: `test-${userId}@example.com`,
      emailVerified: false,
    })
    .returning();

  if (!user) throw new Error('Failed to create test user');

  // Cache and return
  defaultUserCache.set(db, user);
  return user;
}

/**
 * Factory function to create test projects
 * Note: ownerId must be provided (use getOrCreateDefaultUser if you don't have a specific user)
 */
export function createProjectFactory(
  overrides: Partial<ProjectInsert> & { ownerId: string },
): ProjectInsert {
  // API keys are stored hashed only. Derive the hash from a fresh random key
  // unless the caller provides an explicit apiKeyHash. apiKeyHash is applied
  // after the spread so overrides can't leave it inconsistent.
  const apiKeyHash =
    overrides.apiKeyHash ?? createHash('sha256').update(generateApiKey()).digest('hex');
  return {
    id: nanoid(),
    name: `test-project-${nanoid(8)}`,
    ...overrides,
    apiKeyHash,
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
 * If ownerId is not provided, creates a default test user automatically
 */
export async function seedProjects(
  db: PgliteDatabase<typeof schema>,
  count: number = 3,
  overrides: Partial<ProjectInsert> = {},
): Promise<ProjectSelect[]> {
  // Get or create default user if ownerId not provided
  const ownerId = overrides.ownerId ?? (await getOrCreateDefaultUser(db)).id;

  const projects: ProjectInsert[] = Array.from({ length: count }, () =>
    createProjectFactory({ ...overrides, ownerId }),
  );

  return await db.insert(schema.project).values(projects).returning();
}

/**
 * Seed a single project into the database
 * If ownerId is not provided, creates a default test user automatically
 */
export async function seedProject(
  db: PgliteDatabase<typeof schema>,
  overrides: Partial<ProjectInsert> = {},
): Promise<ProjectSelect> {
  // Get or create default user if ownerId not provided
  const ownerId = overrides.ownerId ?? (await getOrCreateDefaultUser(db)).id;

  const project = createProjectFactory({ ...overrides, ownerId });
  const [result] = await db.insert(schema.project).values(project).returning();
  if (!result) throw new Error('Failed to create test project');
  return result;
}

/**
 * Seed a single project and return the row together with the plaintext API key.
 * The plaintext key is never stored (only its hash is) — this helper exposes it
 * for tests that need to authenticate ingestion requests.
 */
export async function seedProjectWithApiKey(
  db: PgliteDatabase<typeof schema>,
  overrides: Omit<Partial<ProjectInsert>, 'apiKeyHash'> = {},
): Promise<ProjectSelect & { apiKey: string }> {
  const apiKey = generateApiKey();
  const apiKeyHash = createHash('sha256').update(apiKey).digest('hex');
  const result = await seedProject(db, { ...overrides, apiKeyHash });
  return { ...result, apiKey };
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
  if (!result) throw new Error('Failed to create test log');
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
