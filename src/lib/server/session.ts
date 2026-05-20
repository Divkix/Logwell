import { eq } from 'drizzle-orm';
import { session as sessionTable, user as userTable } from '$lib/server/db/schema';
import type { Session, User } from './auth';
import type { DatabaseClient } from './db/db';

/**
 * Extracts session token from request headers
 */
function getSessionToken(headers: Headers): string | null {
  const cookie = headers.get('cookie');
  if (!cookie) return null;

  // Parse cookies and find better-auth session token
  const cookies = cookie.split(';').map((c) => c.trim());
  for (const cookie of cookies) {
    if (cookie.startsWith('better-auth.session_token=')) {
      return cookie.substring('better-auth.session_token='.length);
    }
  }

  return null;
}

/**
 * Gets session and user from database using session token
 * @param headers - Request headers containing the session cookie
 * @param database - Optional database instance (defaults to production db)
 */
export async function getSession(
  headers: Headers,
  database?: DatabaseClient,
): Promise<{ user: User; session: Session } | null> {
  // Lazy-load production database if not provided
  const db = database || (await import('$lib/server/db')).db;

  const token = getSessionToken(headers);
  if (!token) return null;

  // Query session with user join
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

  const { session, user } = result[0];

  // Check if session is expired
  if (session.expiresAt < new Date()) {
    return null;
  }

  return { user, session };
}
