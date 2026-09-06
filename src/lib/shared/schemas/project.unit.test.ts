import { describe, expect, it } from "vite-plus/test";
import { projectCreatePayloadSchema, projectUpdatePayloadSchema } from "./project";

describe("projectCreatePayloadSchema", () => {
  it.each([
    ["my-project", true, "hyphens"],
    ["my-awesome-project", true, "hyphens long"],
    ["my_awesome_project", true, "underscores"],
    ["a", true, "single char"],
    ["a".repeat(50), true, "exactly 50 chars"],
    ["project123", true, "alphanumeric"],
    ["", false, "empty"],
    ["a".repeat(51), false, "over 50 chars"],
    ["my-project@123", false, "special chars"],
    ["my project", false, "spaces"],
  ])("name %s valid=%s (%s)", (name, valid) => {
    expect(projectCreatePayloadSchema.safeParse({ name }).success).toBe(valid);
  });
});

describe("projectUpdatePayloadSchema with retentionDays", () => {
  it.each([
    [null, true, "system default"],
    [0, true, "never delete"],
    [1, true, "min positive"],
    [30, true, "typical"],
    [3650, true, "max"],
    [-1, false, "negative"],
    [3.5, false, "non-integer"],
    [3651, false, "over max"],
  ] as [number | null, boolean, string][])(
    "retentionDays %s valid=%s (%s)",
    (retentionDays, valid) => {
      expect(projectUpdatePayloadSchema.safeParse({ retentionDays }).success).toBe(valid);
    },
  );

  it("allows omitting retentionDays (optional field)", () => {
    const result = projectUpdatePayloadSchema.safeParse({ name: "updated-project" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.retentionDays).toBeUndefined();
  });

  it("allows both name and retentionDays together", () => {
    const result = projectUpdatePayloadSchema.safeParse({
      name: "updated-project",
      retentionDays: 30,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("updated-project");
      expect(result.data.retentionDays).toBe(30);
    }
  });
});
