import { describe, expect, it } from "vite-plus/test";
import { groupPreparedLogsByFingerprint, type PreparedIncidentLog } from "./incidents";

function prepared(
  fingerprint: string,
  timestamp: Date,
  level: "error" | "fatal" = "error",
): PreparedIncidentLog {
  return {
    level,
    message: `message ${fingerprint}`,
    timestamp,
    sourceFile: null,
    lineNumber: null,
    resourceAttributes: null,
    metadata: null,
    serviceName: "svc",
    fingerprint,
    normalizedMessage: `message ${fingerprint}`,
    incidentTitle: `message ${fingerprint}`,
    incidentId: null,
  };
}

describe("groupPreparedLogsByFingerprint", () => {
  it("returns aggregates in fingerprint order regardless of input order", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");

    const aggregates = groupPreparedLogsByFingerprint([
      prepared("fp-c", now),
      prepared("fp-a", now),
      prepared("fp-b", now),
      prepared("fp-a", new Date(now.getTime() + 1000)),
    ]);

    expect(aggregates.map((entry) => entry.fingerprint)).toEqual(["fp-a", "fp-b", "fp-c"]);
  });

  it("aggregates repeated fingerprints into one entry with the widest level and time span", () => {
    const base = new Date("2026-01-01T00:00:00.000Z");

    const [aggregate] = groupPreparedLogsByFingerprint([
      prepared("fp-x", new Date(base.getTime() + 5000), "error"),
      prepared("fp-x", base, "fatal"),
      prepared("fp-x", new Date(base.getTime() + 9000), "error"),
    ]);

    expect(aggregate?.totalEvents).toBe(3);
    expect(aggregate?.highestLevel).toBe("fatal");
    expect(aggregate?.firstSeen).toEqual(base);
    expect(aggregate?.lastSeen).toEqual(new Date(base.getTime() + 9000));
  });
});
