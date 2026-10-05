import { describe, expect, it } from "vite-plus/test";
import { shouldBlockShortcut } from "./keyboard";

function createMockKeyboardEvent(options: {
  targetTagName?: string | null;
  isComposing?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}) {
  const {
    targetTagName = "DIV",
    isComposing = false,
    ctrlKey = false,
    altKey = false,
    metaKey = false,
  } = options;

  const target =
    targetTagName === null ? null : Object.assign(new EventTarget(), { tagName: targetTagName });

  return { target, isComposing, ctrlKey, altKey, metaKey };
}

describe("shouldBlockShortcut", () => {
  it.each<[Parameters<typeof createMockKeyboardEvent>[0], boolean, string]>([
    [{ targetTagName: "INPUT" }, true, "form input"],
    [{ targetTagName: "TEXTAREA" }, true, "form textarea"],
    [{ targetTagName: "SELECT" }, true, "form select"],
    [{ isComposing: true }, true, "IME composition"],
    [{ ctrlKey: true }, true, "ctrl modifier"],
    [{ altKey: true }, true, "alt modifier"],
    [{ metaKey: true }, true, "meta modifier"],
    [{ targetTagName: "DIV" }, false, "plain element"],
    [{ targetTagName: "BUTTON" }, false, "button element"],
    [{ targetTagName: null }, false, "null target"],
  ])("shouldBlockShortcut(%o) returns %s (%s)", (options, expected) => {
    expect(shouldBlockShortcut(createMockKeyboardEvent(options))).toBe(expected);
  });
});
