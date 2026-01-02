import { type ExternalToast, toast } from 'svelte-sonner';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

/**
 * Show a toast notification with the specified type
 */
export function showToast(type: ToastType, message: string, options?: ExternalToast): void {
  toast[type](message, options);
}

/**
 * Show a success toast notification
 */
export function toastSuccess(message: string, options?: ExternalToast): void {
  toast.success(message, options);
}

/**
 * Show an error toast notification
 * Accepts string, Error object, or unknown error
 */
export function toastError(error: string | Error | unknown, options?: ExternalToast): void {
  let message: string;

  if (typeof error === 'string') {
    message = error;
  } else if (error instanceof Error) {
    message = error.message;
  } else {
    message = 'An unexpected error occurred';
  }

  toast.error(message, options);
}

/**
 * Show an info toast notification
 */
export function toastInfo(message: string, options?: ExternalToast): void {
  toast.info(message, options);
}

/**
 * Show a warning toast notification
 */
export function toastWarning(message: string, options?: ExternalToast): void {
  toast.warning(message, options);
}
