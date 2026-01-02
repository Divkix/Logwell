/**
 * Focus trap utility for modals and dialogs.
 * Implements WCAG 2.1 focus management requirements.
 */

export interface FocusTrapOptions {
  /**
   * Element that should receive focus when the trap is activated.
   * If not provided, the first focusable element will be focused.
   */
  initialFocus?: HTMLElement | string | null;

  /**
   * Element that should receive focus when the trap is deactivated.
   * If not provided, focus will return to the element that was focused
   * before the trap was activated.
   */
  returnFocus?: HTMLElement | null;

  /**
   * Whether to automatically focus the first focusable element.
   * @default true
   */
  autoFocus?: boolean;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Gets all focusable elements within a container.
 */
function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const elements = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  return Array.from(elements).filter((el) => {
    // Check if element is visible
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
  });
}

/**
 * Creates a focus trap for the given container element.
 * Returns cleanup functions for the trap.
 */
function createFocusTrap(container: HTMLElement, options: FocusTrapOptions = {}) {
  const { initialFocus, returnFocus, autoFocus = true } = options;

  // Store the previously focused element
  const previouslyFocused = (returnFocus || document.activeElement) as HTMLElement | null;

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Tab') return;

    const focusableElements = getFocusableElements(container);
    if (focusableElements.length === 0) return;

    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    if (event.shiftKey) {
      // Shift + Tab: if on first element, wrap to last
      if (document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      }
    } else {
      // Tab: if on last element, wrap to first
      if (document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    }
  }

  // Set initial focus
  function setInitialFocus() {
    if (!autoFocus) return;

    const focusableElements = getFocusableElements(container);
    if (focusableElements.length === 0) return;

    let elementToFocus: HTMLElement | null = null;

    if (typeof initialFocus === 'string') {
      elementToFocus = container.querySelector(initialFocus);
    } else if (initialFocus instanceof HTMLElement) {
      elementToFocus = initialFocus;
    } else {
      // Default to first focusable element
      elementToFocus = focusableElements[0];
    }

    if (elementToFocus) {
      // Use setTimeout(0) as it works better in both browser and JSDOM environments
      // than requestAnimationFrame which may not fire in tests
      setTimeout(() => {
        elementToFocus?.focus();
      }, 0);
    }
  }

  // Activate the trap
  container.addEventListener('keydown', handleKeyDown);
  setInitialFocus();

  // Return cleanup and restore focus functions
  return {
    /**
     * Deactivates the focus trap and restores focus to the previously focused element.
     */
    deactivate() {
      container.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    },

    /**
     * Updates the initial focus element and focuses it.
     */
    updateInitialFocus(element: HTMLElement | string | null) {
      if (typeof element === 'string') {
        const el = container.querySelector<HTMLElement>(element);
        el?.focus();
      } else if (element) {
        element.focus();
      }
    },
  };
}

/**
 * Svelte action for creating a focus trap on an element.
 * Usage: <div use:focusTrap={{ initialFocus: '.close-button' }}>
 */
export function focusTrap(node: HTMLElement, options: FocusTrapOptions = {}) {
  let trap = createFocusTrap(node, options);

  return {
    update(newOptions: FocusTrapOptions) {
      trap.deactivate();
      trap = createFocusTrap(node, newOptions);
    },
    destroy() {
      trap.deactivate();
    },
  };
}

/**
 * Announces a message to screen readers using a live region.
 * @param message The message to announce
 * @param priority 'polite' for non-urgent, 'assertive' for important announcements
 */
export function announceToScreenReader(
  message: string,
  priority: 'polite' | 'assertive' = 'polite',
) {
  // Look for existing live region or create one
  let liveRegion = document.getElementById('sr-announcer');

  if (!liveRegion) {
    liveRegion = document.createElement('div');
    liveRegion.id = 'sr-announcer';
    liveRegion.setAttribute('aria-live', priority);
    liveRegion.setAttribute('aria-atomic', 'true');
    liveRegion.className = 'sr-only';
    liveRegion.style.cssText =
      'position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;';
    document.body.appendChild(liveRegion);
  }

  // Update priority if needed
  liveRegion.setAttribute('aria-live', priority);

  // Clear and set message (necessary for repeat announcements)
  liveRegion.textContent = '';
  requestAnimationFrame(() => {
    if (liveRegion) {
      liveRegion.textContent = message;
    }
  });
}
