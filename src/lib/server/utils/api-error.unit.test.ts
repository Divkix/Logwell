import { describe, expect, it } from "vite-plus/test";
import { isUniqueViolation } from "./api-error";

/** Mirrors drizzle's DrizzleQueryError: query/params plus a non-enumerable `cause`. */
class DrizzleQueryError extends Error {
  query = "insert into project (id, name) values ($1, $2)";
  params: unknown[] = [];

  constructor(cause: unknown) {
    super("Failed query: insert into project (id, name) values ($1, $2)", { cause });
  }
}

function postgresError(fields: { code?: string; constraint_name?: string }): Error {
  return Object.assign(new Error("duplicate key value violates unique constraint"), fields);
}

describe("isUniqueViolation", () => {
  it("walks the ORM wrapper's cause chain to the driver error", () => {
    const error = new DrizzleQueryError(
      postgresError({ code: "23505", constraint_name: "uq_project_name_owner" }),
    );

    expect(isUniqueViolation(error, "uq_project_name_owner")).toBe(true);
  });

  it("ignores a unique violation on a different constraint", () => {
    const error = new DrizzleQueryError(
      postgresError({ code: "23505", constraint_name: "uq_api_key_hash" }),
    );

    expect(isUniqueViolation(error, "uq_project_name_owner")).toBe(false);
  });

  it("ignores errors that carry no unique-violation SQLSTATE", () => {
    expect(isUniqueViolation(new DrizzleQueryError(new Error("connection reset")))).toBe(false);
  });

  it("reports a violation when no constraint is required", () => {
    expect(isUniqueViolation(postgresError({ code: "23505" }), undefined)).toBe(true);
  });
});
