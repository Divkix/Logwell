#!/usr/bin/env bun
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createAuth } from "../src/lib/server/auth";
import * as schema from "../src/lib/server/db/schema";

// Admin username constant (configurable via ADMIN_USERNAME env var)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";

/**
 * Seeds the admin user into the database
 * Uses ADMIN_PASSWORD and ADMIN_USERNAME from environment variables
 */
async function seedAdmin() {
  // Check for required environment variables
  const DATABASE_URL = process.env.DATABASE_URL;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  if (!ADMIN_PASSWORD) {
    throw new Error("ADMIN_PASSWORD environment variable is required");
  }

  if (ADMIN_PASSWORD.length < 8) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters long");
  }

  // Generate email from username (email is still required by better-auth internally)
  // Using .local TLD as localhost is rejected by email validation
  const generatedEmail = `${ADMIN_USERNAME}@logwell.local`;

  // Initialize database connection
  const client = postgres(DATABASE_URL);
  const db = drizzle(client, { schema });

  try {
    // Create admin user via better-auth with username
    // Idempotent: catch unique constraint errors and treat as success
    const auth = createAuth(db);
    try {
      const result = await auth.api.signUpEmail({
        body: {
          email: generatedEmail,
          password: ADMIN_PASSWORD,
          name: "Admin",
          username: ADMIN_USERNAME,
        },
      });

      if (result.error) {
        throw new Error(`Failed to create admin user: ${result.error.message}`);
      }

      console.log("✓ Admin user created successfully");
      console.log(`  Username: ${ADMIN_USERNAME}`);
      console.log("  You can now sign in with the admin credentials");
    } catch (e) {
      const msg = e instanceof Error ? e.message.toLowerCase() : "";
      if (msg.includes("unique") || msg.includes("already exists") || msg.includes("23505")) {
        console.log("✓ Admin user already exists, skipping seed.");
      } else {
        throw e;
      }
    }
  } catch (error) {
    console.error("✗ Failed to seed admin user:", error);
    throw error;
  } finally {
    // Close database connection
    await client.end();
  }
}

// Run the seed function
seedAdmin().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
