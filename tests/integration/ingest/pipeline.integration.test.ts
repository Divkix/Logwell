import { eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { API_CONFIG } from "../../../src/lib/server/config/performance";
import type * as schema from "../../../src/lib/server/db/schema";
import { incident, log, project as projectTable } from "../../../src/lib/server/db/schema";
import { setupTestDatabase } from "../../../src/lib/server/db/test-db";
import { logEventBus } from "../../../src/lib/server/events";
import { clearApiKeyCache } from "../../../src/lib/server/utils/api-key";
import { ingestLogs, type IngestBodyParser } from "../../../src/lib/server/utils/ingest";
import { parseOtlpIngestBody } from "../../../src/lib/server/utils/otlp";
import { checkRateLimit, INGEST_RPM } from "../../../src/lib/server/utils/rate-limit";
import { parseSimpleIngestBody } from "../../../src/lib/server/utils/simple-ingest";
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
  validBody: (message: string) => unknown;
}> = [
  { name: "otlp", parse: parseOtlpIngestBody, validBody: otlpBody },
  { name: "simple", parse: parseSimpleIngestBody, validBody: simpleBody },
];

function post(body: unknown, apiKey?: string, contentType: string | null = "application/json") {
  const headers: Record<string, string> = {};
  if (contentType) headers["Content-Type"] = contentType;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return new Request("http://localhost/v1/ingest", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
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
        while (checkRateLimit(`ingest:${project.id}`, INGEST_RPM)) {}

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
        while (checkRateLimit(`ingest:${projectA.id}`, INGEST_RPM)) {}

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

    const bodies: Array<[IngestBodyParser, unknown]> = [
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

    const bodies: Array<[IngestBodyParser, unknown]> = [
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
});
