import { describe, expect, it } from "vite-plus/test";
import type { Incident } from "./db/schema";
import { logEventBus, type StreamLog } from "./events";

function mockLog(projectId: string, message: string): StreamLog {
  // SAFETY: emitLog routes on projectId and the assertions below read only message; the
  // remaining Log fields (id, level, timestamp, …) are never touched in this file.
  return { projectId, message } as StreamLog;
}

function mockIncident(projectId: string, fingerprint: string): Incident {
  // SAFETY: emitIncident routes on projectId and the assertions below read only fingerprint;
  // the remaining Incident fields (id, title, firstSeen, …) are never touched in this file.
  return { projectId, fingerprint } as Incident;
}

describe("logEventBus channels", () => {
  it("routes log and incident emits through isolated project-scoped channels", () => {
    logEventBus.clear();

    const logs: StreamLog[] = [];
    const incidents: Incident[] = [];
    const unsubLog = logEventBus.onLog("p1", (log) => logs.push(log));
    const unsubIncident = logEventBus.onIncident("p1", (incident) => incidents.push(incident));

    logEventBus.emitLog(mockLog("p1", "a"));
    logEventBus.emitIncident(mockIncident("p1", "f1"));
    logEventBus.emitLog(mockLog("other", "b"));

    expect(logs.map((l) => l.message)).toEqual(["a"]);
    expect(incidents.map((i) => i.fingerprint)).toEqual(["f1"]);
    expect(logEventBus.getListenerCount("p1")).toBe(1);
    expect(logEventBus.getIncidentListenerCount("p1")).toBe(1);

    unsubLog();
    unsubIncident();
    expect(logEventBus.getListenerCount("p1")).toBe(0);
    expect(logEventBus.getIncidentListenerCount("p1")).toBe(0);
  });

  it("clear() drains both channels at once", () => {
    logEventBus.onLog("p1", () => {});
    logEventBus.onIncident("p1", () => {});
    logEventBus.clear();
    expect(logEventBus.getListenerCount("p1")).toBe(0);
    expect(logEventBus.getIncidentListenerCount("p1")).toBe(0);
  });
});
