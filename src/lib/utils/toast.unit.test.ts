import * as sonner from "svelte-sonner";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("svelte-sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

import { toastError, toastSuccess } from "./toast";

describe("Toast Utility", () => {
  it("toastSuccess forwards message and options", () => {
    toastSuccess("Operation completed");
    expect(sonner.toast.success).toHaveBeenCalledWith("Operation completed", undefined);
    toastSuccess("Done", { duration: 3000 });
    expect(sonner.toast.success).toHaveBeenCalledWith("Done", { duration: 3000 });
  });

  it.each([
    ["Something went wrong", "Something went wrong", "plain message"],
    [new Error("Database connection failed"), "Database connection failed", "Error object"],
    [{ foo: "bar" }, "An unexpected error occurred", "unknown type fallback"],
  ] as [unknown, string, string][])("toastError(%s) shows %s (%s)", (input, expected) => {
    toastError(input as string);
    expect(sonner.toast.error).toHaveBeenCalledWith(expected, undefined);
  });
});
