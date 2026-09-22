import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { env, isProduction } from "./config/env";
import type { DatabaseClient } from "./db/db";

export function createAuth(database: DatabaseClient) {
  return betterAuth({
    database: drizzleAdapter(database, {
      provider: "pg",
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
    },
    plugins: [username()],
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [process.env.ORIGIN].filter((origin): origin is string => Boolean(origin)),
    advanced: {
      // better-auth infers Secure (and the __Secure- name prefix) from NODE_ENV === "production",
      // but this app treats an unset NODE_ENV as production (see config/env.ts). Without this,
      // such a deployment would enforce production secret rules yet issue non-Secure session cookies.
      useSecureCookies: isProduction(),
    },
  });
}

let _auth: ReturnType<typeof createAuth> | undefined;

let _initPromise: Promise<void> | undefined;

async function initAuth(): Promise<void> {
  if (_auth) return;

  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const { db } = await import("./db");
    _auth = createAuth(db);
  })();

  return _initPromise;
}

// SAFETY: every access is served by the get trap below from the initialized _auth;
// the empty target object itself is never read.
export const auth = new Proxy({} as ReturnType<typeof createAuth>, {
  get(_target, prop) {
    if (!_auth) {
      throw new Error("Auth not initialized. Call initAuth() before accessing auth properties.");
    }

    // SAFETY: TypeScript checks every typed `auth.<member>` access against
    // keyof typeof createAuth before it reaches this trap, and any other key the runtime
    // probes (e.g. `then` or a well-known symbol) reads as undefined from _auth instead of throwing.
    return _auth[prop as keyof typeof _auth];
  },
});

export { initAuth };

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"]["session"];

export type User = ReturnType<typeof createAuth>["$Infer"]["Session"]["user"];
