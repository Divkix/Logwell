import { describe, expect, it } from "vite-plus/test";
import { projectCreatePayloadSchema, projectUpdatePayloadSchema } from "./project";

describe("projectCreatePayloadSchema", () => {
  it.each([
    ["my-project", "hyphens"],
    ["my-awesome-project", "hyphens long"],
    ["my_awesome_project", "underscores"],
    ["a", "single char"],
    ["a".repeat(50), "exactly 50 chars"],
    ["project123", "alphanumeric"],
  ])("accepts name %s (%s)", (name) => {
    expect(projectCreatePayloadSchema.safeParse({ name }).success).toBe(true);
  });
});

describe("projectUpdatePayloadSchema with retentionDays", () => {
  it.each([
    [1, "min positive"],
    [3650, "max"],
  ])("accepts retentionDays %s (%s)", (retentionDays) => {
    expect(projectUpdatePayloadSchema.safeParse({ retentionDays }).success).toBe(true);
  });
});
