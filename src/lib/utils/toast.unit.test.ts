import * as sonner from 'svelte-sonner';
import { describe, expect, it, vi } from 'vitest';

// Mock svelte-sonner
vi.mock('svelte-sonner', () => ({
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
import { showToast, toastError, toastInfo, toastSuccess, toastWarning } from './toast';

describe('Toast Utility', () => {
  describe('showToast', () => {
    it('calls toast.success for success type', () => {
      showToast('success', 'Success message');
      expect(sonner.toast.success).toHaveBeenCalledWith('Success message', undefined);
    });

    it('calls toast.error for error type', () => {
      showToast('error', 'Error message');
      expect(sonner.toast.error).toHaveBeenCalledWith('Error message', undefined);
    });

    it('calls toast.info for info type', () => {
      showToast('info', 'Info message');
      expect(sonner.toast.info).toHaveBeenCalledWith('Info message', undefined);
    });

    it('calls toast.warning for warning type', () => {
      showToast('warning', 'Warning message');
      expect(sonner.toast.warning).toHaveBeenCalledWith('Warning message', undefined);
    });

    it('passes options to toast function', () => {
      const options = { duration: 5000, description: 'More details' };
      showToast('success', 'Success', options);
      expect(sonner.toast.success).toHaveBeenCalledWith('Success', options);
    });
  });

  describe('toastSuccess', () => {
    it('calls toast.success with message', () => {
      toastSuccess('Operation completed');
      expect(sonner.toast.success).toHaveBeenCalledWith('Operation completed', undefined);
    });

    it('passes options to toast.success', () => {
      toastSuccess('Done', { duration: 3000 });
      expect(sonner.toast.success).toHaveBeenCalledWith('Done', { duration: 3000 });
    });
  });

  describe('toastError', () => {
    it('calls toast.error with message', () => {
      toastError('Something went wrong');
      expect(sonner.toast.error).toHaveBeenCalledWith('Something went wrong', undefined);
    });

    it('extracts message from Error object', () => {
      toastError(new Error('Database connection failed'));
      expect(sonner.toast.error).toHaveBeenCalledWith('Database connection failed', undefined);
    });

    it('uses fallback message for unknown error types', () => {
      toastError({ foo: 'bar' });
      expect(sonner.toast.error).toHaveBeenCalledWith('An unexpected error occurred', undefined);
    });
  });

  describe('toastInfo', () => {
    it('calls toast.info with message', () => {
      toastInfo('FYI');
      expect(sonner.toast.info).toHaveBeenCalledWith('FYI', undefined);
    });
  });

  describe('toastWarning', () => {
    it('calls toast.warning with message', () => {
      toastWarning('Be careful');
      expect(sonner.toast.warning).toHaveBeenCalledWith('Be careful', undefined);
    });
  });
});
