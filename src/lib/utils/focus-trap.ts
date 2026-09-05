export interface FocusTrapOptions {
  initialFocus?: HTMLElement | string | null;

  returnFocus?: HTMLElement | null;

  autoFocus?: boolean;
}

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const elements = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  return Array.from(elements).filter((el) => {
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null;
  });
}

function createFocusTrap(container: HTMLElement, options: FocusTrapOptions = {}) {
  const { initialFocus, returnFocus, autoFocus = true } = options;

  const previouslyFocused = (returnFocus || document.activeElement) as HTMLElement | null;

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== "Tab") return;

    const focusableElements = getFocusableElements(container);
    if (focusableElements.length === 0) return;

    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    if (!firstFocusable || !lastFocusable) return;

    if (event.shiftKey) {
      if (document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      }
    } else {
      if (document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    }
  }

  function setInitialFocus() {
    if (!autoFocus) return;

    const focusableElements = getFocusableElements(container);
    if (focusableElements.length === 0) return;

    let elementToFocus: HTMLElement | null = null;

    if (typeof initialFocus === "string") {
      elementToFocus = container.querySelector(initialFocus);
    } else if (initialFocus instanceof HTMLElement) {
      elementToFocus = initialFocus;
    } else {
      elementToFocus = focusableElements[0] ?? null;
    }

    if (elementToFocus) {
      // Use setTimeout(0) as it works better in both browser and JSDOM environments
      // than requestAnimationFrame which may not fire in tests
      setTimeout(() => {
        elementToFocus?.focus();
      }, 0);
    }
  }

  container.addEventListener("keydown", handleKeyDown);
  setInitialFocus();

  return {
    deactivate() {
      container.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    },
  };
}

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

export function announceToScreenReader(
  message: string,
  priority: "polite" | "assertive" = "polite",
) {
  let liveRegion = document.getElementById("sr-announcer");

  if (!liveRegion) {
    liveRegion = document.createElement("div");
    liveRegion.id = "sr-announcer";
    liveRegion.setAttribute("aria-live", priority);
    liveRegion.setAttribute("aria-atomic", "true");
    liveRegion.className = "sr-only";
    liveRegion.style.cssText =
      "position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;";
    document.body.appendChild(liveRegion);
  }

  liveRegion.setAttribute("aria-live", priority);

  liveRegion.textContent = "";
  requestAnimationFrame(() => {
    if (liveRegion) {
      liveRegion.textContent = message;
    }
  });
}
