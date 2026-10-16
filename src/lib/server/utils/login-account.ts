import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseClient } from "../db/db";
import { user } from "../db/schema";

/**
 * Bucket shared by every sign-in attempt whose target account cannot be read from the request.
 * Skipping the per-account limit for such requests would let a crafted body (one this parser
 * reads differently from better-auth) bypass it, so they are charged here instead.
 */
export const UNATTRIBUTED_LOGIN = "unattributed";

const AUTH_BASE_PATH = "/api/auth";

// Longer than any username (better-auth caps them at 30) or deliverable address, so better-auth
// rejects such a name before looking it up; skipping the lookup also keeps the key bounded.
const MAX_LOOKUP_LENGTH = 256;

// better-call's own JSON test (utils.mjs getBody): it matches the start of the full header.
const JSON_CONTENT_TYPE = /^application\/([a-z0-9.+-]*\+)?json/i;

interface PasswordEndpoint {
  field: "email" | "username";
  /** Reads the field from the body better-auth's own schema validates (which strips other keys). */
  identity: z.ZodType<string, unknown>;
}

/** The body field each password endpoint looks its account up by; a decoy field is never read. */
const PASSWORD_ENDPOINTS = new Map<string, PasswordEndpoint>([
  [
    "/sign-in/email",
    {
      field: "email",
      identity: z.object({ email: z.string().min(1) }).transform((body) => body.email),
    },
  ],
  [
    "/sign-in/username",
    {
      field: "username",
      identity: z.object({ username: z.string().min(1) }).transform((body) => body.username),
    },
  ],
]);

/**
 * The endpoint's identity field from the body, decoded the way better-call decodes it for the
 * endpoint; null when the body is unreadable or the field is not a non-empty string.
 */
async function readIdentity(request: Request, endpoint: PasswordEndpoint): Promise<string | null> {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();

  try {
    if (JSON_CONTENT_TYPE.test(contentType)) {
      return endpoint.identity.safeParse(await request.clone().json()).data ?? null;
    }

    if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      // Last value wins for a repeated key, as in better-call's formData.forEach copy.
      const fields = Object.fromEntries(await request.clone().formData());

      return endpoint.identity.safeParse(fields).data ?? null;
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Per-account login-limit key for a sign-in request, resolved to the account better-auth will
 * check the password against.
 *
 * The field is chosen by endpoint (`email` for /sign-in/email, `username` for /sign-in/username)
 * and resolved to the user's id, so an account's username and email share one bucket. A name
 * with no account gets its own key; anything that cannot be read as the endpoint's string field
 * gets UNATTRIBUTED_LOGIN.
 */
export async function loginAccountKey(
  db: DatabaseClient,
  request: Request,
  pathname: string,
): Promise<string> {
  const endpoint = PASSWORD_ENDPOINTS.get(
    pathname.slice(AUTH_BASE_PATH.length).toLowerCase().replace(/\/+$/, ""),
  );

  if (!endpoint) return UNATTRIBUTED_LOGIN;

  const identity = await readIdentity(request, endpoint);

  if (!identity) return UNATTRIBUTED_LOGIN;

  // Both endpoints lower-case the name before the lookup: the username plugin's default
  // normalizer, and findUserByEmail(email.toLowerCase()) for email.
  const name = identity.toLowerCase();

  if (name.length > MAX_LOOKUP_LENGTH) {
    return `${endpoint.field}:${name.slice(0, MAX_LOOKUP_LENGTH)}`;
  }

  const [account] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user[endpoint.field], name))
    .limit(1);

  return account ? `user:${account.id}` : `${endpoint.field}:${name}`;
}
