import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { HttpTransport } from "../../src/transport";
import type { LogEntry } from "../../src/types";
import { createLogBatch, createLogFixture } from "../fixtures/logs";

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

describe("HttpTransport - serialization failures", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps a serialization failure (BigInt) to non-retryable VALIDATION_ERROR", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const logs: LogEntry[] = [
      { level: "info", message: "BigInt in metadata", metadata: { count: 1n } },
    ];
    const transport = new HttpTransport({ endpoint, apiKey, maxRetries: 3 });

    const sendPromise = transport.send(logs);

    await expect(sendPromise).rejects.toMatchObject({
      message: expect.stringContaining("Failed to serialize payload"),
      code: "VALIDATION_ERROR",
      statusCode: 400,
      retryable: false,
    });
    // Never reached the network.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("HttpTransport - 4xx mapping", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps 403 to non-retryable VALIDATION_ERROR without retrying", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "forbidden", message: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const transport = new HttpTransport({ endpoint, apiKey, maxRetries: 2 });

    await expect(transport.send([createLogFixture()])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 403,
      retryable: false,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("maps 422 to non-retryable VALIDATION_ERROR", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "unprocessable", message: "Unprocessable" }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const transport = new HttpTransport({ endpoint, apiKey, maxRetries: 2 });

    await expect(transport.send([createLogFixture()])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 422,
      retryable: false,
    });
  });

  it("still maps 429 to retryable RATE_LIMITED", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "rate_limited", message: "Too many" }), {
          status: 429,
          headers: { "Content-Type": "application/json", "Retry-After": "0" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(1));

    const transport = new HttpTransport({ endpoint, apiKey, maxRetries: 2 });
    const result = await transport.send([createLogFixture()]);

    expect(result.accepted).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
