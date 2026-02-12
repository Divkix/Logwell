import { describe, expect, it } from 'vitest';
import {
  buildIncidentFingerprint,
  buildIncidentFingerprintSeed,
  hashIncidentFingerprint,
  INCIDENT_FINGERPRINT_LENGTH,
  normalizeIncidentMessage,
} from './incident-fingerprint';

describe('incident-fingerprint', () => {
  it('normalizes message in deterministic order', () => {
    const message =
      ' ERROR User 123 from 192.168.10.20 hit tx 0xdeadbeefcafebabe and request 550e8400-e29b-41d4-a716-446655440000 ';
    const normalized = normalizeIncidentMessage(message);

    expect(normalized).toBe(
      'error user {num} from {ip} hit tx {hex} and request {uuid}',
    );
  });

  it('hashes seed into truncated sha256 hex', () => {
    const seed = buildIncidentFingerprintSeed({
      serviceName: 'api',
      sourceFile: 'auth.ts',
      lineNumber: 42,
      normalizedMessage: 'database timeout after {num}ms',
    });
    const fingerprint = hashIncidentFingerprint(seed);

    expect(fingerprint).toHaveLength(INCIDENT_FINGERPRINT_LENGTH);
    expect(fingerprint).toMatch(/^[0-9a-f]+$/);
  });

  it('returns same fingerprint for same normalized template', () => {
    const first = buildIncidentFingerprint({
      message: 'Database timeout after 1000ms for user 123',
      serviceName: 'api',
      sourceFile: 'db.ts',
      lineNumber: 88,
    });

    const second = buildIncidentFingerprint({
      message: 'Database timeout after 2500ms for user 999',
      serviceName: 'api',
      sourceFile: 'db.ts',
      lineNumber: 88,
    });

    expect(first.normalizedMessage).toBe(second.normalizedMessage);
    expect(first.fingerprint).toBe(second.fingerprint);
  });
});
