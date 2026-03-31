import { delay, HttpResponse, http } from 'msw';

const BASE_URL = 'https://test.logwell.io';

/**
 * Default MSW handlers for Logwell API
 */
export const handlers = [
  // Success response for /v1/ingest
  http.post(`${BASE_URL}/v1/ingest`, async ({ request }) => {
    const authHeader = request.headers.get('Authorization');

    // Check authentication
    if (!authHeader?.startsWith('Bearer lw_')) {
      return HttpResponse.json(
        { error: 'unauthorized', message: 'Missing or invalid authorization header' },
        { status: 401 },
      );
    }

    // Parse body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return HttpResponse.json(
        { error: 'invalid_json', message: 'Request body must be valid JSON' },
        { status: 400 },
      );
    }

    // Count logs
    const logs = Array.isArray(body) ? body : [body];
    const accepted = logs.length;

    return HttpResponse.json({ accepted }, { status: 200 });
  }),
];

/**
 * Error handlers for specific test scenarios
 */
export const errorHandlers = {
  unauthorized: http.post(`${BASE_URL}/v1/ingest`, () =>
    HttpResponse.json({ error: 'unauthorized', message: 'Invalid API key' }, { status: 401 }),
  ),

  serverError: http.post(`${BASE_URL}/v1/ingest`, () =>
    HttpResponse.json({ error: 'internal_error' }, { status: 500 }),
  ),

  timeout: http.post(`${BASE_URL}/v1/ingest`, async () => {
    await delay('infinite');
    return HttpResponse.json({});
  }),

  rateLimited: http.post(`${BASE_URL}/v1/ingest`, () =>
    HttpResponse.json(
      { error: 'rate_limited', message: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': '5' } },
    ),
  ),

  partialSuccess: http.post(`${BASE_URL}/v1/ingest`, () =>
    HttpResponse.json({
      accepted: 2,
      rejected: 1,
      errors: ['Entry at index 2: invalid level'],
    }),
  ),

  validationError: http.post(`${BASE_URL}/v1/ingest`, () =>
    HttpResponse.json(
      { error: 'validation_error', message: 'Invalid log format' },
      { status: 400 },
    ),
  ),
};

export { BASE_URL };
