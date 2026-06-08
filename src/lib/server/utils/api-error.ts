// Standardized API error response helper (RT-7: consistent error shape)
export function apiError(status: number, error: string, message?: string): Response {
  return new Response(JSON.stringify({ error, ...(message ? { message } : {}) }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
