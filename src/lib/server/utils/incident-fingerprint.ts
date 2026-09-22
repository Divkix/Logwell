import { createHash } from "node:crypto";

// Version nibble is deliberately permissive (RFC 9562 defines 1-8; nil uses 0) so that ids from
// any generator collapse to one template. The variant nibble is the real discriminator.
const UUID_REGEX = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

const HEX_ID_REGEX = /\b0x[0-9a-f]+\b|\b(?=[0-9a-f]*[a-f])[0-9a-f]{12,}\b/gi;

const IPV4_REGEX = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

const NUMBER_REGEX = /\d+/g;

const WHITESPACE_REGEX = /\s+/g;

export const INCIDENT_FINGERPRINT_LENGTH = 32;

export function normalizeIncidentMessage(message: string): string {
  const normalized = message
    .toLowerCase()
    .trim()
    .replace(UUID_REGEX, "{uuid}")
    .replace(HEX_ID_REGEX, "{hex}")
    .replace(IPV4_REGEX, "{ip}")
    .replace(NUMBER_REGEX, "{num}")
    .replace(WHITESPACE_REGEX, " ")
    .trim();

  return normalized || "unknown error";
}

export function buildIncidentFingerprintSeed(params: {
  serviceName: string | null;
  sourceFile: string | null;
  lineNumber: number | null;
  normalizedMessage: string;
}): string {
  const serviceName = params.serviceName ?? "unknown-service";
  const sourceFile = params.sourceFile ?? "unknown-source";
  const lineNumber = params.lineNumber ?? 0;

  return `${serviceName}|${sourceFile}|${lineNumber}|${params.normalizedMessage}`;
}

export function hashIncidentFingerprint(seed: string): string {
  return createHash("sha256").update(seed).digest("hex").slice(0, INCIDENT_FINGERPRINT_LENGTH);
}

export function buildIncidentFingerprint(params: {
  message: string;
  serviceName: string | null;
  sourceFile: string | null;
  lineNumber: number | null;
}) {
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
