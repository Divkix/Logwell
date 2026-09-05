import { json } from "@sveltejs/kit";

export function requireJsonContentType(request: Request): Response | null {
  const contentType = request.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return json(
      { error: "unsupported_media_type", message: "Content-Type must be application/json" },
      { status: 415 },
    );
  }
  return null;
}
