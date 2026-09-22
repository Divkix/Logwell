import { and, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { INCIDENT_GROUPED_LEVELS } from "../../shared/schemas/incident";
import type { JsonValue } from "../../shared/schemas/json";
import type { DatabaseClient } from "../db/db";
import { type Incident, incident, type LogLevel, log } from "../db/schema";
import { cursorRowGreaterThan, microsColumn } from "./cursor";
import {
  assignIncidentIds,
  buildIncidentTitle,
  groupPreparedLogsByFingerprint,
  prepareLogsForIncidents,
} from "./incidents";

export interface BackfillProjectResult {
  processedLogs: number;
  updatedLogs: number;
  touchedIncidents: number;
}

// Logs are paged by keyset and written one batch per transaction, so a large window neither
// materializes in memory nor holds row locks for the whole run. Every list handed to a
// statement is derived from a single batch, which keeps bind parameters far below the
// 65535-parameter protocol limit (13 per incident row, 4 per log update).
const LOG_BATCH_SIZE = 1000;

interface BackfillLog {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: Date;
  sourceFile: string | null;
  lineNumber: number | null;
  resourceAttributes: unknown;
  metadata: unknown;
  incidentId: string | null;
  fingerprint: string | null;
  serviceName: string | null;
}

export async function backfillProjectIncidents(
  db: DatabaseClient,
  projectId: string,
  since: Date,
): Promise<BackfillProjectResult> {
  const touchedIncidentIds = new Set<string>();
  let processedLogs = 0;
  let updatedLogs = 0;
  // Exact microseconds, not the driver's millisecond Date: a truncated cursor stays inside the
  // millisecond it came from, so the rows after it are re-read forever and the loop never ends.
  let cursor: { micros: string; id: string } | null = null;

  for (;;) {
    const batch = await db
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
        micros: microsColumn(log.timestamp),
      })
      .from(log)
      .where(
        and(
          eq(log.projectId, projectId),
          gte(log.timestamp, since),
          inArray(log.level, [...INCIDENT_GROUPED_LEVELS]),
          cursor
            ? cursorRowGreaterThan(log.timestamp, log.id, cursor.micros, cursor.id)
            : undefined,
        ),
      )
      .orderBy(log.timestamp, log.id)
      .limit(LOG_BATCH_SIZE);

    const last = batch.at(-1);

    if (!last) break;

    cursor = { micros: last.micros, id: last.id };
    processedLogs += batch.length;

    const result = await backfillBatch(db, projectId, batch);
    updatedLogs += result.updatedLogs;

    for (const id of result.touchedIncidentIds) {
      touchedIncidentIds.add(id);
    }
  }

  return {
    processedLogs,
    updatedLogs,
    touchedIncidents: touchedIncidentIds.size,
  };
}

async function backfillBatch(
  db: DatabaseClient,
  projectId: string,
  logs: BackfillLog[],
): Promise<{ updatedLogs: number; touchedIncidentIds: string[] }> {
  return await db.transaction(async (tx) => {
    // Concurrent backfill runs touch the same incident and log rows; without serializing them
    // per project they interleave their lock acquisition (incident locks, then log locks, then
    // incident locks again) and Postgres kills one with a 40P01 deadlock.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`);

    // SAFETY: the backfill reads only jsonb columns the ingest path wrote from decoded
    // request JSON, so both values are in the JSON domain drizzle types as unknown.
    const prepared = prepareLogsForIncidents(
      logs.map((entry) => ({
        level: entry.level,
        message: entry.message,
        timestamp: entry.timestamp,
        sourceFile: entry.sourceFile,
        lineNumber: entry.lineNumber,
        resourceAttributes: entry.resourceAttributes as JsonValue,
        metadata: entry.metadata as JsonValue,
      })),
    );

    const aggregates = groupPreparedLogsByFingerprint(prepared);
    const fingerprints = aggregates.map((entry) => entry.fingerprint);

    const existingIncidents =
      fingerprints.length > 0
        ? await tx
            .select()
            .from(incident)
            .where(
              and(eq(incident.projectId, projectId), inArray(incident.fingerprint, fingerprints)),
            )
        : [];

    const incidentByFingerprint = new Map<string, Incident>(
      existingIncidents.map((entry) => [entry.fingerprint, entry]),
    );

    const touchedIncidents: Incident[] = [...existingIncidents];

    const missing = aggregates.filter(
      (aggregate) => !incidentByFingerprint.has(aggregate.fingerprint),
    );

    if (missing.length > 0) {
      const now = new Date();

      const created = await tx
        .insert(incident)
        .values(
          missing.map((aggregate) => ({
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
            createdAt: now,
            updatedAt: now,
          })),
        )
        // A concurrent ingest or a second backfill can create the same fingerprint between the
        // read above and this insert. Adopt that row rather than aborting the transaction; the
        // no-op assignment only exists so the conflicting row is returned, and every counter is
        // recomputed from the log rows below.
        .onConflictDoUpdate({
          target: [incident.projectId, incident.fingerprint],
          set: { fingerprint: sql`excluded.fingerprint` },
        })
        .returning();

      for (const row of created) {
        incidentByFingerprint.set(row.fingerprint, row);
        touchedIncidents.push(row);
      }
    }

    const assigned = assignIncidentIds(prepared, incidentByFingerprint);

    const updates: SQL[] = [];

    for (let i = 0; i < logs.length; i++) {
      const original = logs[i]!;
      const enriched = assigned[i]!;

      if (
        original.incidentId === enriched.incidentId &&
        original.fingerprint === enriched.fingerprint &&
        original.serviceName === enriched.serviceName
      ) {
        continue;
      }

      updates.push(
        sql`(${original.id}, ${enriched.incidentId}, ${enriched.fingerprint}, ${enriched.serviceName})`,
      );
    }

    if (updates.length > 0) {
      await tx.execute(sql`
        UPDATE ${log} AS target
        SET incident_id = source.incident_id,
            fingerprint = source.fingerprint,
            service_name = source.service_name
        FROM (VALUES ${sql.join(updates, sql`, `)})
          AS source(id, incident_id, fingerprint, service_name)
        WHERE target.id = source.id
      `);
    }

    // Sorted by fingerprint so the recompute takes its row locks in the same order as the
    // upsert above and as the ingest path, which is what keeps concurrent writers from
    // deadlocking on the incident rows.
    const touchedIncidentIds = [...touchedIncidents]
      .sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0))
      .map((entry) => entry.id);

    for (const incidentId of touchedIncidentIds) {
      const [stats] = await tx
        .select({
          firstSeen: sql<string>`MIN(${log.timestamp})`,
          lastSeen: sql<string>`MAX(${log.timestamp})`,
          totalEvents: sql<number>`COUNT(*)`,
          highestLevel: sql<LogLevel>`(ARRAY['debug','info','warn','error','fatal'])[MAX(
            CASE ${log.level}
              WHEN 'debug' THEN 1
              WHEN 'info' THEN 2
              WHEN 'warn' THEN 3
              WHEN 'error' THEN 4
              WHEN 'fatal' THEN 5
              ELSE 0
            END
          )]`,
        })
        .from(log)
        .where(eq(log.incidentId, incidentId));

      if (stats && stats.firstSeen && stats.lastSeen) {
        await tx
          .update(incident)
          .set({
            firstSeen: new Date(stats.firstSeen),
            lastSeen: new Date(stats.lastSeen),
            totalEvents: Number(stats.totalEvents),
            highestLevel: stats.highestLevel,
            updatedAt: new Date(),
          })
          .where(eq(incident.id, incidentId));
      }
    }

    return {
      updatedLogs: updates.length,
      touchedIncidentIds,
    };
  });
}
