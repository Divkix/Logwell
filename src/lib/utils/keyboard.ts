/**
 * Keyboard utilities for handling global keyboard shortcuts.
 * Provides guard functions and shortcut definitions for the log viewer.
 */

/**
 * Form elements that should block keyboard shortcuts when focused.
 */
export const FORM_ELEMENTS = ['INPUT', 'TEXTAREA', 'SELECT'] as const;

/**
 * Shortcut definition for the help modal.
 */
interface ShortcutDefinition {
  key: string;
  description: string;
  group: 'navigation' | 'search' | 'other';
}

/**
 * All keyboard shortcuts available in the log viewer.
 * Used to render the help modal.
 */
export const SHORTCUTS: ShortcutDefinition[] = [
  // Navigation shortcuts
  { key: 'j', description: 'Select next log', group: 'navigation' },
  { key: 'k', description: 'Select previous log', group: 'navigation' },
  { key: 'Enter', description: 'Open log details', group: 'navigation' },

  // Search shortcuts
  { key: '/', description: 'Focus search', group: 'search' },
  { key: 'Esc', description: 'Blur search / Close modal', group: 'search' },

  // Other shortcuts
  { key: 'l', description: 'Toggle live mode', group: 'other' },
  { key: '?', description: 'Show keyboard shortcuts', group: 'other' },
];

/**
 * Determines whether a keyboard shortcut should be blocked.
 *
 * Returns true (block shortcut) when:
 * - The event target is a form element (INPUT, TEXTAREA, SELECT)
 * - The user is composing text (IME input for CJK languages)
 * - A modifier key is pressed (Ctrl, Alt, Meta/Cmd)
 *
 * @param event - The keyboard event to check
 * @returns true if the shortcut should be blocked, false otherwise
 */
export function shouldBlockShortcut(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;

  // Block if target is a form element
  if (target && FORM_ELEMENTS.includes(target.tagName as (typeof FORM_ELEMENTS)[number])) {
    return true;
  }

  // Block if user is composing (IME input for Japanese, Chinese, Korean, etc.)
  if (event.isComposing) {
    return true;
  }

  // Block if modifier keys are pressed (these are usually browser/system shortcuts)
  if (event.ctrlKey || event.altKey || event.metaKey) {
    return true;
  }

  return false;
}
