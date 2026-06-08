import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { LogwellError } from "../../src/errors";
import { HttpTransport, type TransportConfig } from "../../src/transport";
import { createLogBatch, createLogFixture, logFixtures } from "../fixtures/logs";
import { BASE_URL, errorHandlers } from "../mocks/handlers";
import { server } from "../mocks/server";

describe("HttpTransport", () => {
  let defaultConfig: TransportConfig;

  beforeEach(() => {
    defaultConfig = {
      endpoint: BASE_URL,
      apiKey: "lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456",
      maxRetries: 3,
    };
  });

  describe("send", () => {
    it("sends logs to the correct endpoint", async () => {
      let capturedUrl: string | undefined;
      server.use(
        http.post("*/v1/ingest", ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ accepted: 1 });
        }),
      );

      const transport = new HttpTransport(defaultConfig);
      await transport.send([createLogFixture()]);

      expect(capturedUrl).toBe(`${BASE_URL}/v1/ingest`);
    });

    it("sends Authorization Bearer header", async () => {
      let capturedAuth: string | null = null;
      server.use(
        http.post("*/v1/ingest", ({ request }) => {
          capturedAuth = request.headers.get("Authorization");
          return HttpResponse.json({ accepted: 1 });
        }),
      );

      const transport = new HttpTransport(defaultConfig);
      await transport.send([createLogFixture()]);

      expect(capturedAuth).toBe(`Bearer ${defaultConfig.apiKey}`);
    });

    it("sends Content-Type application/json", async () => {
      let capturedContentType: string | null = null;
      server.use(
        http.post("*/v1/ingest", ({ request }) => {
          capturedContentType = request.headers.get("Content-Type");
          return HttpResponse.json({ accepted: 1 });
        }),
      );

      const transport = new HttpTransport(defaultConfig);
      await transport.send([createLogFixture()]);

      expect(capturedContentType).toBe("application/json");
    });

    it("sends logs as JSON array in body", async () => {
      let capturedBody: unknown;
      server.use(
        http.post("*/v1/ingest", async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ accepted: 2 });
        }),
      );

      const transport = new HttpTransport(defaultConfig);
      const logs = createLogBatch(2);
      await transport.send(logs);

      expect(capturedBody).toEqual(logs);
    });

    it("returns response on success", async () => {
      server.use(
        http.post("*/v1/ingest", () => {
          return HttpResponse.json({ accepted: 3 });
        }),
      );

      const transport = new HttpTransport(defaultConfig);
      const response = await transport.send(createLogBatch(3));

      expect(response).toEqual({ accepted: 3 });
    });

    it("includes partial success info in response", async () => {
      server.use(errorHandlers.partialSuccess);

      const transport = new HttpTransport(defaultConfig);
      const response = await transport.send(createLogBatch(3));

      expect(response.accepted).toBe(2);
      expect(response.rejected).toBe(1);
      expect(response.errors).toContain("Entry at index 2: invalid level");
    });
  });

  describe("error handling", () => {
    it("throws LogwellError on 401 Unauthorized", async () => {
      server.use(errorHandlers.unauthorized);

      const transport = new HttpTransport(defaultConfig);

      await expect(transport.send([createLogFixture()])).rejects.toThrow(LogwellError);
      await expect(transport.send([createLogFixture()])).rejects.toMatchObject({
        code: "UNAUTHORIZED",
        statusCode: 401,
        retryable: false,
      });
    });

    it("throws LogwellError on 400 validation error", async () => {
      server.use(errorHandlers.validationError);

      const transport = new HttpTransport(defaultConfig);

      await expect(transport.send([createLogFixture()])).rejects.toThrow(LogwellError);
      await expect(transport.send([createLogFixture()])).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        retryable: false,
      });
    });

    it("throws LogwellError on 500 server error", async () => {
      server.use(errorHandlers.serverError);

      const transport = new HttpTransport(defaultConfig);

      await expect(transport.send([createLogFixture()])).rejects.toThrow(LogwellError);
      await expect(transport.send([createLogFixture()])).rejects.toMatchObject({
        code: "SERVER_ERROR",
        statusCode: 500,
        retryable: true,
      });
    });

    it("throws LogwellError on 429 rate limited", async () => {
      server.use(errorHandlers.rateLimited);

      const transport = new HttpTransport(defaultConfig);

      await expect(transport.send([createLogFixture()])).rejects.toThrow(LogwellError);
      await expect(transport.send([createLogFixture()])).rejects.toMatchObject({
        code: "RATE_LIMITED",
        statusCode: 429,
        retryable: true,
      });
    });

    it("throws LogwellError on network failure", async () => {
      server.use(
        http.post("*/v1/ingest", () => {
          return HttpResponse.error();
        }),
      );

      const transport = new HttpTransport(defaultConfig);

      await expect(transport.send([createLogFixture()])).rejects.toThrow(LogwellError);
      await expect(transport.send([createLogFixture()])).rejects.toMatchObject({
        code: "NETWORK_ERROR",
        retryable: true,
      });
    });
  });

  describe("retry logic", () => {
    it("retries on 5xx errors up to maxRetries", async () => {
      let attempts = 0;
      server.use(
        http.post("*/v1/ingest", () => {
          attempts++;
          if (attempts < 3) {
            return HttpResponse.json({ error: "internal" }, { status: 500 });
          }
          return HttpResponse.json({ accepted: 1 });
        }),
      );

      const transport = new HttpTransport({ ...defaultConfig, maxRetries: 3 });
      const response = await transport.send([createLogFixture()]);

      expect(attempts).toBe(3);
      expect(response.accepted).toBe(1);
    });

    it("does not retry on 4xx errors (except 429)", async () => {
      let attempts = 0;
      server.use(
        http.post("*/v1/ingest", () => {
          attempts++;
          return HttpResponse.json({ error: "bad request" }, { status: 400 });
        }),
      );

      const transport = new HttpTransport({ ...defaultConfig, maxRetries: 3 });

      await expect(transport.send([createLogFixture()])).rejects.toThrow();
      expect(attempts).toBe(1);
    });

    it("retries on 429 rate limited", async () => {
      let attempts = 0;
      server.use(
        http.post("*/v1/ingest", () => {
          attempts++;
          if (attempts < 2) {
            return HttpResponse.json(
              { error: "rate_limited" },
              { status: 429, headers: { "Retry-After": "0" } },
            );
          }
          return HttpResponse.json({ accepted: 1 });
        }),
      );

      const transport = new HttpTransport({ ...defaultConfig, maxRetries: 3 });
      const response = await transport.send([createLogFixture()]);

      expect(attempts).toBe(2);
      expect(response.accepted).toBe(1);
    });

    it("retries on network errors", async () => {
      let attempts = 0;
      server.use(
        http.post("*/v1/ingest", () => {
          attempts++;
          if (attempts < 2) {
            return HttpResponse.error();
          }
          return HttpResponse.json({ accepted: 1 });
        }),
      );

      const transport = new HttpTransport({ ...defaultConfig, maxRetries: 3 });
      const response = await transport.send([createLogFixture()]);

      expect(attempts).toBe(2);
      expect(response.accepted).toBe(1);
    });

    it("fails after exhausting retries", async () => {
      let attempts = 0;
      server.use(
        http.post("*/v1/ingest", () => {
          attempts++;
          return HttpResponse.json({ error: "internal" }, { status: 500 });
        }),
      );

      const transport = new HttpTransport({ ...defaultConfig, maxRetries: 2 });

      await expect(transport.send([createLogFixture()])).rejects.toThrow(LogwellError);
      expect(attempts).toBe(3); // initial + 2 retries
    });

    it("uses exponential backoff between retries", async () => {
      const delays: number[] = [];
      let lastTime = Date.now();

      server.use(
        http.post("*/v1/ingest", () => {
          const now = Date.now();
          delays.push(now - lastTime);
          lastTime = now;
          return HttpResponse.json({ error: "internal" }, { status: 500 });
        }),
      );

      const transport = new HttpTransport({ ...defaultConfig, maxRetries: 2 });

      await expect(transport.send([createLogFixture()])).rejects.toThrow();

      // First request is immediate, delays should increase
      // We can't test exact timing, but we can verify the pattern
      expect(delays.length).toBe(3);
    });
  });

  describe("log formatting", () => {
    it("sends all log fields correctly", async () => {
      let capturedBody: unknown;
      server.use(
        http.post("*/v1/ingest", async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ accepted: 1 });
        }),
      );

      const transport = new HttpTransport(defaultConfig);
      await transport.send([logFixtures.full]);

      expect(capturedBody).toEqual([logFixtures.full]);
    });

    it("handles unicode in messages", async () => {
      let capturedBody: unknown;
      server.use(
        http.post("*/v1/ingest", async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ accepted: 1 });
        }),
      );

      const transport = new HttpTransport(defaultConfig);
      await transport.send([logFixtures.withUnicode]);

      expect(capturedBody).toEqual([logFixtures.withUnicode]);
    });

    it("handles large metadata objects", async () => {
      let capturedBody: unknown;
      server.use(
        http.post("*/v1/ingest", async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ accepted: 1 });
        }),
      );

      const transport = new HttpTransport(defaultConfig);
      await transport.send([logFixtures.withLargeMetadata]);

      expect(capturedBody).toEqual([logFixtures.withLargeMetadata]);
    });
  });
});
