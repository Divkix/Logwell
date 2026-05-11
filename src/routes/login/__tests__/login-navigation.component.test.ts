import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Use vi.hoisted to ensure mock functions are hoisted with the vi.mock calls
const { mockGoto, mockInvalidateAll } = vi.hoisted(() => ({
  mockGoto: vi.fn().mockResolvedValue(undefined),
  mockInvalidateAll: vi.fn().mockResolvedValue(undefined),
}));

// Track the onSuccess callback from signIn
// biome-ignore lint/suspicious/noExplicitAny: Test mock - we don't care about the exact callback signature
let capturedOnSuccess: ((context?: any) => void | Promise<void>) | undefined;

// Mock $app/navigation module
vi.mock('$app/navigation', () => ({
  goto: mockGoto,
  invalidateAll: mockInvalidateAll,
}));

// Mock authClient with username-based authentication
vi.mock('$lib/auth-client', () => ({
  authClient: {
    signIn: {
      username: vi.fn().mockImplementation((_credentials, callbacks) => {
        capturedOnSuccess = callbacks?.onSuccess;
        return Promise.resolve({
          data: { user: { id: '1', username: 'admin' } },
          error: null,
        });
      }),
    },
  },
}));

// Import component after mocks are set up
import { authClient } from '$lib/auth-client';
import LoginPage from '../+page.svelte';

describe('Login Page Navigation', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnSuccess = undefined;
  });

  afterEach(() => {
    cleanup();
  });

  describe('onSuccess callback navigation', () => {
    it('should call invalidateAll before goto on successful login', async () => {
      render(LoginPage);

      // Fill in the form with username (not email)
      const usernameInput = screen.getByLabelText(/username/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /sign in/i });

      await user.clear(usernameInput);
      await user.type(usernameInput, 'admin');
      await user.type(passwordInput, 'password123');
      await user.click(submitButton);

      // Wait for the sign in to be called
      await waitFor(() => {
        expect(authClient.signIn.username).toHaveBeenCalledTimes(1);
      });

      // Verify onSuccess callback was captured
      expect(capturedOnSuccess).toBeDefined();

      // Trigger the onSuccess callback (simulating successful login)
      await capturedOnSuccess?.();

      // Verify invalidateAll is called (may be called multiple times if both onSuccess and fallback fire)
      expect(mockInvalidateAll).toHaveBeenCalled();

      // Verify goto is called with '/'
      expect(mockGoto).toHaveBeenCalledWith('/');

      // Verify the order: invalidateAll should complete before goto
      const invalidateCallOrder = mockInvalidateAll.mock.invocationCallOrder[0];
      const gotoCallOrder = mockGoto.mock.invocationCallOrder[0];
      expect(invalidateCallOrder).toBeLessThan(gotoCallOrder);
    });

    it('should use goto instead of window.location.href for navigation', async () => {
      // This test verifies that goto is used instead of window.location.href
      render(LoginPage);

      // Fill in the form with username
      const usernameInput = screen.getByLabelText(/username/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /sign in/i });

      await user.clear(usernameInput);
      await user.type(usernameInput, 'admin');
      await user.type(passwordInput, 'password123');
      await user.click(submitButton);

      // Wait for the sign in to be called
      await waitFor(() => {
        expect(authClient.signIn.username).toHaveBeenCalledTimes(1);
      });

      // Trigger the onSuccess callback
      await capturedOnSuccess?.();

      // Verify goto is called
      expect(mockGoto).toHaveBeenCalledWith('/');
    });
  });

  describe('fallback redirect when data.user exists', () => {
    it('should use invalidateAll + goto for fallback redirect', async () => {
      // Mock signIn to return user data
      // The fallback redirect happens when data.user exists after signIn completes
      vi.mocked(authClient.signIn.username).mockImplementationOnce(
        async (_credentials, callbacks) => {
          capturedOnSuccess = callbacks?.onSuccess;
          // Return data with user - the component checks this for fallback redirect
          return { data: { user: { id: '1', username: 'admin' } }, error: null };
        },
      );

      render(LoginPage);

      // Fill in the form with username
      const usernameInput = screen.getByLabelText(/username/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /sign in/i });

      await user.clear(usernameInput);
      await user.type(usernameInput, 'admin');
      await user.type(passwordInput, 'password123');
      await user.click(submitButton);

      // Wait for navigation to be triggered from the fallback path
      await waitFor(
        () => {
          expect(mockInvalidateAll).toHaveBeenCalled();
        },
        { timeout: 2000 },
      );

      expect(mockGoto).toHaveBeenCalledWith('/');
    });
  });

  describe('Enter key submission', () => {
    it('should submit via form submission and not keydown handler', async () => {
      render(LoginPage);

      const usernameInput = screen.getByLabelText(/username/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const form = passwordInput.closest('form');

      expect(form).toBeTruthy();
      if (!form) {
        throw new Error('Login form not found');
      }

      await user.clear(usernameInput);
      await user.type(usernameInput, 'admin');
      await user.type(passwordInput, 'password123');

      passwordInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      expect(authClient.signIn.username).not.toHaveBeenCalled();

      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      await waitFor(() => {
        expect(authClient.signIn.username).toHaveBeenCalledTimes(1);
      });
    });
  });
});
