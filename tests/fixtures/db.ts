import type { PgliteDatabase } from "drizzle-orm/pglite";
import { nanoid } from "nanoid";
import * as schema from "../../src/lib/server/db/schema";
import { hashApiKey } from "../../src/lib/server/utils/api-key";

export type ProjectInsert = typeof schema.project.$inferInsert;
export type ProjectSelect = typeof schema.project.$inferSelect;

export type UserInsert = typeof schema.user.$inferInsert;
export type UserSelect = typeof schema.user.$inferSelect;

export type LogInsert = typeof schema.log.$inferInsert;
export type LogSelect = typeof schema.log.$inferSelect;

export function generateApiKey(): string {
  return `lw_${nanoid(32)}`;
}

const defaultUserCache = new WeakMap<PgliteDatabase<typeof schema>, UserSelect>();

export async function getOrCreateDefaultUser(
  db: PgliteDatabase<typeof schema>,
): Promise<UserSelect> {
  const cached = defaultUserCache.get(db);
  if (cached) return cached;

  const userId = nanoid();
  const [user] = await db
    .insert(schema.user)
    .values({
      id: userId,
      name: "Test User",
      email: `test-${userId}@example.com`,
      emailVerified: false,
    })
    .returning();

  if (!user) throw new Error("Failed to create test user");

  defaultUserCache.set(db, user);
  return user;
}

export function createProjectFactory(
  overrides: Partial<ProjectInsert> & { ownerId: string },
): ProjectInsert {
  const apiKeyHash = overrides.apiKeyHash ?? hashApiKey(generateApiKey());
  return {
    id: nanoid(),
    name: `test-project-${nanoid(8)}`,
    ...overrides,
    apiKeyHash,
  };
}

export function createLogFactory(overrides: Partial<LogInsert> = {}): LogInsert {
  return {
    id: nanoid(),
    projectId: overrides.projectId || nanoid(), // Will fail if no valid projectId
    level: "info",
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

export async function seedProjects(
  db: PgliteDatabase<typeof schema>,
  count: number = 3,
  overrides: Partial<ProjectInsert> = {},
): Promise<ProjectSelect[]> {
  const ownerId = overrides.ownerId ?? (await getOrCreateDefaultUser(db)).id;

  const projects: ProjectInsert[] = Array.from({ length: count }, () =>
    createProjectFactory({ ...overrides, ownerId }),
  );

  return await db.insert(schema.project).values(projects).returning();
}

export async function seedProject(
  db: PgliteDatabase<typeof schema>,
  overrides: Partial<ProjectInsert> = {},
): Promise<ProjectSelect> {
  const ownerId = overrides.ownerId ?? (await getOrCreateDefaultUser(db)).id;

  const project = createProjectFactory({ ...overrides, ownerId });
  const [result] = await db.insert(schema.project).values(project).returning();
  if (!result) throw new Error("Failed to create test project");
  return result;
}

export async function seedProjectWithApiKey(
  db: PgliteDatabase<typeof schema>,
  overrides: Omit<Partial<ProjectInsert>, "apiKeyHash"> = {},
): Promise<ProjectSelect & { apiKey: string }> {
  const apiKey = generateApiKey();
  const apiKeyHash = hashApiKey(apiKey);
  const result = await seedProject(db, { ...overrides, apiKeyHash });
  return { ...result, apiKey };
}

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

export async function seedLog(
  db: PgliteDatabase<typeof schema>,
  projectId: string,
  overrides: Partial<LogInsert> = {},
): Promise<LogSelect> {
  const log = createLogFactory({ projectId, ...overrides });
  const [result] = await db.insert(schema.log).values(log).returning();
  if (!result) throw new Error("Failed to create test log");
  return result;
}

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
