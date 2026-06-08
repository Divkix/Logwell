import { json } from "@sveltejs/kit";

/**
 * Validates that the request Content-Type is application/json.
 * Returns a 415 Unsupported Media Type response if not.
 */
export function requireJsonContentType(request: Request): Response | null {
  const contentType = request.headers.get("content-type") ?? "";
  // Compare the media type token exactly (ignoring parameters like charset) so
  // look-alikes such as application/jsonp are rejected.
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return json(
      { error: "unsupported_media_type", message: "Content-Type must be application/json" },
      { status: 415 },
    );
  }
  return null;
}
