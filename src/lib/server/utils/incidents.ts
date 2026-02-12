import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { INCIDENT_CONFIG } from '../config';
import { incident, type Incident, type LogLevel } from '../db/schema';
import {
  isIncidentGroupedLevel,
  maxIncidentLevel,
  type IncidentStatus,
} from '../../shared/types';
import { buildIncidentFingerprint } from './incident-fingerprint';
import type * as schema from '../db/schema';

type DatabaseClient = PostgresJsDatabase<typeof schema> | PgliteDatabase<typeof schema>;

/**
 * Log input shape needed for incident grouping.
 */
export interface IncidentLogInput {
  level: LogLevel;
  message: string;
  timestamp: Date;
  sourceFile: string | null;
  lineNumber: number | null;
  resourceAttributes: unknown;
  metadata: unknown;
}

/**
 * Log input enriched with incident fields.
 */
export interface PreparedIncidentLog extends IncidentLogInput {
  serviceName: string | null;
  fingerprint: string | null;
  normalizedMessage: string | null;
  incidentTitle: string | null;
  incidentId: string | null;
}

interface IncidentAggregate {
  fingerprint: string;
  title: string;
  normalizedMessage: string;
  serviceName: string | null;
  sourceFile: string | null;
  lineNumber: number | null;
  highestLevel: LogLevel;
  firstSeen: Date;
  lastSeen: Date;
  totalEvents: number;
}

/**
 * Result of incident upsert batch.
 */
export interface IncidentUpsertResult {
  incidentByFingerprint: Map<string, Incident>;
  touchedIncidents: Incident[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

/**
 * Extracts service name from OTLP resource attributes or simple-ingest metadata.
 */
export function extractServiceName(resourceAttributes: unknown, metadata: unknown): string | null {
  const resource = asRecord(resourceAttributes);
  const meta = asRecord(metadata);

  return (
    stringField(resource, ['service.name', 'service_name', 'service']) ??
    stringField(meta, ['service.name', 'service_name', 'service']) ??
    null
  );
}

/**
 * Converts a raw message into a concise incident title.
 */
export function buildIncidentTitle(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return 'Unknown error';
  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
}

/**
 * Enriches logs with incident fields. Non-error logs keep null incident fields.
 */
export function prepareLogsForIncidents(logs: IncidentLogInput[]): PreparedIncidentLog[] {
  return logs.map((log) => {
    if (!isIncidentGroupedLevel(log.level)) {
      return {
        ...log,
        serviceName: extractServiceName(log.resourceAttributes, log.metadata),
        fingerprint: null,
        normalizedMessage: null,
        incidentTitle: null,
        incidentId: null,
      };
    }

    const serviceName = extractServiceName(log.resourceAttributes, log.metadata);
    const { fingerprint, normalizedMessage } = buildIncidentFingerprint({
      message: log.message,
      serviceName,
      sourceFile: log.sourceFile,
      lineNumber: log.lineNumber,
    });

    return {
      ...log,
      serviceName,
      fingerprint,
      normalizedMessage,
      incidentTitle: buildIncidentTitle(log.message),
      incidentId: null,
    };
  });
}

/**
 * Groups prepared logs by fingerprint for batch incident upsert.
 */
export function groupPreparedLogsByFingerprint(logs: PreparedIncidentLog[]): IncidentAggregate[] {
  const groups = new Map<string, IncidentAggregate>();

  for (const log of logs) {
    if (!log.fingerprint || !log.normalizedMessage) continue;

    const existing = groups.get(log.fingerprint);
    if (!existing) {
      groups.set(log.fingerprint, {
        fingerprint: log.fingerprint,
        title: log.incidentTitle ?? buildIncidentTitle(log.message),
        normalizedMessage: log.normalizedMessage,
        serviceName: log.serviceName,
        sourceFile: log.sourceFile,
        lineNumber: log.lineNumber,
        highestLevel: log.level,
        firstSeen: log.timestamp,
        lastSeen: log.timestamp,
        totalEvents: 1,
      });
      continue;
    }

    existing.highestLevel = maxIncidentLevel(existing.highestLevel, log.level);
    if (log.timestamp < existing.firstSeen) {
      existing.firstSeen = log.timestamp;
    }
    if (log.timestamp > existing.lastSeen) {
      existing.lastSeen = log.timestamp;
    }
    existing.totalEvents += 1;
  }

  return [...groups.values()];
}

/**
 * Returns incident status using auto-resolve threshold.
 */
export function getIncidentStatus(
  lastSeen: Date,
  now: Date = new Date(),
  autoResolveMinutes: number = INCIDENT_CONFIG.AUTO_RESOLVE_MINUTES,
): IncidentStatus {
  const thresholdMs = autoResolveMinutes * 60 * 1000;
  return now.getTime() - lastSeen.getTime() <= thresholdMs ? 'open' : 'resolved';
}

/**
 * Returns true when the incoming event should reopen an incident.
 */
export function isIncidentReopened(
  lastSeen: Date,
  newFirstSeen: Date,
  autoResolveMinutes: number = INCIDENT_CONFIG.AUTO_RESOLVE_MINUTES,
): boolean {
  const thresholdMs = autoResolveMinutes * 60 * 1000;
  return newFirstSeen.getTime() - lastSeen.getTime() > thresholdMs;
}

/**
 * Batch-upserts incidents and returns touched incident rows.
 */
export async function upsertIncidentsForPreparedLogs(
  db: DatabaseClient,
  projectId: string,
  logs: PreparedIncidentLog[],
): Promise<IncidentUpsertResult> {
  const aggregates = groupPreparedLogsByFingerprint(logs);
  if (aggregates.length === 0) {
    return {
      incidentByFingerprint: new Map(),
      touchedIncidents: [],
    };
  }

  const fingerprints = aggregates.map((a) => a.fingerprint);
  const existingRows = await db
    .select()
    .from(incident)
    .where(and(eq(incident.projectId, projectId), inArray(incident.fingerprint, fingerprints)));

  const existingByFingerprint = new Map(existingRows.map((row) => [row.fingerprint, row]));
  const incidentByFingerprint = new Map<string, Incident>();
  const touchedIncidents: Incident[] = [];

  for (const aggregate of aggregates) {
    const existing = existingByFingerprint.get(aggregate.fingerprint);
    if (!existing) {
      const now = new Date();
      const [created] = await db
        .insert(incident)
        .values({
          id: nanoid(),
          projectId,
          fingerprint: aggregate.fingerprint,
          title: aggregate.title,
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
      continue;
    }

    const shouldReopen = isIncidentReopened(existing.lastSeen as Date, aggregate.firstSeen);
    const [updated] = await db
      .update(incident)
      .set({
        highestLevel: maxIncidentLevel(existing.highestLevel, aggregate.highestLevel),
        lastSeen: aggregate.lastSeen > (existing.lastSeen as Date) ? aggregate.lastSeen : existing.lastSeen,
        totalEvents: existing.totalEvents + aggregate.totalEvents,
        reopenCount: existing.reopenCount + (shouldReopen ? 1 : 0),
        updatedAt: new Date(),
      })
      .where(eq(incident.id, existing.id))
      .returning();

    incidentByFingerprint.set(aggregate.fingerprint, updated);
    touchedIncidents.push(updated);
  }

  return { incidentByFingerprint, touchedIncidents };
}

/**
 * Assigns incident ids to prepared logs from fingerprint mapping.
 */
export function assignIncidentIds(
  logs: PreparedIncidentLog[],
  incidentByFingerprint: Map<string, Incident>,
): PreparedIncidentLog[] {
  return logs.map((log) => {
    if (!log.fingerprint) return log;
    const matched = incidentByFingerprint.get(log.fingerprint);
    if (!matched) return log;
    return {
      ...log,
      incidentId: matched.id,
    };
  });
}
