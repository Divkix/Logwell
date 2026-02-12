import { and, eq, gte, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '$lib/server/db/schema';
import { incident, log, type Incident, type LogLevel } from '$lib/server/db/schema';
import {
  assignIncidentIds,
  buildIncidentTitle,
  groupPreparedLogsByFingerprint,
  prepareLogsForIncidents,
} from './incidents';

type DatabaseClient = PostgresJsDatabase<typeof schema> | PgliteDatabase<typeof schema>;

const GROUPED_LEVELS: LogLevel[] = ['error', 'fatal'];

export interface BackfillProjectResult {
  processedLogs: number;
  updatedLogs: number;
  touchedIncidents: number;
}

/**
 * Backfills incident fields for project logs in a time window.
 * Idempotent: repeated runs should not change already-correct rows.
 */
export async function backfillProjectIncidents(
  db: DatabaseClient,
  projectId: string,
  since: Date,
): Promise<BackfillProjectResult> {
  const logs = await db
    .select({
      id: log.id,
      level: log.level,
      message: log.message,
      timestamp: log.timestamp,
      sourceFile: log.sourceFile,
      lineNumber: log.lineNumber,
      resourceAttributes: log.resourceAttributes,
      metadata: log.metadata,
      incidentId: log.incidentId,
      fingerprint: log.fingerprint,
      serviceName: log.serviceName,
    })
    .from(log)
    .where(
      and(eq(log.projectId, projectId), gte(log.timestamp, since), inArray(log.level, GROUPED_LEVELS)),
    )
    .orderBy(log.timestamp);

  if (logs.length === 0) {
    return {
      processedLogs: 0,
      updatedLogs: 0,
      touchedIncidents: 0,
    };
  }

  return await (db as {
    transaction: <T>(fn: (tx: DatabaseClient) => Promise<T>) => Promise<T>;
  }).transaction(async (tx) => {
    const prepared = prepareLogsForIncidents(
      logs.map((entry) => ({
        level: entry.level,
        message: entry.message,
        timestamp: entry.timestamp as Date,
        sourceFile: entry.sourceFile,
        lineNumber: entry.lineNumber,
        resourceAttributes: entry.resourceAttributes,
        metadata: entry.metadata,
      })),
    );

    const aggregates = groupPreparedLogsByFingerprint(prepared);
    const fingerprints = aggregates.map((entry) => entry.fingerprint);
    const existingIncidents =
      fingerprints.length > 0
        ? await tx
            .select()
            .from(incident)
            .where(and(eq(incident.projectId, projectId), inArray(incident.fingerprint, fingerprints)))
        : [];

    const incidentByFingerprint = new Map<string, Incident>(
      existingIncidents.map((entry) => [entry.fingerprint, entry]),
    );
    const touchedIncidents: Incident[] = [...existingIncidents];

    for (const aggregate of aggregates) {
      if (incidentByFingerprint.has(aggregate.fingerprint)) continue;

      const now = new Date();
      const [created] = await tx
        .insert(incident)
        .values({
          id: nanoid(),
          projectId,
          fingerprint: aggregate.fingerprint,
          title: aggregate.title || buildIncidentTitle(aggregate.normalizedMessage),
          normalizedMessage: aggregate.normalizedMessage,
          serviceName: aggregate.serviceName,
          sourceFile: aggregate.sourceFile,
          lineNumber: aggregate.lineNumber,
          highestLevel: aggregate.highestLevel,
          firstSeen: aggregate.firstSeen,
          lastSeen: aggregate.lastSeen,
          totalEvents: aggregate.totalEvents,
          reopenCount: 0,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      incidentByFingerprint.set(aggregate.fingerprint, created);
      touchedIncidents.push(created);
    }
    const assigned = assignIncidentIds(prepared, incidentByFingerprint);

    let updatedLogs = 0;
    for (let i = 0; i < logs.length; i++) {
      const original = logs[i];
      const enriched = assigned[i];

      if (
        original.incidentId === enriched.incidentId &&
        original.fingerprint === enriched.fingerprint &&
        original.serviceName === enriched.serviceName
      ) {
        continue;
      }

      await tx
        .update(log)
        .set({
          incidentId: enriched.incidentId,
          fingerprint: enriched.fingerprint,
          serviceName: enriched.serviceName,
        })
        .where(eq(log.id, original.id));
      updatedLogs++;
    }

    return {
      processedLogs: logs.length,
      updatedLogs,
      touchedIncidents: touchedIncidents.length,
    };
  });
}
