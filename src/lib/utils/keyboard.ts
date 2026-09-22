import { z } from "zod";

export const FORM_ELEMENTS = ["INPUT", "TEXTAREA", "SELECT"] as const;

interface ShortcutDefinition {
  key: string;
  description: string;
  group: "navigation" | "search" | "other";
}

export const SHORTCUTS: ShortcutDefinition[] = [
  { key: "j", description: "Select next log", group: "navigation" },
  { key: "k", description: "Select previous log", group: "navigation" },
  { key: "Enter", description: "Open log details", group: "navigation" },

  { key: "/", description: "Focus search", group: "search" },
  { key: "Esc", description: "Blur search / Close modal", group: "search" },

  { key: "l", description: "Toggle live mode", group: "other" },
  { key: "?", description: "Show keyboard shortcuts", group: "other" },
];

const eventTargetSchema = z.object({ tagName: z.string() });

export function shouldBlockShortcut(
  event: Pick<KeyboardEvent, "target" | "isComposing" | "ctrlKey" | "altKey" | "metaKey">,
): boolean {
  const target = eventTargetSchema.safeParse(event.target);

  if (target.success && FORM_ELEMENTS.some((element) => element === target.data.tagName)) {
    return true;
  }

  if (event.isComposing) {
    return true;
  }

  if (event.ctrlKey || event.altKey || event.metaKey) {
    return true;
  }

  return false;
}
