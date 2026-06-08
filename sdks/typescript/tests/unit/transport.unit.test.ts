import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { HttpTransport } from "../../src/transport";
import type { LogEntry } from "../../src/types";
import { createLogBatch } from "../fixtures/logs";

const endpoint = "https://test.logwell.io";
const apiKey = "test-api-key-placeholder";

function jsonResponse(accepted: number): Response {
  return new Response(JSON.stringify({ accepted }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function lastFetchInit(spy: ReturnType<typeof vi.spyOn>): RequestInit {
  const call = spy.mock.calls.at(-1);
  expect(call).toBeDefined();
  return call?.[1] as RequestInit;
}

describe("HttpTransport - conditional keepalive", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enables keepalive for small batches under the 64 KiB cap", async () => {
    const logs: LogEntry[] = createLogBatch(3);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(logs.length));

    const transport = new HttpTransport({ endpoint, apiKey, maxRetries: 0 });
    const result = await transport.send(logs);

    expect(result.accepted).toBe(logs.length);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(lastFetchInit(fetchSpy).keepalive).toBe(true);
  });

  it("disables keepalive for large batches over the 64 KiB cap and still resolves", async () => {
    // ~50 entries with a long message/metadata each pushes the JSON well past 60 KB.
    const logs: LogEntry[] = createLogBatch(50, {
      message: "x".repeat(2000),
      metadata: { detail: "y".repeat(500) },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(logs.length));

    // Guard the precondition: the serialized payload must exceed the cap.
    expect(new TextEncoder().encode(JSON.stringify(logs)).length).toBeGreaterThan(60_000);

    const transport = new HttpTransport({ endpoint, apiKey, maxRetries: 0 });
    const result = await transport.send(logs);

    expect(result.accepted).toBe(logs.length);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(lastFetchInit(fetchSpy).keepalive).toBe(false);
  });
});
