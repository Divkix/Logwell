import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "#lib/server/config/env.js";
import * as schema from "./schema";

const client = postgres(env.DATABASE_URL, {
  max: 20,
  idle_timeout: 30,
  connect_timeout: 10,
  // Sent as startup parameters, so every pooled connection carries them and Postgres itself
  // cancels a runaway statement (SQLSTATE 57014, mapped to 503 query_timeout) or a transaction
  // left idle. postgres-js drops falsy values, so 0 leaves the server/role setting in force.
  connection: {
    statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  },
});

export const db = drizzle(client, { schema });

/** Drain in-flight queries (up to 5s) and close the pool before the process exits. */
export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}
