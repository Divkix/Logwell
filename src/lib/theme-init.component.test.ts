import { createInitialModeExpression } from "mode-watcher";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import appHtml from "../app.html?raw";

// app.html inlines the pre-paint theme script (it is the only place that can carry the CSP
// nonce) instead of letting <ModeWatcher> inject mode-watcher's own copy. Both must leave the
// document and storage in the same state, or the theme flips once ModeWatcher hydrates.
const inlined = /<script nonce="%sveltekit\.nonce%" id="theme-init">([\s\S]*?)<\/script>/.exec(
  appHtml,
);

function run(source: string): void {
  // oxlint-disable-next-line typescript/no-implied-eval -- executes the inline script under test
  new Function(source)();
}

function snapshot() {
  const root = document.documentElement;

  return {
    classes: [...root.classList].sort(),
    colorScheme: root.style.colorScheme,
    theme: root.getAttribute("data-theme"),
    mode: localStorage.getItem("mode-watcher-mode"),
    storedTheme: localStorage.getItem("mode-watcher-theme"),
  };
}

describe("app.html theme-init script", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function stateAfter(
    source: string,
    storedMode: string | null,
    storedTheme: string | null,
    prefersLight: boolean,
  ) {
    const root = document.documentElement;
    root.className = "";
    root.removeAttribute("style");
    root.removeAttribute("data-theme");
    localStorage.clear();

    if (storedMode !== null) localStorage.setItem("mode-watcher-mode", storedMode);

    if (storedTheme !== null) localStorage.setItem("mode-watcher-theme", storedTheme);

    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: prefersLight })),
    );

    run(source);

    return snapshot();
  }

  it("is present in app.html with the CSP nonce placeholder", () => {
    expect(inlined?.[1]).toBeTruthy();
  });

  const cases: Array<[string | null, string | null, boolean]> = [];

  for (const mode of [null, "system", "light", "dark"]) {
    for (const theme of [null, "contrast"]) {
      for (const prefersLight of [true, false]) cases.push([mode, theme, prefersLight]);
    }
  }

  it.each(cases)(
    "matches mode-watcher for stored mode %s, theme %s, prefers light %s",
    (mode, theme, prefersLight) => {
      const expected = stateAfter(createInitialModeExpression({}), mode, theme, prefersLight);

      expect(stateAfter(inlined![1]!, mode, theme, prefersLight)).toEqual(expected);
    },
  );
});
