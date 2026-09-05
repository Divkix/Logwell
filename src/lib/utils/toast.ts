import { type ExternalToast, toast } from "svelte-sonner";

export function toastSuccess(message: string, options?: ExternalToast): void {
  toast.success(message, options);
}

export function toastError(error: unknown, options?: ExternalToast): void {
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
