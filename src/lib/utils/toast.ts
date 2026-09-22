import { type ExternalToast, toast } from "svelte-sonner";
import { z } from "zod";
import type { JsonValue } from "$lib/shared/schemas/json";

export function toastSuccess(message: string, options?: ExternalToast): void {
  toast.success(message, options);
}

export function toastError(error: JsonValue | Error, options?: ExternalToast): void {
  let message: string;

  if (error instanceof Error) {
    message = error.message;
  } else {
    const decoded = z.string().safeParse(error);
    message = decoded.success ? decoded.data : "An unexpected error occurred";
  }

  toast.error(message, options);
}
