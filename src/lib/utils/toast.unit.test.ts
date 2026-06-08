import * as sonner from "svelte-sonner";
import { describe, expect, it, vi } from "vite-plus/test";

// Mock svelte-sonner
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

// Import after mocking
import { toastError, toastSuccess } from "./toast";

describe("Toast Utility", () => {
  describe("toastSuccess", () => {
    it("calls toast.success with message", () => {
      toastSuccess("Operation completed");
      expect(sonner.toast.success).toHaveBeenCalledWith("Operation completed", undefined);
    });

    it("passes options to toast.success", () => {
      toastSuccess("Done", { duration: 3000 });
      expect(sonner.toast.success).toHaveBeenCalledWith("Done", { duration: 3000 });
    });
  });

  describe("toastError", () => {
    it("calls toast.error with message", () => {
      toastError("Something went wrong");
      expect(sonner.toast.error).toHaveBeenCalledWith("Something went wrong", undefined);
    });

    it("extracts message from Error object", () => {
      toastError(new Error("Database connection failed"));
      expect(sonner.toast.error).toHaveBeenCalledWith("Database connection failed", undefined);
    });

    it("uses fallback message for unknown error types", () => {
      toastError({ foo: "bar" });
      expect(sonner.toast.error).toHaveBeenCalledWith("An unexpected error occurred", undefined);
    });
  });
});
