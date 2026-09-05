import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockGoto, mockInvalidateAll } = vi.hoisted(() => ({
  mockGoto: vi.fn().mockResolvedValue(undefined),
  mockInvalidateAll: vi.fn().mockResolvedValue(undefined),
}));

// oxlint-disable-next-line no-explicit-any -- Test mock - we don't care about the exact callback signature
let capturedOnSuccess: ((context?: any) => void | Promise<void>) | undefined;

vi.mock("$app/navigation", () => ({
  goto: mockGoto,
  invalidateAll: mockInvalidateAll,
}));

vi.mock("$lib/auth-client", () => ({
  authClient: {
    signIn: {
      username: vi.fn().mockImplementation((_credentials, callbacks) => {
        capturedOnSuccess = callbacks?.onSuccess;
        return Promise.resolve({
          data: { user: { id: "1", username: "admin" } },
          error: null,
        });
      }),
    },
  },
}));

import { authClient } from "$lib/auth-client";
import LoginPage from "../+page.svelte";

describe("Login Page Navigation", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnSuccess = undefined;
  });

  afterEach(() => {
    cleanup();
  });

  describe("onSuccess callback navigation", () => {
    it("should call invalidateAll before goto on successful login", async () => {
      render(LoginPage);

      const usernameInput = screen.getByLabelText(/username/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole("button", { name: /sign in/i });

      await user.clear(usernameInput);
      await user.type(usernameInput, "admin");
      await user.type(passwordInput, "password123");
      await user.click(submitButton);

      await waitFor(() => {
        expect(authClient.signIn.username).toHaveBeenCalledTimes(1);
      });

      expect(capturedOnSuccess).toBeDefined();

      await capturedOnSuccess?.();

      expect(mockInvalidateAll).toHaveBeenCalled();

      expect(mockGoto).toHaveBeenCalledWith("/");

      const invalidateCallOrder = mockInvalidateAll.mock.invocationCallOrder[0]!;
      const gotoCallOrder = mockGoto.mock.invocationCallOrder[0]!;
      expect(invalidateCallOrder).toBeLessThan(gotoCallOrder);
    });

    it("should use goto instead of window.location.href for navigation", async () => {
      render(LoginPage);

      const usernameInput = screen.getByLabelText(/username/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole("button", { name: /sign in/i });

      await user.clear(usernameInput);
      await user.type(usernameInput, "admin");
      await user.type(passwordInput, "password123");
      await user.click(submitButton);

      await waitFor(() => {
        expect(authClient.signIn.username).toHaveBeenCalledTimes(1);
      });

      await capturedOnSuccess?.();

      expect(mockGoto).toHaveBeenCalledWith("/");
    });
  });

  describe("fallback redirect when data.user exists", () => {
    it("should use invalidateAll + goto for fallback redirect", async () => {
      vi.mocked(authClient.signIn.username).mockImplementationOnce(
        async (_credentials, callbacks) => {
          capturedOnSuccess = callbacks?.onSuccess;
          return { data: { user: { id: "1", username: "admin" } }, error: null };
        },
      );

      render(LoginPage);

      const usernameInput = screen.getByLabelText(/username/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole("button", { name: /sign in/i });

      await user.clear(usernameInput);
      await user.type(usernameInput, "admin");
      await user.type(passwordInput, "password123");
      await user.click(submitButton);

      await waitFor(
        () => {
          expect(mockInvalidateAll).toHaveBeenCalled();
        },
        { timeout: 2000 },
      );

      expect(mockGoto).toHaveBeenCalledWith("/");
    });
  });

  describe("Enter key submission", () => {
    it("should submit via form submission and not keydown handler", async () => {
      render(LoginPage);

      const usernameInput = screen.getByLabelText(/username/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const form = passwordInput.closest("form");

      expect(form).toBeTruthy();
      if (!form) {
        throw new Error("Login form not found");
      }

      await user.clear(usernameInput);
      await user.type(usernameInput, "admin");
      await user.type(passwordInput, "password123");

      passwordInput.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
      expect(authClient.signIn.username).not.toHaveBeenCalled();

      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

      await waitFor(() => {
        expect(authClient.signIn.username).toHaveBeenCalledTimes(1);
      });
    });
  });
});
