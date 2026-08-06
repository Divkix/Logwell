import { describe, expect, it } from "vite-plus/test";
import type { Log } from "$lib/server/db/schema";
import { sortLogs } from "./log-sort";

function createLog(overrides: Partial<Log> = {}): Log {
  return {
    id: "log_123",
    projectId: "proj_456",
    incidentId: null,
    fingerprint: null,
    serviceName: null,
    level: "info",
    message: "Test log message",
    metadata: null,
    timeUnixNano: null,
    observedTimeUnixNano: null,
    severityNumber: null,
    severityText: null,
    body: null,
    droppedAttributesCount: null,
    flags: null,
    traceId: null,
    spanId: null,
    resourceAttributes: null,
    resourceDroppedAttributesCount: null,
    resourceSchemaUrl: null,
    scopeName: null,
    scopeVersion: null,
    scopeAttributes: null,
    scopeDroppedAttributesCount: null,
    scopeSchemaUrl: null,
    sourceFile: null,
    lineNumber: null,
    requestId: null,
    userId: null,
    ipAddress: null,
    timestamp: new Date("2024-01-15T14:30:45.123Z"),
    search: "",
    ...overrides,
  };
}

const sampleLogs: Log[] = [
  createLog({
    id: "log_1",
    message: "Beta message",
    level: "error",
    timestamp: new Date("2024-01-15T14:30:00.000Z"),
  }),
  createLog({
    id: "log_2",
    message: "Alpha message",
    level: "debug",
    timestamp: new Date("2024-01-15T14:32:00.000Z"),
  }),
  createLog({
    id: "log_3",
    message: "Charlie message",
    level: "warn",
    timestamp: new Date("2024-01-15T14:31:00.000Z"),
  }),
];

describe("sortLogs", () => {
  it("returns the original array when no sort is active", () => {
    const result = sortLogs(sampleLogs, null, null);
    expect(result).toBe(sampleLogs);
  });

  it("returns the original array when direction is null", () => {
    const result = sortLogs(sampleLogs, "timestamp", null);
    expect(result).toBe(sampleLogs);
  });

  it("sorts by timestamp ascending", () => {
    const result = sortLogs(sampleLogs, "timestamp", "asc");
    expect(result.map((l) => l.id)).toEqual(["log_1", "log_3", "log_2"]);
  });

  it("sorts by timestamp descending", () => {
    const result = sortLogs(sampleLogs, "timestamp", "desc");
    expect(result.map((l) => l.id)).toEqual(["log_2", "log_3", "log_1"]);
  });

  it("sorts by level severity ascending (debug < warn < error)", () => {
    const result = sortLogs(sampleLogs, "level", "asc");
    expect(result.map((l) => l.id)).toEqual(["log_2", "log_3", "log_1"]);
  });

  it("sorts by level severity descending (error > warn > debug)", () => {
    const result = sortLogs(sampleLogs, "level", "desc");
    expect(result.map((l) => l.id)).toEqual(["log_1", "log_3", "log_2"]);
  });

  it("sorts by message alphabetically ascending", () => {
    const result = sortLogs(sampleLogs, "message", "asc");
    expect(result.map((l) => l.id)).toEqual(["log_2", "log_1", "log_3"]);
  });

  it("sorts by message alphabetically descending", () => {
    const result = sortLogs(sampleLogs, "message", "desc");
    expect(result.map((l) => l.id)).toEqual(["log_3", "log_1", "log_2"]);
  });

  it("does not mutate the input array", () => {
    const original = sampleLogs.map((l) => l.id);
    sortLogs(sampleLogs, "message", "desc");
    expect(sampleLogs.map((l) => l.id)).toEqual(original);
  });
});
