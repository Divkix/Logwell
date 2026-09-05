import { nanoid } from "nanoid";

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
}

export function handleError(context: ErrorContext): ErrorResponse {
  const { error, url, method, route, status, message } = context;

  const errorId = nanoid(12);

  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  console.error(`[ERROR] ${errorId} | ${method} ${route} | Status: ${status} | ${errorMessage}`, {
    id: errorId,
    url,
    method,
    route,
    status,
    error: errorMessage,
    stack: errorStack,
  });

  const clientMessage = status >= 500 ? "Internal server error" : message;

  return {
    id: errorId,
    message: clientMessage,
  };
}
