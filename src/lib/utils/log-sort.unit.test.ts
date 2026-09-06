import { describe, expect, it } from "vite-plus/test";
import type { Log } from "$lib/server/db/schema";
import { sortLogs, type SortDirection, type SortField } from "./log-sort";

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
  it.each([
    [null, null],
    ["timestamp", null],
  ] as [SortField | null, SortDirection][])(
    "returns the original array when sort is inactive (%s, %s)",
    (key, dir) => {
      expect(sortLogs(sampleLogs, key, dir)).toBe(sampleLogs);
    },
  );

  it.each([
    ["timestamp", "asc", ["log_1", "log_3", "log_2"]],
    ["timestamp", "desc", ["log_2", "log_3", "log_1"]],
    ["level", "asc", ["log_2", "log_3", "log_1"]],
    ["level", "desc", ["log_1", "log_3", "log_2"]],
    ["message", "asc", ["log_2", "log_1", "log_3"]],
    ["message", "desc", ["log_3", "log_1", "log_2"]],
  ])("sorts by %s %s", (key, dir, expected) => {
    expect(
      sortLogs(sampleLogs, key as SortField, dir as Exclude<SortDirection, null>).map((l) => l.id),
    ).toEqual(expected as string[]);
  });

  it("does not mutate the input array", () => {
    const original = sampleLogs.map((l) => l.id);
    sortLogs(sampleLogs, "message", "desc");
    expect(sampleLogs.map((l) => l.id)).toEqual(original);
  });
});
