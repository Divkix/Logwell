import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from './db/schema';

/**
 * Creates a better-auth instance with the provided database
 * @param database - Drizzle database instance (postgres-js or PGlite)
 */
export function createAuth(
  database: PostgresJsDatabase<typeof schema> | PgliteDatabase<typeof schema>,
) {
  return betterAuth({
    database: drizzleAdapter(database, {
      provider: 'pg',
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true, // Automatically sign in after signup
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // Update session every 24 hours
    },
    secret: process.env.BETTER_AUTH_SECRET || 'default-secret-for-development-only',
    // Self-hosted app - trust the configured ORIGIN for reverse proxies/tunnels
    trustedOrigins: [process.env.ORIGIN].filter(Boolean) as string[],
  });
}

/**
 * Default auth instance using production database
 * Lazy-loaded to avoid importing $env/dynamic/private in test environments
 */
let _auth: ReturnType<typeof createAuth> | undefined;
let _initPromise: Promise<void> | undefined;

async function initAuth(): Promise<void> {
  if (_auth) return;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const { db } = await import('./db');
    _auth = createAuth(db);
  })();

  return _initPromise;
}

export const auth = new Proxy({} as ReturnType<typeof createAuth>, {
  get(_target, prop) {
    if (!_auth) {
      // For synchronous access, we need to throw if not initialized
      // The hooks.server.ts should call initAuth() first
      throw new Error('Auth not initialized. Call initAuth() before accessing auth properties.');
    }
    return _auth[prop as keyof typeof _auth];
  },
});

export { initAuth };

/**
 * Type exports for better-auth session and user
 */
export type Session = ReturnType<typeof createAuth>['$Infer']['Session']['session'];
export type User = ReturnType<typeof createAuth>['$Infer']['Session']['user'];
