import { nanoid } from "nanoid";
import { isQueryCanceled } from "#lib/server/utils/api-error.js";

export interface ErrorContext {
  error: unknown;
  url: string;
  method: string;
  route: string;
  status: number;
  message: string;
}

export interface ErrorResponse {
  id: string;
  message: string;
  /** Overrides the response status (Kit 3 merges the hook's `status` over the default 500). */
  status?: number;
  /** Machine-readable code, matching the `{ error, message }` shape of handled API errors. */
  error?: string;
}

const QUERY_TIMEOUT_MESSAGE =
  "The query took too long and was cancelled. Narrow the time range or filters and retry.";

export function handleError(context: ErrorContext): ErrorResponse {
  const { error, url, method, route, status, message } = context;

  const errorId = nanoid(12);

  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  // A statement the pool's statement_timeout cancelled is load, not a bug: the client can act
  // on it (narrow the query), so it gets a 503 with a code instead of a sanitized 500.
  const queryTimedOut = isQueryCanceled(error);
  const responseStatus = queryTimedOut ? 503 : status;

  console.error(
    `[ERROR] ${errorId} | ${method} ${route} | Status: ${responseStatus} | ${errorMessage}`,
    {
      id: errorId,
      url,
      method,
      route,
      status: responseStatus,
      error: errorMessage,
      stack: errorStack,
    },
  );

  if (queryTimedOut) {
    return { id: errorId, status: 503, error: "query_timeout", message: QUERY_TIMEOUT_MESSAGE };
  }

  const clientMessage = status >= 500 ? "Internal server error" : message;

  return {
    id: errorId,
    message: clientMessage,
  };
}
