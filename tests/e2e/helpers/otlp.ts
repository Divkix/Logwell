import type { APIRequestContext, Page } from '@playwright/test';

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const SEVERITY_NUMBER_BY_LEVEL: Record<LogLevel, number> = {
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
};

function toOtlpAnyValue(value: unknown) {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') return { doubleValue: value };
  if (value === null || value === undefined) return { stringValue: 'null' };
  return { stringValue: JSON.stringify(value) };
}

function toOtlpAttributes(record?: Record<string, unknown>) {
  if (!record) return undefined;
  return Object.entries(record).map(([key, value]) => ({
    key,
    value: toOtlpAnyValue(value),
  }));
}

async function postOtlpLogs(
  request: APIRequestContext,
  apiKey: string,
  payload: unknown,
): Promise<void> {
  const response = await request.post('/v1/logs', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    data: payload,
  });

  if (!response.ok()) {
    throw new Error(`OTLP ingestion failed: ${response.status()} ${await response.text()}`);
  }
}

export async function ingestOtlpLogs(
  page: Page,
  apiKey: string,
  logs: Array<{ level: LogLevel; message: string; attributes?: Record<string, unknown> }>,
): Promise<void> {
  const logRecords = logs.map((log) => ({
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
            scope: { name: 'sv-logger-e2e' },
            logRecords,
          },
        ],
      },
    ],
  };

  await postOtlpLogs(page.request, apiKey, payload);
}
