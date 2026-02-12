import { createHash } from 'node:crypto';

/**
 * UUID matcher.
 */
const UUID_REGEX = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

/**
 * Hex identifier matcher.
 * Matches long hex chunks and 0x-prefixed values.
 */
const HEX_ID_REGEX = /\b0x[0-9a-f]+\b|\b[0-9a-f]{12,}\b/gi;

/**
 * IPv4 matcher.
 */
const IPV4_REGEX = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

/**
 * Numeric token matcher.
 */
const NUMBER_REGEX = /\d+/g;

/**
 * Whitespace collapse matcher.
 */
const WHITESPACE_REGEX = /\s+/g;

/**
 * Truncated fingerprint length.
 */
export const INCIDENT_FINGERPRINT_LENGTH = 32;

/**
 * Normalizes a log message for incident grouping.
 *
 * Order is intentionally fixed:
 * 1) lowercase + trim
 * 2) replace UUID
 * 3) replace hex IDs
 * 4) replace IPv4
 * 5) replace numeric tokens
 * 6) collapse whitespace
 */
export function normalizeIncidentMessage(message: string): string {
  const normalized = message
    .toLowerCase()
    .trim()
    .replace(UUID_REGEX, '{uuid}')
    .replace(HEX_ID_REGEX, '{hex}')
    .replace(IPV4_REGEX, '{ip}')
    .replace(NUMBER_REGEX, '{num}')
    .replace(WHITESPACE_REGEX, ' ')
    .trim();

  return normalized || 'unknown error';
}

/**
 * Builds the fingerprint seed using stable context.
 */
export function buildIncidentFingerprintSeed(params: {
  serviceName: string | null;
  sourceFile: string | null;
  lineNumber: number | null;
  normalizedMessage: string;
}): string {
  const serviceName = params.serviceName ?? 'unknown-service';
  const sourceFile = params.sourceFile ?? 'unknown-source';
  const lineNumber = params.lineNumber ?? 0;

  return `${serviceName}|${sourceFile}|${lineNumber}|${params.normalizedMessage}`;
}

/**
 * Returns a stable SHA-256 based fingerprint (truncated hex).
 */
export function hashIncidentFingerprint(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, INCIDENT_FINGERPRINT_LENGTH);
}

/**
 * Builds a stable incident fingerprint from message + source context.
 */
export function buildIncidentFingerprint(params: {
  message: string;
  serviceName: string | null;
  sourceFile: string | null;
  lineNumber: number | null;
}): { fingerprint: string; normalizedMessage: string; seed: string } {
  const normalizedMessage = normalizeIncidentMessage(params.message);
  const seed = buildIncidentFingerprintSeed({
    serviceName: params.serviceName,
    sourceFile: params.sourceFile,
    lineNumber: params.lineNumber,
    normalizedMessage,
  });
  const fingerprint = hashIncidentFingerprint(seed);

  return { fingerprint, normalizedMessage, seed };
}
