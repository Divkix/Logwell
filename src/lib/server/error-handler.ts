import { nanoid } from "nanoid";

/**
 * Context for error handling
 */
export interface ErrorContext {
  error: unknown;
  url: string;
  method: string;
  route: string;
  status: number;
  message: string;
}

/**
 * Response returned to the client for errors
 */
export interface ErrorResponse {
  id: string;
  message: string;
}

/**
 * Error handler with consistent logging and response formatting.
 *
 * Lives outside hooks.server.ts so it can be tested without SvelteKit dependencies.
 */
export function handleError(context: ErrorContext): ErrorResponse {
  const { error, url, method, route, status, message } = context;

  // Generate unique error ID for tracking
  const errorId = nanoid(12);

  // Extract error details for logging
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  // Log the error with full context
  console.error(`[ERROR] ${errorId} | ${method} ${route} | Status: ${status} | ${errorMessage}`, {
    id: errorId,
    url,
    method,
    route,
    status,
    error: errorMessage,
    stack: errorStack,
  });

  // For 5xx errors, sanitize the message to avoid leaking internal details
  // For 4xx errors, preserve the user-friendly message
  const clientMessage = status >= 500 ? "Internal server error" : message;

  return {
    id: errorId,
    message: clientMessage,
  };
}
