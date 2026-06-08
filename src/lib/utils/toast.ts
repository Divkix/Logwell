import { type ExternalToast, toast } from "svelte-sonner";

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

  if (typeof error === "string") {
    message = error;
  } else if (error instanceof Error) {
    message = error.message;
  } else {
    message = "An unexpected error occurred";
  }

  toast.error(message, options);
}
