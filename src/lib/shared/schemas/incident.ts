import { z } from "zod";
import type { LogLevel } from "./log";

export const INCIDENT_STATUSES = ["open", "resolved"] as const;

const incidentStatusSchema = z.enum(INCIDENT_STATUSES);

export type IncidentStatus = z.infer<typeof incidentStatusSchema>;

export const INCIDENT_RANGES = ["15m", "1h", "24h", "7d"] as const;

const incidentRangeSchema = z.enum(INCIDENT_RANGES);

export type IncidentRange = z.infer<typeof incidentRangeSchema>;

export interface IncidentListItem {
  id: string;
  projectId: string;
  fingerprint: string;
  title: string;
  normalizedMessage: string;
  serviceName: string | null;
  sourceFile: string | null;
  lineNumber: number | null;
  highestLevel: LogLevel;
  firstSeen: string;
  lastSeen: string;
  totalEvents: number;
  status: IncidentStatus;
}

interface IncidentSourceFrequency {
  sourceFile: string | null;
  lineNumber: number | null;
  count: number;
}

interface IncidentCorrelationSummary {
  topRequestIds: Array<{ requestId: string; count: number }>;
  topTraceIds: Array<{ traceId: string; count: number }>;
}

export interface IncidentDetail extends IncidentListItem {
  rootCauseCandidates: IncidentSourceFrequency[];
  correlations: IncidentCorrelationSummary;
}

interface IncidentTimelinePoint {
  timestamp: string;
  count: number;
}

export interface IncidentTimelineResponse {
  incidentId: string;
  range: IncidentRange;
  buckets: IncidentTimelinePoint[];
  peakBucket: IncidentTimelinePoint | null;
}

export const INCIDENT_GROUPED_LEVELS: readonly LogLevel[] = ["error", "fatal"] as const;

export function isIncidentGroupedLevel(
  level: string,
): level is (typeof INCIDENT_GROUPED_LEVELS)[number] {
  return (INCIDENT_GROUPED_LEVELS as readonly string[]).includes(level);
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

export function maxIncidentLevel(a: LogLevel, b: LogLevel): LogLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}
