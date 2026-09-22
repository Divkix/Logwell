import type { APIRequestContext, Page } from "@playwright/test";
import type { JsonObject, JsonValue } from "$lib/shared/schemas/json";
import { z } from "zod";

type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

type OtlpAnyValue = { stringValue: string } | { boolValue: boolean } | { doubleValue: number };

type OtlpLogRecord = {
  severityNumber: number;
  severityText: string;
  body: { stringValue: string };
  attributes?: Array<{ key: string; value: OtlpAnyValue }>;
};

type OtlpPayload = {
  resourceLogs: Array<{
    scopeLogs: Array<{ scope: { name: string }; logRecords: OtlpLogRecord[] }>;
  }>;
};

const SEVERITY_NUMBER_BY_LEVEL: Record<LogLevel, number> = {
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
};

const stringValueSchema = z.string();

const boolValueSchema = z.boolean();

const doubleValueSchema = z.number();

function toOtlpAnyValue(value: JsonValue | undefined): OtlpAnyValue {
  const decodedString = stringValueSchema.safeParse(value);

  if (decodedString.success) return { stringValue: decodedString.data };

  const decodedBool = boolValueSchema.safeParse(value);

  if (decodedBool.success) return { boolValue: decodedBool.data };

  const decodedNumber = doubleValueSchema.safeParse(value);

  if (decodedNumber.success) return { doubleValue: decodedNumber.data };

  if (value === null || value === undefined) return { stringValue: "null" };

  return { stringValue: JSON.stringify(value) };
}

function toOtlpAttributes(record?: JsonObject) {
  if (!record) return undefined;

  return Object.entries(record).map(([key, value]) => ({
    key,
    value: toOtlpAnyValue(value),
  }));
}

async function postOtlpLogs(
  request: APIRequestContext,
  apiKey: string,
  payload: OtlpPayload,
): Promise<void> {
  const response = await request.post("/v1/logs", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    data: payload,
  });

  if (!response.ok()) {
    throw new Error(`OTLP ingestion failed: ${response.status()} ${await response.text()}`);
  }
}

const MAX_BATCH_SIZE = 100;

export async function ingestOtlpLogs(
  page: Page,
  apiKey: string,
  logs: Array<{ level: LogLevel; message: string; attributes?: JsonObject }>,
): Promise<void> {
  for (let i = 0; i < logs.length; i += MAX_BATCH_SIZE) {
    const batch = logs.slice(i, i + MAX_BATCH_SIZE);

    const logRecords = batch.map((log) => ({
      severityNumber: SEVERITY_NUMBER_BY_LEVEL[log.level],
      severityText: log.level.toUpperCase(),
      body: { stringValue: log.message },
      attributes: toOtlpAttributes(log.attributes),
    }));

    const payload = {
      resourceLogs: [
        {
          scopeLogs: [
            {
              scope: { name: "logwell-e2e" },
              logRecords,
            },
          ],
        },
      ],
    };

    await postOtlpLogs(page.request, apiKey, payload);
  }
}
