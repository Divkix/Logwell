export function apiError(status: number, error: string, message?: string): Response {
  return new Response(JSON.stringify({ error, ...(message ? { message } : {}) }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
