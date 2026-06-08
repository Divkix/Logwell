import { eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createAuth } from "../../../src/lib/server/auth";
import type * as schema from "../../../src/lib/server/db/schema";
import { session, user } from "../../../src/lib/server/db/schema";
import { setupTestDatabase } from "../../../src/lib/server/db/test-db";

describe("better-auth Integration", () => {
  let db: PgliteDatabase<typeof schema>;
  let auth: ReturnType<typeof createAuth>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    auth = createAuth(db);
  });

  describe("User signup and authentication", () => {
    it("should create user via signUpEmail", async () => {
      const email = "test@example.com";
      const password = "SecureP@ssw0rd123";
      const name = "Test User";

      // Sign up user
      const result = await auth.api.signUpEmail({
        body: {
          email,
          password,
          name,
        },
      });

      expect(result).toBeDefined();
      expect(result.user).toBeDefined();
      expect(result.user.email).toBe(email);
      expect(result.user.name).toBe(name);
      expect(result.user.emailVerified).toBe(false);

      // Verify user exists in database
      const [createdUser] = await db.select().from(user).where(eq(user.email, email));
      expect(createdUser).toBeDefined();
      expect(createdUser!.email).toBe(email);
      expect(createdUser!.name).toBe(name);
    });

    it("should sign in with valid credentials and create session", async () => {
      const email = "signin@example.com";
      const password = "SecureP@ssw0rd123";
      const name = "Sign In User";

      // Create user first
      await auth.api.signUpEmail({
        body: {
          email,
          password,
          name,
        },
      });

      // Clear any sessions from signup
      await db.delete(session);

      // Now test sign in separately
      const result = await auth.api.signInEmail({
        body: {
          email,
          password,
        },
      });

      expect(result).toBeDefined();
      expect(result.user).toBeDefined();
      expect(result.user.email).toBe(email);
      expect(result.token).toBeDefined();

      // Verify session was created in database
      const sessions = await db.select().from(session).where(eq(session.userId, result.user.id));
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions[0]!.userId).toBe(result.user.id);
      expect(sessions[0]!.token).toBe(result.token);
    });

    it("should fail to sign in with invalid password", async () => {
      const email = "invalid@example.com";
      const password = "CorrectP@ssw0rd123";
      const wrongPassword = "WrongP@ssw0rd123";
      const name = "Invalid User";

      // Create user
      await auth.api.signUpEmail({
        body: {
          email,
          password,
          name,
        },
      });

      // Try to sign in with wrong password
      await expect(
        auth.api.signInEmail({
          body: {
            email,
            password: wrongPassword,
          },
        }),
      ).rejects.toThrow();
    });

    it("should prevent duplicate email registration", async () => {
      const email = "duplicate@example.com";
      const password = "SecureP@ssw0rd123";
      const name = "Duplicate User";

      // Create first user
      await auth.api.signUpEmail({
        body: {
          email,
          password,
          name,
        },
      });

      // Try to create second user with same email
      await expect(
        auth.api.signUpEmail({
          body: {
            email,
            password: "DifferentP@ssw0rd123",
            name: "Another Name",
          },
        }),
      ).rejects.toThrow();
    });

    it("should create session on signup with autoSignIn", async () => {
      const email = "autosignin@example.com";
      const password = "SecureP@ssw0rd123";
      const name = "Auto Sign In User";

      const result = await auth.api.signUpEmail({
        body: {
          email,
          password,
          name,
        },
      });

      // With autoSignIn, a session token should be returned
      expect(result.token).toBeDefined();

      // Verify session was created in database
      const sessions = await db.select().from(session).where(eq(session.userId, result.user.id));
      expect(sessions.length).toBe(1);
      expect(sessions[0]!.userId).toBe(result.user.id);
    });
  });

  describe("Session management via database", () => {
    it("should create session in database on sign in", async () => {
      const email = "session-db@example.com";
      const password = "SecureP@ssw0rd123";
      const name = "Session DB User";

      // Create user
      const signUpResult = await auth.api.signUpEmail({
        body: {
          email,
          password,
          name,
        },
      });

      // Verify session exists
      const sessions = await db
        .select()
        .from(session)
        .where(eq(session.userId, signUpResult.user.id));
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions[0]!.token).toBeDefined();
      expect(sessions[0]!.userId).toBe(signUpResult.user.id);
      expect(sessions[0]!.expiresAt).toBeInstanceOf(Date);
    });

    it("should store session with expiration date", async () => {
      const email = "expiry@example.com";
      const password = "SecureP@ssw0rd123";
      const name = "Expiry User";

      const result = await auth.api.signUpEmail({
        body: {
          email,
          password,
          name,
        },
      });

      const sessions = await db.select().from(session).where(eq(session.userId, result.user.id));
      expect(sessions.length).toBe(1);

      const sessionExpiry = sessions[0]!.expiresAt;
      const now = new Date();

      // Session should expire in the future (within 7 days based on config)
      expect(sessionExpiry.getTime()).toBeGreaterThan(now.getTime());
      expect(sessionExpiry.getTime()).toBeLessThanOrEqual(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    });
  });

  describe("Database schema validation", () => {
    it("should have user table with correct structure", async () => {
      const email = "schema@example.com";
      const password = "SecureP@ssw0rd123";
      const name = "Schema User";

      await auth.api.signUpEmail({
        body: {
          email,
          password,
          name,
        },
      });

      const [createdUser] = await db.select().from(user).where(eq(user.email, email));

      expect(createdUser!.id).toBeDefined();
      expect(typeof createdUser!.id).toBe("string");
      expect(createdUser!.name).toBe(name);
      expect(createdUser!.email).toBe(email);
      expect(createdUser!.emailVerified).toBe(false);
      expect(createdUser!.createdAt).toBeInstanceOf(Date);
      expect(createdUser!.updatedAt).toBeInstanceOf(Date);
    });

    it("should enforce email uniqueness constraint", async () => {
      const email = "unique@example.com";

      // Insert user directly to database
      await db.insert(user).values({
        id: "test-user-1",
        name: "First User",
        email,
        emailVerified: false,
      });

      // Try to insert another user with same email
      await expect(
        db.insert(user).values({
          id: "test-user-2",
          name: "Second User",
          email,
          emailVerified: false,
        }),
      ).rejects.toThrow();
    });

    it("should have session table with foreign key to user", async () => {
      const email = "fk-test@example.com";
      const password = "SecureP@ssw0rd123";
      const name = "FK Test User";

      const result = await auth.api.signUpEmail({
        body: {
          email,
          password,
          name,
        },
      });

      const sessions = await db.select().from(session).where(eq(session.userId, result.user.id));
      expect(sessions.length).toBeGreaterThan(0);

      // Delete user should cascade delete sessions
      await db.delete(user).where(eq(user.id, result.user.id));

      const sessionsAfterDelete = await db
        .select()
        .from(session)
        .where(eq(session.userId, result.user.id));
      expect(sessionsAfterDelete.length).toBe(0);
    });
  });
});
