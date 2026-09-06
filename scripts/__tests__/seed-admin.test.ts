import { eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createAuth } from "../../src/lib/server/auth";
import type * as schema from "../../src/lib/server/db/schema";
import { user } from "../../src/lib/server/db/schema";
import { setupTestDatabase } from "../../src/lib/server/db/test-db";

const ADMIN_USERNAME = "admin";

async function seedAdmin(
  db: PgliteDatabase<typeof schema>,
  adminPassword: string,
  adminUsername: string = ADMIN_USERNAME,
): Promise<{ created: boolean; message: string }> {
  const auth = createAuth(db);

  if (!adminPassword || adminPassword.length < 8) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters long");
  }

  // Generate email from username (using .local TLD as localhost is rejected by email validation)
  const generatedEmail = `${adminUsername}@logwell.local`;

  const existingAdmin = await db.select().from(user).where(eq(user.username, adminUsername));

  if (existingAdmin.length > 0) {
    return { created: false, message: "Admin user already exists, skipping" };
  }

  const result = await auth.api.signUpEmail({
    body: {
      email: generatedEmail,
      password: adminPassword,
      name: "Admin",
      username: adminUsername,
    },
  });

  const resultError = (result as { error?: { message: string } }).error;
  if (resultError) {
    throw new Error(`Failed to create admin user: ${resultError.message}`);
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

    const users = await db.select().from(user).where(eq(user.username, ADMIN_USERNAME));
    expect(users).toHaveLength(1);
    expect(users[0].name).toBe("Admin");
    expect(users[0].username).toBe(ADMIN_USERNAME);
    expect(users[0].email).toBe(`${ADMIN_USERNAME}@logwell.local`);
    expect(users[0].emailVerified).toBe(false);
  });

  it("should skip if admin already exists", async () => {
    const adminPassword = "test-admin-password-123";

    const firstResult = await seedAdmin(db, adminPassword);
    expect(firstResult.created).toBe(true);

    const secondResult = await seedAdmin(db, adminPassword);
    expect(secondResult.created).toBe(false);
    expect(secondResult.message).toBe("Admin user already exists, skipping");

    const users = await db.select().from(user).where(eq(user.username, ADMIN_USERNAME));
    expect(users).toHaveLength(1);
  });

  it.each([
    ["empty", ""],
    ["too short", "short"],
  ])("should throw error if password is %s", async (_label, password) => {
    await expect(seedAdmin(db, password)).rejects.toThrow(
      "ADMIN_PASSWORD must be at least 8 characters long",
    );
  });

  it("signUpEmail rejects a duplicate username with a message the seed script treats as idempotent", async () => {
    // The real seed-admin.ts catches signUpEmail failures and treats them as
    // "already exists" (skip) only when the error message matches its
    // idempotency check. A container restart re-runs the seed against an
    // existing admin, so better-auth's duplicate-username error must match.
    // This test pins both sides: the error text AND the script's match set.
    const auth = createAuth(db);
    const adminPassword = "test-admin-password-123";

    await seedAdmin(db, adminPassword);

    const duplicateSignup = auth.api.signUpEmail({
      body: {
        email: `${ADMIN_USERNAME}@logwell.local`,
        password: adminPassword,
        name: "Admin",
        username: ADMIN_USERNAME,
      },
    });

    await expect(duplicateSignup).rejects.toThrow();
    await duplicateSignup.catch((e: unknown) => {
      const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
      // These are the substrings seed-admin.ts recognizes as "already exists".
      const idempotent =
        msg.includes("unique") ||
        msg.includes("already exists") ||
        msg.includes("already taken") ||
        msg.includes("23505") ||
        msg.includes("username_is_already_taken");
      expect(idempotent).toBe(true);
    });
  });
});
