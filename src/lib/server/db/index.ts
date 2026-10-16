import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "#lib/server/config/env.js";
import * as schema from "./schema";

const client = postgres(env.DATABASE_URL, {
  max: 20,
  idle_timeout: 30,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });

/** Drain in-flight queries (up to 5s) and close the pool before the process exits. */
export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}
