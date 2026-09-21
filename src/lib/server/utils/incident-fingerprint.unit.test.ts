import { describe, expect, it } from "vite-plus/test";
import {
  buildIncidentFingerprint,
  buildIncidentFingerprintSeed,
  hashIncidentFingerprint,
  INCIDENT_FINGERPRINT_LENGTH,
  normalizeIncidentMessage,
} from "./incident-fingerprint";

describe("incident-fingerprint", () => {
  it("normalizes message in deterministic order", () => {
    const message =
      " ERROR User 123 from 192.168.10.20 hit tx 0xdeadbeefcafebabe and request 550e8400-e29b-41d4-a716-446655440000 ";

    const normalized = normalizeIncidentMessage(message);

    expect(normalized).toBe("error user {num} from {ip} hit tx {hex} and request {uuid}");
  });

  it("hashes seed into truncated sha256 hex", () => {
    const seed = buildIncidentFingerprintSeed({
      serviceName: "api",
      sourceFile: "auth.ts",
      lineNumber: 42,
      normalizedMessage: "database timeout after {num}ms",
    });

    const fingerprint = hashIncidentFingerprint(seed);

    expect(fingerprint).toHaveLength(INCIDENT_FINGERPRINT_LENGTH);
    expect(fingerprint).toMatch(/^[0-9a-f]+$/);
  });

  it("returns same fingerprint for same normalized template", () => {
    const first = buildIncidentFingerprint({
      message: "Database timeout after 1000ms for user 123",
      serviceName: "api",
      sourceFile: "db.ts",
      lineNumber: 88,
    });

    const second = buildIncidentFingerprint({
      message: "Database timeout after 2500ms for user 999",
      serviceName: "api",
      sourceFile: "db.ts",
      lineNumber: 88,
    });

    expect(first.normalizedMessage).toBe(second.normalizedMessage);
    expect(first.fingerprint).toBe(second.fingerprint);
  });

  it("masks every UUID version, so ids from any generator share one fingerprint", () => {
    const ids = {
      v1: "f47ac10b-58cc-1372-a567-0e02b2c3d479",
      v4: "550e8400-e29b-41d4-a716-446655440000",
      v6: "1e0d3b1f-9f2a-6b3c-8f4d-5a6b7c8d9e0f",
      v7: "01890a5d-ac96-774b-bcce-b302099a8057",
      v8: "a1b2c3d4-e5f6-8a7b-9c8d-7e6f5a4b3c2d",
    };

    for (const [version, id] of Object.entries(ids)) {
      expect(normalizeIncidentMessage(`Failed to load order ${id}`), version).toBe(
        "failed to load order {uuid}",
      );
    }

    const fingerprints = Object.values(ids).map(
      (id) =>
        buildIncidentFingerprint({
          message: `Failed to load order ${id}`,
          serviceName: "orders",
          sourceFile: "orders.ts",
          lineNumber: 12,
        }).fingerprint,
    );

    expect(new Set(fingerprints).size).toBe(1);
  });
});
