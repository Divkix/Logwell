import { z } from 'zod';
import { LOG_LEVELS, type LogLevel } from './log';

/**
 * Valid incident status values.
 */
export const INCIDENT_STATUSES = ['open', 'resolved'] as const;

/**
 * Incident status schema.
 */
export const incidentStatusSchema = z.enum(INCIDENT_STATUSES);

/**
 * Incident status type.
 */
export type IncidentStatus = z.infer<typeof incidentStatusSchema>;

/**
 * Supported incident range filters.
 */
export const INCIDENT_RANGES = ['15m', '1h', '24h', '7d'] as const;

/**
 * Incident range schema.
 */
export const incidentRangeSchema = z.enum(INCIDENT_RANGES);

/**
 * Incident range type.
 */
export type IncidentRange = z.infer<typeof incidentRangeSchema>;

/**
 * Summary item returned by incident list endpoints.
 */
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
  reopenCount: number;
  status: IncidentStatus;
}

/**
 * Source location frequency used to identify likely root cause.
 */
export interface IncidentSourceFrequency {
  sourceFile: string | null;
  lineNumber: number | null;
  count: number;
}

/**
 * Correlated request / trace summary.
 */
export interface IncidentCorrelationSummary {
  topRequestIds: Array<{ requestId: string; count: number }>;
  topTraceIds: Array<{ traceId: string; count: number }>;
}

/**
 * Incident detail payload.
 */
export interface IncidentDetail extends IncidentListItem {
  rootCauseCandidates: IncidentSourceFrequency[];
  correlations: IncidentCorrelationSummary;
}

/**
 * Incident timeline point.
 */
export interface IncidentTimelinePoint {
  timestamp: string;
  count: number;
}

/**
 * Incident timeline payload.
 */
export interface IncidentTimelineResponse {
  incidentId: string;
  range: IncidentRange;
  buckets: IncidentTimelinePoint[];
  peakBucket: IncidentTimelinePoint | null;
}

/**
 * Valid log levels that are eligible for incident grouping.
 */
export const INCIDENT_GROUPED_LEVELS: readonly LogLevel[] = ['error', 'fatal'] as const;

/**
 * Type guard for grouped levels.
 */
export function isIncidentGroupedLevel(level: string): level is (typeof INCIDENT_GROUPED_LEVELS)[number] {
  return (INCIDENT_GROUPED_LEVELS as readonly string[]).includes(level);
}

/**
 * Highest-level ranking helper for incident aggregation.
 */
const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

/**
 * Returns the higher-severity level between two values.
 */
export function maxIncidentLevel(a: LogLevel, b: LogLevel): LogLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

// Preserve runtime reference to LOG_LEVELS so bundlers keep a single source of truth.
void LOG_LEVELS;
