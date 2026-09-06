/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vite-plus/test";

function createMockSSEResponse(events: Array<{ event: string; data: string }>): Response {
  let eventIndex = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (eventIndex < events.length) {
        const event = events[eventIndex]!;
        controller.enqueue(
          new TextEncoder().encode(`event: ${event.event}\ndata: ${event.data}\n\n`),
        );
        eventIndex++;
      } else {
        controller.close();
      }
    },
  });
  return new Response(stream, { status: 200 });
}

describe("live-stream facades route through the core", () => {
  let fetchMock: MockInstance;
  let useLogStream: typeof import("../use-log-stream.svelte").useLogStream;
  let useIncidentStream: typeof import("../use-incident-stream.svelte").useIncidentStream;

  beforeEach(async () => {
    vi.resetModules();
    fetchMock = vi.spyOn(globalThis, "fetch");
    ({ useLogStream } = await import("../use-log-stream.svelte"));
    ({ useIncidentStream } = await import("../use-incident-stream.svelte"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("each facade hits its own endpoint and only its own event", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        createMockSSEResponse([
          { event: "logs", data: JSON.stringify([{ id: "log-1" }]) },
          { event: "incidents", data: JSON.stringify([{ id: "incident-1" }]) },
        ]),
      ),
    );

    const onLogs = vi.fn();
    const onIncidents = vi.fn();
    const logStream = useLogStream({ projectId: "p", enabled: true, onLogs });
    const incidentStream = useIncidentStream({ projectId: "p", enabled: true, onIncidents });

    await vi.waitFor(() => {
      expect(onLogs).toHaveBeenCalled();
      expect(onIncidents).toHaveBeenCalled();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p/logs/stream",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p/incidents/stream",
      expect.objectContaining({ method: "POST" }),
    );
    expect(onLogs).toHaveBeenCalledWith([expect.objectContaining({ id: "log-1" })]);
    expect(onLogs).not.toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "incident-1" })]),
    );
    expect(onIncidents).toHaveBeenCalledWith([expect.objectContaining({ id: "incident-1" })]);
    expect(onIncidents).not.toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "log-1" })]),
    );

    logStream.disconnect();
    incidentStream.disconnect();
  });
});
