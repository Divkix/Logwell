// Stand-in for `$app/state` in component tests. The real module reads SvelteKit's
// client runtime, which jsdom never boots; these runes keep the same shape and stay
// reactive, so a test can drive a navigation by assigning `navigating.to`.
type NavigationTarget = { url: URL } | null;

export const navigating = $state<{ to: NavigationTarget; from: null; type: "goto" | null }>({
  to: null,
  from: null,
  type: null,
});

export const page = $state({ url: new URL("http://localhost/") });
