import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createAuth } from "../../../src/lib/server/auth";
import type * as schema from "../../../src/lib/server/db/schema";
import { setupTestDatabase } from "../../../src/lib/server/db/test-db";
import { loginAccountKey, UNATTRIBUTED_LOGIN } from "../../../src/lib/server/utils/login-account";

const ORIGIN = "http://localhost:3000";

const PASSWORD = "CorrectHorse123!";

const WRONG_PASSWORD = "wrong-password";

function post(endpoint: string, body: BodyInit, contentType?: string): Request {
  const headers = new Headers({ Origin: ORIGIN });

  if (contentType) headers.set("Content-Type", contentType);

  return new Request(`${ORIGIN}/api/auth${endpoint}`, { method: "POST", headers, body });
}

/** Body fields besides the password; numbers stand in for wrongly typed values. */
type SignInFields = Record<string, string | number>;

function jsonSignIn(endpoint: string, fields: SignInFields): Request {
  return post(
    endpoint,
    JSON.stringify({ password: WRONG_PASSWORD, ...fields }),
    "application/json",
  );
}

function formSignIn(endpoint: string, fields: [string, string][]): Request {
  const body = new URLSearchParams([...fields, ["password", WRONG_PASSWORD]]);

  return post(endpoint, body.toString(), "application/x-www-form-urlencoded");
}

describe("loginAccountKey", () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;
  let auth: ReturnType<typeof createAuth>;
  let adminKey: string;

  beforeEach(async () => {
    ({ db, cleanup } = await setupTestDatabase());
    auth = createAuth(db);

    const { user } = await auth.api.signUpEmail({
      body: { name: "Admin", email: "admin@logwell.local", password: PASSWORD, username: "admin" },
    });

    adminKey = `user:${user.id}`;
  });

  afterEach(() => cleanup());

  const key = (request: Request) => loginAccountKey(db, request, new URL(request.url).pathname);

  // Each request guesses the admin's password in a way better-auth authenticates (a 401). The
  // key must be the admin's whatever endpoint, encoding or extra fields the guess uses.
  const guesses: [string, () => Request][] = [
    ["JSON username", () => jsonSignIn("/sign-in/username", { username: "admin" })],
    ["upper-case username", () => jsonSignIn("/sign-in/username", { username: "ADMIN" })],
    ["JSON email", () => jsonSignIn("/sign-in/email", { email: "admin@logwell.local" })],
    ["upper-case email", () => jsonSignIn("/sign-in/email", { email: "Admin@Logwell.Local" })],
    ["form-encoded email", () => formSignIn("/sign-in/email", [["email", "admin@logwell.local"]])],
    [
      "email with a decoy username",
      () => jsonSignIn("/sign-in/email", { email: "admin@logwell.local", username: "decoy-name" }),
    ],
    [
      "username with a non-string extra field",
      () => jsonSignIn("/sign-in/username", { username: "admin", email: 1 }),
    ],
    [
      "repeated form field (last one wins)",
      () =>
        formSignIn("/sign-in/email", [
          ["email", "decoy@logwell.local"],
          ["email", "admin@logwell.local"],
        ]),
    ],
  ];

  it.each(guesses)("charges a %s guess to the admin's account", async (_label, request) => {
    expect(await key(request())).toBe(adminKey);
    expect((await auth.handler(request())).status).toBe(401);
  });

  it("reads multipart bodies the way better-call does, should an endpoint accept them", async () => {
    const form = new FormData();
    form.append("email", "admin@logwell.local");
    form.append("password", WRONG_PASSWORD);

    expect(await key(post("/sign-in/email", form))).toBe(adminKey);
  });

  it("gives a name with no account its own key", async () => {
    expect(await key(jsonSignIn("/sign-in/username", { username: "Ghost" }))).toBe(
      "username:ghost",
    );
    expect(await key(jsonSignIn("/sign-in/email", { email: "ghost@x.dev" }))).toBe(
      "email:ghost@x.dev",
    );
  });

  // Bodies the endpoint cannot read as its string field share one bucket rather than skipping
  // the limit; better-auth rejects each of them before checking a password.
  const unreadable: [string, () => Request][] = [
    ["non-string username", () => jsonSignIn("/sign-in/username", { username: 1 })],
    ["missing email", () => jsonSignIn("/sign-in/email", { username: "admin" })],
    ["malformed JSON", () => post("/sign-in/username", "{", "application/json")],
    ["JSON array", () => post("/sign-in/username", "[]", "application/json")],
  ];

  it.each(unreadable)("charges a %s body to the shared bucket", async (_label, request) => {
    expect(await key(request())).toBe(UNATTRIBUTED_LOGIN);
    expect((await auth.handler(request())).status).not.toBe(401);
  });

  it("charges sign-in paths other than the password endpoints to the shared bucket", async () => {
    expect(await key(jsonSignIn("/sign-in/social", { username: "admin" }))).toBe(
      UNATTRIBUTED_LOGIN,
    );
  });

  it("leaves the request body readable for better-auth", async () => {
    const request = jsonSignIn("/sign-in/username", { username: "admin", password: PASSWORD });

    expect(await key(request)).toBe(adminKey);
    expect((await auth.handler(request)).status).toBe(200);
  });
});
