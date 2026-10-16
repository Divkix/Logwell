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

// One dedicated connection for /api/health, outside the app pool: when all 20 pooled
// connections are busy, a probe queued behind them would report a healthy database as down
// (and outlive the 10s Docker HEALTHCHECK). Its own short limits keep a stuck probe from
// holding the connection either; the route adds an overall deadline on top.
const healthClient = postgres(env.DATABASE_URL, {
  max: 1,
  idle_timeout: 120,
  connect_timeout: 5,
  connection: { statement_timeout: 2000, application_name: "logwell-health" },
});

export const healthDb = drizzle(healthClient, { schema });

/** Drain in-flight queries (up to 5s) and close both pools before the process exits. */
export async function closeDb(): Promise<void> {
  await Promise.all([client.end({ timeout: 5 }), healthClient.end({ timeout: 1 })]);
}
