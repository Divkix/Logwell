/**
 * TEST-ONLY helper — do NOT use in production routes.
 * Production code uses auth.api.getSession() which properly validates HMAC signatures.
 * This module does a raw DB lookup without signature verification and is only used in
 * integration test setup.
 */

import { eq } from "drizzle-orm";
import { session as sessionTable, user as userTable } from "$lib/server/db/schema";
import type { Session, User } from "./auth";
import type { DatabaseClient } from "./db/db";

function getSessionToken(headers: Headers): string | null {
  const cookie = headers.get("cookie");
  if (!cookie) return null;

  const cookies = cookie.split(";").map((c) => c.trim());
  for (const cookie of cookies) {
    if (cookie.startsWith("better-auth.session_token=")) {
      return cookie.substring("better-auth.session_token=".length);
    }
  }

  return null;
}

export async function getSession(
  headers: Headers,
  database?: DatabaseClient,
): Promise<{ user: User; session: Session } | null> {
  const db = database || (await import("$lib/server/db")).db;

  const token = getSessionToken(headers);
  if (!token) return null;

  const result = await db
    .select({
      session: sessionTable,
      user: userTable,
    })
    .from(sessionTable)
    .where(eq(sessionTable.token, token))
    .innerJoin(userTable, eq(sessionTable.userId, userTable.id))
    .limit(1);

  if (result.length === 0) return null;

  const resultRow = result[0];
  if (!resultRow) return null;
  const { session, user } = resultRow;

  if (session.expiresAt < new Date()) {
    return null;
  }

  return { user, session };
}
