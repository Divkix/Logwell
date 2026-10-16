import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { getRequest } from "@sveltejs/kit/node";
import { eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { API_CONFIG } from "../../../src/lib/server/config/performance";
import type * as schema from "../../../src/lib/server/db/schema";
import { incident, log, project as projectTable } from "../../../src/lib/server/db/schema";
import { setupTestDatabase } from "../../../src/lib/server/db/test-db";
import { logEventBus } from "../../../src/lib/server/events";
import {
  clearApiKeyCache,
  generateApiKey,
  hashApiKey,
} from "../../../src/lib/server/utils/api-key";
import {
  ingestLogs,
  MAX_INGEST_JSON_DEPTH,
  type IngestBodyParser,
} from "../../../src/lib/server/utils/ingest";
import { parseOtlpIngestBody } from "../../../src/lib/server/utils/otlp";
import { INGEST_RPM, ingestProjectLimiter } from "../../../src/lib/server/utils/rate-limit";
import { parseSimpleIngestBody } from "../../../src/lib/server/utils/simple-ingest";
import type { JsonValue } from "../../../src/lib/shared/schemas/json";
import { seedProjectWithApiKey } from "../../fixtures/db";

const otlpBody = (message: string) => ({
  resourceLogs: [{ scopeLogs: [{ logRecords: [{ body: { stringValue: message } }] }] }],
});

const otlpErrorBody = (message: string) => ({
  resourceLogs: [
    {
      scopeLogs: [{ logRecords: [{ body: { stringValue: message }, severityText: "ERROR" }] }],
    },
  ],
});

const simpleBody = (message: string) => ({ level: "info", message, service: "web" });

const cases: Array<{
  name: string;
  parse: IngestBodyParser;
  validBody: (message: string) => JsonValue;
}> = [
  { name: "otlp", parse: parseOtlpIngestBody, validBody: otlpBody },
  { name: "simple", parse: parseSimpleIngestBody, validBody: simpleBody },
];

function post(body: JsonValue, apiKey?: string, contentType: string | null = "application/json") {
  const headers: Record<string, string> = {};

  if (contentType) headers["Content-Type"] = contentType;

  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  // Raw strings (the junk-body cases) go over the wire untouched; anything else is JSON-encoded.
  const rawText = z.string().safeParse(body);

  return new Request("http://localhost/v1/ingest", {
    method: "POST",
    headers,
    body: rawText.success ? rawText.data : JSON.stringify(body),
  });
}

describe("ingestLogs pipeline", () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
    clearApiKeyCache();
    logEventBus.clear();
  });

  afterEach(async () => {
    logEventBus.clear();
    await cleanup();
  });

  for (const { name, parse, validBody } of cases) {
    describe(`${name} parser`, () => {
      it("returns 415 without JSON content type", async () => {
        const project = await seedProjectWithApiKey(db);
        const response = await ingestLogs(post(validBody("x"), project.apiKey, null), db, parse);
        expect(response.status).toBe(415);
      });

      it("returns 401 without Authorization header", async () => {
        const response = await ingestLogs(post(validBody("x")), db, parse);
        expect(response.status).toBe(401);
      });

      it("returns 401 for unknown key and deleted projects", async () => {
        const unknown = await ingestLogs(
          post(validBody("x"), "lw_invalid_key_that_does_not_exist"),
          db,
          parse,
        );

        expect(unknown.status).toBe(401);

        const project = await seedProjectWithApiKey(db);
        const response = await ingestLogs(post(validBody("x"), project.apiKey), db, parse);
        expect(response.status).toBe(200);

        await db.delete(projectTable).where(eq(projectTable.id, project.id));
        clearApiKeyCache();
        const retry = await ingestLogs(post(validBody("x"), project.apiKey), db, parse);
        expect(retry.status).toBe(401);
      });

      it("returns normalized 429 with Retry-After and writes no logs", async () => {
        const project = await seedProjectWithApiKey(db);

        while (ingestProjectLimiter.take(project.id, INGEST_RPM)) {}

        const response = await ingestLogs(post(validBody("limited"), project.apiKey), db, parse);
        expect(response.status).toBe(429);
        expect(response.headers.get("Retry-After")).toBe("60");
        expect(await response.json()).toEqual({
          error: "rate_limited",
          message: "Rate limit exceeded. Retry in 60 seconds.",
        });

        const rows = await db.select().from(log).where(eq(log.projectId, project.id));
        expect(rows).toHaveLength(0);
      });

      it("isolates rate limits per project", async () => {
        const projectA = await seedProjectWithApiKey(db);
        const projectB = await seedProjectWithApiKey(db);

        while (ingestProjectLimiter.take(projectA.id, INGEST_RPM)) {}

        const limited = await ingestLogs(post(validBody("A limited"), projectA.apiKey), db, parse);
        expect(limited.status).toBe(429);

        const allowed = await ingestLogs(post(validBody("B allowed"), projectB.apiKey), db, parse);
        expect(allowed.status).toBe(200);
      });

      it("returns 400 for invalid JSON", async () => {
        const project = await seedProjectWithApiKey(db);
        const response = await ingestLogs(post("{not-json", project.apiKey), db, parse);
        expect(response.status).toBe(400);
        expect((await response.json()).error).toBe("invalid_json");
      });

      it("returns 413 when the body exceeds the adapter's BODY_SIZE_LIMIT", async () => {
        const project = await seedProjectWithApiKey(db);
        const payload = Buffer.from(JSON.stringify(validBody("x".repeat(2048))));
        const incoming = new IncomingMessage(new Socket());
        incoming.method = "POST";
        incoming.url = "/v1/ingest";
        incoming.httpVersionMajor = 1;
        incoming.headers = {
          "content-type": "application/json",
          "content-length": String(payload.length),
          authorization: `Bearer ${project.apiKey}`,
          host: "localhost",
        };
        incoming.push(payload);
        incoming.push(null);

        // The exact request adapter-node hands SvelteKit with BODY_SIZE_LIMIT=1K.
        const request = getRequest({
          request: incoming,
          base: "http://localhost",
          bodySizeLimit: 1024,
        });

        const response = await ingestLogs(request, db, parse);
        expect(response.status).toBe(413);
        expect((await response.json()).error).toBe("payload_too_large");
      });

      it("accepts a valid batch and broadcasts logs", async () => {
        const project = await seedProjectWithApiKey(db);
        const seen: string[] = [];
        const unsubscribe = logEventBus.onLog(project.id, (entry) => seen.push(entry.id));

        try {
          const response = await ingestLogs(post(validBody("hello"), project.apiKey), db, parse);
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual({ accepted: 1 });

          const rows = await db.select().from(log).where(eq(log.projectId, project.id));
          expect(rows).toHaveLength(1);
          expect(seen).toEqual(rows.map((row) => row.id));
        } finally {
          unsubscribe();
        }
      });
    });
  }

  it("rejects batches over the insert limit from either parser", async () => {
    const project = await seedProjectWithApiKey(db);

    const oversized = Array.from({ length: API_CONFIG.BATCH_INSERT_LIMIT + 1 }, (_, i) => ({
      level: "info",
      message: `log ${i}`,
    }));

    const oversizedOtlp = {
      resourceLogs: [
        {
          scopeLogs: [
            { logRecords: oversized.map((entry) => ({ body: { stringValue: entry.message } })) },
          ],
        },
      ],
    };

    for (const parse of [parseOtlpIngestBody, parseSimpleIngestBody]) {
      const body = parse === parseSimpleIngestBody ? oversized : oversizedOtlp;
      const response = await ingestLogs(post(body, project.apiKey), db, parse);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("batch_too_large");
    }

    const rows = await db.select().from(log).where(eq(log.projectId, project.id));
    expect(rows).toHaveLength(0);
  });

  it("returns 400 validation_error for an empty simple-ingest array", async () => {
    const project = await seedProjectWithApiKey(db);
    const response = await ingestLogs(post([], project.apiKey), db, parseSimpleIngestBody);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("validation_error");
  });

  it("counts rejected entries toward the insert limit from either parser", async () => {
    const project = await seedProjectWithApiKey(db);
    const valid = Array.from({ length: API_CONFIG.BATCH_INSERT_LIMIT - 1 }, (_, i) => `log ${i}`);

    const bodies: Array<[IngestBodyParser, JsonValue]> = [
      [
        parseSimpleIngestBody,
        [
          ...valid.map((message) => ({ level: "info", message })),
          { level: "bogus", message: "rejected" },
          { level: "info", message: "one over" },
        ],
      ],
      [
        parseOtlpIngestBody,
        {
          resourceLogs: [
            {
              scopeLogs: [
                {
                  logRecords: [
                    ...valid.map((message) => ({ body: { stringValue: message } })),
                    {},
                    { body: { stringValue: "one over" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    ];

    for (const [parse, body] of bodies) {
      const response = await ingestLogs(post(body, project.apiKey), db, parse);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("batch_too_large");
    }

    const rows = await db.select().from(log).where(eq(log.projectId, project.id));
    expect(rows).toHaveLength(0);
  });

  it("fails junk-flooded batches as batch_too_large without echoing entry errors", async () => {
    const project = await seedProjectWithApiKey(db);
    const flood = Array.from({ length: 20000 }, () => null);

    const expectedBody = {
      error: "batch_too_large",
      message: `Batch exceeds maximum limit of ${API_CONFIG.BATCH_INSERT_LIMIT} logs.`,
    };

    const bodies: Array<[IngestBodyParser, JsonValue]> = [
      [parseSimpleIngestBody, flood],
      [parseOtlpIngestBody, { resourceLogs: [{ scopeLogs: [{ logRecords: flood }] }] }],
      [parseOtlpIngestBody, { resourceLogs: flood }],
    ];

    for (const [parse, body] of bodies) {
      const response = await ingestLogs(post(body, project.apiKey), db, parse);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual(expectedBody);
    }

    const rows = await db.select().from(log).where(eq(log.projectId, project.id));
    expect(rows).toHaveLength(0);
  });

  it("rejects records whose message contains a NUL character", async () => {
    const project = await seedProjectWithApiKey(db);

    const simpleResponse = await ingestLogs(
      post({ level: "info", message: "before\u0000after" }, project.apiKey),
      db,
      parseSimpleIngestBody,
    );

    expect(simpleResponse.status).toBe(200);
    expect(await simpleResponse.json()).toEqual({
      accepted: 0,
      rejected: 1,
      errors: ["Entry at index 0: message cannot contain NUL characters"],
    });

    const otlpResponse = await ingestLogs(
      post(
        {
          resourceLogs: [
            {
              scopeLogs: [{ logRecords: [{ body: { stringValue: "before\u0000after" } }] }],
            },
          ],
        },
        project.apiKey,
      ),
      db,
      parseOtlpIngestBody,
    );

    expect(otlpResponse.status).toBe(200);
    expect(await otlpResponse.json()).toEqual({
      accepted: 0,
      rejected: 1,
      errors: ["Log record rejected: message cannot contain NUL characters"],
    });

    const rows = await db.select().from(log).where(eq(log.projectId, project.id));
    expect(rows).toHaveLength(0);
  });

  it("strips NUL characters from stored payloads instead of failing the batch", async () => {
    const project = await seedProjectWithApiKey(db);

    const simpleResponse = await ingestLogs(
      post(
        {
          level: "info",
          message: "nul-simple",
          service: "we\u0000b",
          sourceFile: "src/a\u0000b.ts",
          metadata: { "k\u0000ey": "v\u0000al", nested: { list: ["a\u0000b"] } },
        },
        project.apiKey,
      ),
      db,
      parseSimpleIngestBody,
    );

    expect(simpleResponse.status).toBe(200);
    expect(await simpleResponse.json()).toEqual({ accepted: 1 });

    const otlpResponse = await ingestLogs(
      post(
        {
          resourceLogs: [
            {
              resource: {
                attributes: [{ key: "service.name", value: { stringValue: "we\u0000b" } }],
              },
              scopeLogs: [
                {
                  scope: {
                    name: "sc\u0000ope",
                    attributes: [{ key: "s\u0000k", value: { stringValue: "s\u0000v" } }],
                  },
                  logRecords: [
                    {
                      severityText: "ERR\u0000OR",
                      body: {
                        kvlistValue: {
                          values: [{ key: "b\u0000k", value: { stringValue: "b\u0000v" } }],
                        },
                      },
                      attributes: [{ key: "k\u0000ey", value: { stringValue: "v\u0000al" } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        project.apiKey,
      ),
      db,
      parseOtlpIngestBody,
    );

    expect(otlpResponse.status).toBe(200);
    expect(await otlpResponse.json()).toEqual({ accepted: 1 });

    const rows = await db.select().from(log).where(eq(log.projectId, project.id));
    expect(rows).toHaveLength(2);

    const simple = rows.find((row) => row.message === "nul-simple")!;
    expect(simple.metadata).toEqual({ key: "val", nested: { list: ["ab"] } });
    expect(simple.resourceAttributes).toEqual({ "service.name": "web" });
    expect(simple.sourceFile).toBe("src/ab.ts");

    const otlp = rows.find((row) => row.message !== "nul-simple")!;
    expect(otlp.metadata).toEqual({ key: "val" });
    expect(otlp.body).toEqual({ bk: "bv" });
    expect(otlp.resourceAttributes).toEqual({ "service.name": "web" });
    expect(otlp.scopeAttributes).toEqual({ sk: "sv" });
    expect(otlp.scopeName).toBe("scope");
    expect(otlp.severityText).toBe("ERROR");

    const jsonbColumns = JSON.stringify([
      simple.metadata,
      simple.resourceAttributes,
      otlp.metadata,
      otlp.body,
      otlp.resourceAttributes,
      otlp.scopeAttributes,
    ]);

    expect(jsonbColumns).not.toContain("\\u0000");
  });

  it("maps validation failures to 400 validation_error per parser", async () => {
    const project = await seedProjectWithApiKey(db);

    const otlpResponse = await ingestLogs(
      post({ resourceLogs: "nope" }, project.apiKey),
      db,
      parseOtlpIngestBody,
    );

    expect(otlpResponse.status).toBe(400);
    expect((await otlpResponse.json()).error).toBe("validation_error");

    const simpleResponse = await ingestLogs(
      post({ level: "bogus", message: "x" }, project.apiKey),
      db,
      parseSimpleIngestBody,
    );

    expect(simpleResponse.status).toBe(200);
    expect(await simpleResponse.json()).toEqual({
      accepted: 0,
      rejected: 1,
      errors: [
        "Entry at index 0: invalid level 'bogus' (must be one of: debug, info, warn, error, fatal)",
      ],
    });
  });

  it("rejects pathologically nested bodies as validation_error, not a stack overflow", async () => {
    const project = await seedProjectWithApiKey(db);
    const nested = (levels: number) => '{"a":'.repeat(levels) + "1" + "}".repeat(levels);
    const deep = nested(10_000);

    const bodies: Array<[IngestBodyParser, string]> = [
      [parseOtlpIngestBody, `{"resourceLogs":[${deep}]}`],
      [parseSimpleIngestBody, `{"level":"info","message":"deep","metadata":${deep}}`],
    ];

    for (const [parse, body] of bodies) {
      const response = await ingestLogs(post(body, project.apiKey), db, parse);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "validation_error",
        message: `Request body nests deeper than ${MAX_INGEST_JSON_DEPTH} levels.`,
      });
    }

    // Nesting under the cap still ingests.
    const shallow = `{"level":"info","message":"ok","metadata":${nested(MAX_INGEST_JSON_DEPTH - 2)}}`;
    const accepted = await ingestLogs(post(shallow, project.apiKey), db, parseSimpleIngestBody);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ accepted: 1 });
  });

  it("ingests partial batches with per-record errors as 200", async () => {
    const project = await seedProjectWithApiKey(db);

    const response = await ingestLogs(
      post(
        [
          { level: "info", message: "good" },
          { level: "bogus", message: "bad" },
        ],
        project.apiKey,
      ),
      db,
      parseSimpleIngestBody,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accepted).toBe(1);
    expect(body.rejected).toBe(1);
    expect(body.errors).toHaveLength(1);

    const rows = await db.select().from(log).where(eq(log.projectId, project.id));
    expect(rows).toHaveLength(1);
  });

  it("groups error logs into incidents and broadcasts both", async () => {
    const project = await seedProjectWithApiKey(db);
    const emittedLogs: string[] = [];
    const emittedIncidents: string[] = [];
    const unsubLog = logEventBus.onLog(project.id, (entry) => emittedLogs.push(entry.id));

    const unsubIncident = logEventBus.onIncident(project.id, (entry) =>
      emittedIncidents.push(entry.id),
    );

    try {
      const response = await ingestLogs(
        post(otlpErrorBody("connection refused"), project.apiKey),
        db,
        parseOtlpIngestBody,
      );

      expect(response.status).toBe(200);

      const incidents = await db.select().from(incident).where(eq(incident.projectId, project.id));
      expect(incidents).toHaveLength(1);
      expect(incidents[0]!.title).toContain("connection refused");

      const rows = await db.select().from(log).where(eq(log.projectId, project.id));
      expect(rows[0]!.incidentId).toBe(incidents[0]!.id);
      expect(rows[0]!.fingerprint).toBe(incidents[0]!.fingerprint);
      expect(emittedLogs).toHaveLength(1);
      expect(emittedIncidents).toHaveLength(1);
    } finally {
      unsubLog();
      unsubIncident();
    }
  });

  it("stores the service name from simple ingest", async () => {
    const project = await seedProjectWithApiKey(db);

    const response = await ingestLogs(
      post({ level: "info", message: "hi", service: "web" }, project.apiKey),
      db,
      parseSimpleIngestBody,
    );

    expect(response.status).toBe(200);

    const rows = await db.select().from(log).where(eq(log.projectId, project.id));
    expect(rows[0]!.serviceName).toBe("web");
  });

  // Byte-level contract of every batch-level outcome: status, JSON body and headers.
  describe("batch-level error contract", () => {
    it("passes the content-type guard response through", async () => {
      const project = await seedProjectWithApiKey(db);

      const response = await ingestLogs(
        post(otlpBody("x"), project.apiKey, "text/plain"),
        db,
        parseOtlpIngestBody,
      );

      expect(response.status).toBe(415);
      expect(await response.json()).toEqual({
        error: "unsupported_media_type",
        message: "Content-Type must be application/json",
      });
    });

    it("maps API key failures to unauthorized with the key error message", async () => {
      const cases: Array<[string | undefined, string]> = [
        [undefined, "Missing or invalid authorization header"],
        ["lw_short", "Invalid API key format"],
        [`lw_${"a".repeat(32)}`, "Invalid API key"],
      ];

      for (const [apiKey, message] of cases) {
        const response = await ingestLogs(post(otlpBody("x"), apiKey), db, parseOtlpIngestBody);
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: "unauthorized", message });
      }
    });

    it("maps a cached key whose project row is gone to unauthorized", async () => {
      const project = await seedProjectWithApiKey(db);
      const warm = await ingestLogs(post(otlpBody("x"), project.apiKey), db, parseOtlpIngestBody);
      expect(warm.status).toBe(200);

      // The key stays cached, so only the pipeline's own project-row check can reject it.
      await db.delete(projectTable).where(eq(projectTable.id, project.id));

      const response = await ingestLogs(
        post(otlpBody("x"), project.apiKey),
        db,
        parseOtlpIngestBody,
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized", message: "Invalid API key" });
    });

    it("rejects a cached key once its rotation commits, without a cache invalidation", async () => {
      const project = await seedProjectWithApiKey(db);
      const warm = await ingestLogs(post(otlpBody("x"), project.apiKey), db, parseOtlpIngestBody);
      expect(warm.status).toBe(200);

      // Simulates a rotation committed on another replica (or racing this one's invalidation):
      // the old key is still cached here, so only the per-request hash check can reject it.
      await db
        .update(projectTable)
        .set({ apiKeyHash: hashApiKey(generateApiKey()) })
        .where(eq(projectTable.id, project.id));

      const response = await ingestLogs(
        post(otlpBody("x"), project.apiKey),
        db,
        parseOtlpIngestBody,
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized", message: "Invalid API key" });
    });

    it("returns the full invalid_json body", async () => {
      const project = await seedProjectWithApiKey(db);
      const response = await ingestLogs(post("{not-json", project.apiKey), db, parseOtlpIngestBody);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "invalid_json",
        message: "Request body must be valid JSON",
      });
    });

    it("returns validation_error with the parser message for both parsers", async () => {
      const project = await seedProjectWithApiKey(db);

      const bodies: Array<[IngestBodyParser, JsonValue, string]> = [
        [parseOtlpIngestBody, { resourceLogs: "nope" }, "resourceLogs must be an array."],
        [parseSimpleIngestBody, [], "Request body cannot be an empty array"],
      ];

      for (const [parse, body, message] of bodies) {
        const response = await ingestLogs(post(body, project.apiKey), db, parse);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "validation_error", message });
      }
    });

    it("rejects parsed batches over the insert limit with the received count", async () => {
      const project = await seedProjectWithApiKey(db);
      const size = API_CONFIG.BATCH_INSERT_LIMIT + 1;

      const oversizedParse: IngestBodyParser = (body) => {
        const parsed = parseSimpleIngestBody(body);

        return { ...parsed, inputs: Array.from({ length: size }, () => parsed.inputs[0]!) };
      };

      const response = await ingestLogs(post(simpleBody("x"), project.apiKey), db, oversizedParse);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "batch_too_large",
        message: `Batch exceeds maximum limit of ${API_CONFIG.BATCH_INSERT_LIMIT} logs. Received ${size} logs.`,
      });

      const rows = await db.select().from(log).where(eq(log.projectId, project.id));
      expect(rows).toHaveLength(0);
    });

    it("rejects with the original error when the parser throws unexpectedly", async () => {
      const project = await seedProjectWithApiKey(db);
      const failure = new TypeError("parser bug");

      const throwingParse: IngestBodyParser = () => {
        throw failure;
      };

      await expect(
        ingestLogs(post(simpleBody("x"), project.apiKey), db, throwingParse),
      ).rejects.toBe(failure);
    });

    it("rejects with the original error when the key lookup fails", async () => {
      const project = await seedProjectWithApiKey(db);
      const failure = new Error("connection reset");

      vi.spyOn(db, "select").mockImplementationOnce(() => {
        throw failure;
      });

      await expect(
        ingestLogs(post(simpleBody("x"), project.apiKey), db, parseSimpleIngestBody),
      ).rejects.toBe(failure);
    });

    it("rejects with the original error when the insert transaction fails", async () => {
      const project = await seedProjectWithApiKey(db);
      const failure = new Error("deadlock detected");
      vi.spyOn(db, "transaction").mockRejectedValueOnce(failure);

      await expect(
        ingestLogs(post(simpleBody("x"), project.apiKey), db, parseSimpleIngestBody),
      ).rejects.toBe(failure);

      const rows = await db.select().from(log).where(eq(log.projectId, project.id));
      expect(rows).toHaveLength(0);
    });
  });
});
