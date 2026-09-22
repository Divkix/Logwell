import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { DatabaseClient } from "../db/db";
import { type IncidentStatus, isIncidentGroupedLevel, maxIncidentLevel } from "../../shared/types";
import { INCIDENT_CONFIG } from "../config/performance";
import { type Incident, incident, type LogLevel } from "../db/schema";
import { jsonObjectSchema, type JsonObject, type JsonValue } from "../../shared/schemas/json";
import { buildIncidentFingerprint } from "./incident-fingerprint";

export interface IncidentLogInput {
  level: LogLevel;
  message: string;
  timestamp: Date;
  sourceFile: string | null;
  lineNumber: number | null;
  resourceAttributes: JsonValue;
  metadata: JsonValue;
}

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

export interface IncidentUpsertResult {
  incidentByFingerprint: Map<string, Incident>;
  touchedIncidents: Incident[];
}

function asRecord(value: JsonValue): JsonObject | null {
  const decoded = jsonObjectSchema.safeParse(value);

  return decoded.success ? decoded.data : null;
}

function stringField(record: JsonObject | null, keys: string[]): string | null {
  if (!record) return null;

  for (const key of keys) {
    const decoded = z.string().safeParse(record[key]);

    if (decoded.success && decoded.data.trim()) {
      return decoded.data.trim();
    }
  }

  return null;
}

export function extractServiceName(
  resourceAttributes: JsonValue,
  metadata: JsonValue,
): string | null {
  const resource = asRecord(resourceAttributes);
  const meta = asRecord(metadata);

  return (
    stringField(resource, ["service.name", "service_name", "service"]) ??
    stringField(meta, ["service.name", "service_name", "service"]) ??
    null
  );
}

export function buildIncidentTitle(message: string): string {
  const trimmed = message.trim();

  if (!trimmed) return "Unknown error";

  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
}

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

  // Sorted so the multi-row upsert that consumes these aggregates takes its row
  // locks in a deterministic order. Postgres locks rows in VALUES order, so two
  // concurrent batches sharing fingerprints would otherwise deadlock (40P01)
  // and the losing batch would fail with a 500.
  return [...groups.values()].sort((a, b) =>
    a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0,
  );
}

export function getIncidentStatus(
  lastSeen: Date,
  now: Date = new Date(),
  autoResolveMinutes: number = INCIDENT_CONFIG.AUTO_RESOLVE_MINUTES,
): IncidentStatus {
  const thresholdMs = autoResolveMinutes * 60 * 1000;

  return now.getTime() - lastSeen.getTime() <= thresholdMs ? "open" : "resolved";
}

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

  const incidentByFingerprint = new Map<string, Incident>();
  const touchedIncidents: Incident[] = [];

  const now = new Date();

  const rows = await db
    .insert(incident)
    .values(
      aggregates.map((aggregate) => ({
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
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [incident.projectId, incident.fingerprint],
      set: {
        highestLevel: sql`(
            CASE
              WHEN ${incident.highestLevel}::text = 'fatal' OR excluded.highest_level::text = 'fatal'
                THEN 'fatal'
              ELSE 'error'
            END
          )::log_level`,
        firstSeen: sql`LEAST(${incident.firstSeen}, excluded.first_seen)`,
        lastSeen: sql`GREATEST(${incident.lastSeen}, excluded.last_seen)`,
        totalEvents: sql`${incident.totalEvents} + excluded.total_events`,
        updatedAt: now,
      },
    })
    .returning();

  for (const row of rows) {
    incidentByFingerprint.set(row.fingerprint, row);
    touchedIncidents.push(row);
  }

  return { incidentByFingerprint, touchedIncidents };
}

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
