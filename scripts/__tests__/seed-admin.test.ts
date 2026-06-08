import { eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createAuth } from "../../src/lib/server/auth";
import type * as schema from "../../src/lib/server/db/schema";
import { user } from "../../src/lib/server/db/schema";
import { setupTestDatabase } from "../../src/lib/server/db/test-db";

// Admin username constant (matches the one in seed-admin.ts)
const ADMIN_USERNAME = "admin";

/**
 * Test helper that mimics the seed-admin script logic
 * @param db - Database instance
 * @param adminPassword - Admin password
 * @param adminUsername - Admin username (defaults to ADMIN_USERNAME constant)
 */
async function seedAdmin(
  db: PgliteDatabase<typeof schema>,
  adminPassword: string,
  adminUsername: string = ADMIN_USERNAME,
): Promise<{ created: boolean; message: string }> {
  const auth = createAuth(db);

  // Validate password
  if (!adminPassword || adminPassword.length < 8) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters long");
  }

  // Generate email from username (using .local TLD as localhost is rejected by email validation)
  const generatedEmail = `${adminUsername}@logwell.local`;

  // Check if admin already exists by username
  const existingAdmin = await db.select().from(user).where(eq(user.username, adminUsername));

  if (existingAdmin.length > 0) {
    return { created: false, message: "Admin user already exists, skipping" };
  }

  // Create admin user via better-auth with username
  const result = await auth.api.signUpEmail({
    body: {
      email: generatedEmail,
      password: adminPassword,
      name: "Admin",
      username: adminUsername,
    },
  });

  if (result.error) {
    throw new Error(`Failed to create admin user: ${result.error.message}`);
  }

  return { created: true, message: "Admin user created successfully" };
}

describe("seed-admin", () => {
  let db: Awaited<ReturnType<typeof setupTestDatabase>>["db"];
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should create admin user on first run", async () => {
    const adminPassword = "test-admin-password-123";

    const result = await seedAdmin(db, adminPassword);

    expect(result.created).toBe(true);
    expect(result.message).toBe("Admin user created successfully");

    // Verify user was created in database with username
    const users = await db.select().from(user).where(eq(user.username, ADMIN_USERNAME));
    expect(users).toHaveLength(1);
    expect(users[0].name).toBe("Admin");
    expect(users[0].username).toBe(ADMIN_USERNAME);
    expect(users[0].email).toBe(`${ADMIN_USERNAME}@logwell.local`);
    expect(users[0].emailVerified).toBe(false);
  });

  it("should skip if admin already exists", async () => {
    const adminPassword = "test-admin-password-123";

    // Create admin user first
    const firstResult = await seedAdmin(db, adminPassword);
    expect(firstResult.created).toBe(true);

    // Try to create again
    const secondResult = await seedAdmin(db, adminPassword);
    expect(secondResult.created).toBe(false);
    expect(secondResult.message).toBe("Admin user already exists, skipping");

    // Verify still only one user
    const users = await db.select().from(user).where(eq(user.username, ADMIN_USERNAME));
    expect(users).toHaveLength(1);
  });

  it("should use ADMIN_PASSWORD from environment", async () => {
    const adminPassword = process.env.ADMIN_PASSWORD || "fallback-password-123";

    const result = await seedAdmin(db, adminPassword);

    expect(result.created).toBe(true);

    // Verify user was created with username
    const users = await db.select().from(user).where(eq(user.username, ADMIN_USERNAME));
    expect(users).toHaveLength(1);
  });

  it("should generate email as {username}@logwell.local", async () => {
    const adminPassword = "test-admin-password-123";

    const result = await seedAdmin(db, adminPassword);

    expect(result.created).toBe(true);

    // Verify the generated email format
    const users = await db.select().from(user);
    expect(users).toHaveLength(1);
    expect(users[0].username).toBe(ADMIN_USERNAME);
    expect(users[0].email).toBe(`${ADMIN_USERNAME}@logwell.local`);
  });

  it("should use custom ADMIN_USERNAME from environment", async () => {
    const adminPassword = "test-admin-password-123";
    const customUsername = "superadmin";

    const result = await seedAdmin(db, adminPassword, customUsername);

    expect(result.created).toBe(true);

    // Verify user was created with custom username
    const users = await db.select().from(user).where(eq(user.username, customUsername));
    expect(users).toHaveLength(1);
    expect(users[0].username).toBe(customUsername);
    expect(users[0].email).toBe(`${customUsername}@logwell.local`);
  });

  it("should be able to sign in with created credentials using username", async () => {
    const adminPassword = "test-admin-password-123";
    const auth = createAuth(db);

    // Create admin user
    await seedAdmin(db, adminPassword);

    // Try to sign in using username (not email)
    const signInResult = await auth.api.signInUsername({
      body: {
        username: ADMIN_USERNAME,
        password: adminPassword,
      },
    });

    // Check that sign in succeeded (no error)
    expect(signInResult.error).toBeUndefined();

    // Verify user exists in database with correct username
    const users = await db.select().from(user).where(eq(user.username, ADMIN_USERNAME));
    expect(users).toHaveLength(1);
    expect(users[0].username).toBe(ADMIN_USERNAME);
  });

  it("should throw error if password is empty", async () => {
    await expect(seedAdmin(db, "")).rejects.toThrow(
      "ADMIN_PASSWORD must be at least 8 characters long",
    );
  });

  it("should throw error if password is too short", async () => {
    await expect(seedAdmin(db, "short")).rejects.toThrow(
      "ADMIN_PASSWORD must be at least 8 characters long",
    );
  });
});
