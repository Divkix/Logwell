#!/usr/bin/env bun
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/server/db/schema';
import { backfillProjectIncidents } from '../src/lib/server/utils/incident-backfill';

function parseDaysArg(defaultDays: number): number {
  const arg = process.argv.find((value) => value.startsWith('--days='));
  if (!arg) return defaultDays;
  const raw = Number.parseInt(arg.split('=')[1] || '', 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    throw new Error('Invalid --days argument. Expected a positive integer.');
  }
  return raw;
}

async function runBackfill() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const days = parseDaysArg(7);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const client = postgres(DATABASE_URL);
  const db = drizzle(client, { schema });

  try {
    const projects = await db
      .select({ id: schema.project.id, name: schema.project.name })
      .from(schema.project);

    if (projects.length === 0) {
      console.log('No projects found. Nothing to backfill.');
      return;
    }

    let totalProcessed = 0;
    let totalUpdated = 0;
    let totalTouchedIncidents = 0;

    console.log(`Starting incident backfill for last ${days} day(s) since ${since.toISOString()}`);

    for (const proj of projects) {
      const result = await backfillProjectIncidents(db, proj.id, since);
      totalProcessed += result.processedLogs;
      totalUpdated += result.updatedLogs;
      totalTouchedIncidents += result.touchedIncidents;

      console.log(
        `- ${proj.name} (${proj.id}): processed=${result.processedLogs}, updated=${result.updatedLogs}, incidents=${result.touchedIncidents}`,
      );
    }

    console.log('Incident backfill complete');
    console.log(`Processed logs: ${totalProcessed}`);
    console.log(`Updated logs: ${totalUpdated}`);
    console.log(`Touched incidents: ${totalTouchedIncidents}`);
  } finally {
    await client.end();
  }
}

runBackfill().catch((error) => {
  console.error('Incident backfill failed:', error);
  process.exit(1);
});
