import { describe, expect, it } from "vite-plus/test";
import { FORM_ELEMENTS, SHORTCUTS, shouldBlockShortcut } from "./keyboard";

function createMockKeyboardEvent(options: {
  targetTagName?: string | null;
  isComposing?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}): KeyboardEvent {
  const {
    targetTagName = "DIV",
    isComposing = false,
    ctrlKey = false,
    altKey = false,
    metaKey = false,
  } = options;

  return {
    target: targetTagName === null ? null : { tagName: targetTagName },
    isComposing,
    ctrlKey,
    altKey,
    metaKey,
  } as unknown as KeyboardEvent;
}

describe("shouldBlockShortcut", () => {
  it.each([
    [{ targetTagName: "INPUT" }, "form input"],
    [{ targetTagName: "TEXTAREA" }, "form textarea"],
    [{ targetTagName: "SELECT" }, "form select"],
    [{ isComposing: true }, "IME composition"],
    [{ ctrlKey: true }, "ctrl"],
    [{ altKey: true }, "alt"],
    [{ metaKey: true }, "meta"],
    [{ ctrlKey: true, altKey: true }, "multiple modifiers"],
  ] as [Parameters<typeof createMockKeyboardEvent>[0], string][])(
    "blocks shortcut (%s)",
    (options) => {
      expect(shouldBlockShortcut(createMockKeyboardEvent(options))).toBe(true);
    },
  );

  it.each([["DIV"], ["TABLE"], ["BUTTON"], ["BODY"]])("allows shortcut for %s target", (tag) => {
    expect(shouldBlockShortcut(createMockKeyboardEvent({ targetTagName: tag }))).toBe(false);
  });

  it("handles null target gracefully", () => {
    expect(shouldBlockShortcut(createMockKeyboardEvent({ targetTagName: null }))).toBe(false);
  });
});

describe("FORM_ELEMENTS", () => {
  it("contains exactly INPUT, TEXTAREA, and SELECT", () => {
    expect(FORM_ELEMENTS).toEqual(["INPUT", "TEXTAREA", "SELECT"]);
  });
});

describe("SHORTCUTS", () => {
  it("covers navigation, search, and other groups with required shape", () => {
    const keys = SHORTCUTS.map((s) => s.key);
    for (const key of ["j", "k", "Enter", "/", "Esc", "l", "?"]) {
      expect(keys).toContain(key);
    }
    for (const shortcut of SHORTCUTS) {
      expect(typeof shortcut.key).toBe("string");
      expect(typeof shortcut.description).toBe("string");
      expect(["navigation", "search", "other"]).toContain(shortcut.group);
    }
    for (const group of ["navigation", "search", "other"]) {
      expect(SHORTCUTS.some((s) => s.group === group)).toBe(true);
    }
  });
});
