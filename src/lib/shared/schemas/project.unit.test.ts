import { describe, expect, it } from "vite-plus/test";
import { projectCreatePayloadSchema, projectUpdatePayloadSchema } from "./project";

describe("projectCreatePayloadSchema", () => {
  it("should accept valid project name", () => {
    const payload = {
      name: "my-project",
    };

    const result = projectCreatePayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("my-project");
    }
  });

  it("should reject empty project name", () => {
    const payload = {
      name: "",
    };

    const result = projectCreatePayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("should reject project name over 50 characters", () => {
    const payload = {
      name: "a".repeat(51),
    };

    const result = projectCreatePayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("should accept project name with hyphens", () => {
    const payload = {
      name: "my-awesome-project",
    };

    const result = projectCreatePayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("my-awesome-project");
    }
  });

  it("should accept project name with underscores", () => {
    const payload = {
      name: "my_awesome_project",
    };

    const result = projectCreatePayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("my_awesome_project");
    }
  });

  it("should reject project name with special characters", () => {
    const payload = {
      name: "my-project@123",
    };

    const result = projectCreatePayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("should reject project name with spaces", () => {
    const payload = {
      name: "my project",
    };

    const result = projectCreatePayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("should accept single character project name", () => {
    const payload = {
      name: "a",
    };

    const result = projectCreatePayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("a");
    }
  });

  it("should accept project name with exactly 50 characters", () => {
    const payload = {
      name: "a".repeat(50),
    };

    const result = projectCreatePayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toHaveLength(50);
    }
  });

  it("should accept alphanumeric project name", () => {
    const payload = {
      name: "project123",
    };

    const result = projectCreatePayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("project123");
    }
  });
});

describe("projectUpdatePayloadSchema with retentionDays", () => {
  it("should accept null (system default)", () => {
    const payload = {
      retentionDays: null,
    };

    const result = projectUpdatePayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.retentionDays).toBe(null);
    }
  });

  it("should accept 0 (never delete)", () => {
    const payload = {
      retentionDays: 0,
    };

    const result = projectUpdatePayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.retentionDays).toBe(0);
    }
  });

  it("should accept positive integers 1-3650", () => {
    const testCases = [1, 30, 365, 1000, 3650];

    for (const days of testCases) {
      const payload = {
        retentionDays: days,
      };

      const result = projectUpdatePayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.retentionDays).toBe(days);
      }
    }
  });

  it("should reject negative numbers", () => {
    const payload = {
      retentionDays: -1,
    };

    const result = projectUpdatePayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("should reject non-integers (e.g., 3.5)", () => {
    const payload = {
      retentionDays: 3.5,
    };

    const result = projectUpdatePayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("should reject values > 3650", () => {
    const payload = {
      retentionDays: 3651,
    };

    const result = projectUpdatePayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("should allow omitting retentionDays (optional field)", () => {
    const payload = {
      name: "updated-project",
    };

    const result = projectUpdatePayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.retentionDays).toBeUndefined();
    }
  });

  it("should allow both name and retentionDays together", () => {
    const payload = {
      name: "updated-project",
      retentionDays: 30,
    };

    const result = projectUpdatePayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("updated-project");
      expect(result.data.retentionDays).toBe(30);
    }
  });
});
