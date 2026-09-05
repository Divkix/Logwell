import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { env } from "./config/env";
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
    trustedOrigins: [process.env.ORIGIN].filter(Boolean) as string[],
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

export const auth = new Proxy({} as ReturnType<typeof createAuth>, {
  get(_target, prop) {
    if (!_auth) {
      throw new Error("Auth not initialized. Call initAuth() before accessing auth properties.");
    }
    return _auth[prop as keyof typeof _auth];
  },
});

export { initAuth };

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"]["session"];
export type User = ReturnType<typeof createAuth>["$Infer"]["Session"]["user"];
