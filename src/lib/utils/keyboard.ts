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

export function shouldBlockShortcut(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;

  if (target && FORM_ELEMENTS.includes(target.tagName as (typeof FORM_ELEMENTS)[number])) {
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
