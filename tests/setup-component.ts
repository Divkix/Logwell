import { cleanup } from "@testing-library/svelte";
import { afterEach } from "vite-plus/test";

// Rendered Svelte components are unmounted after each component test so state
// never leaks between cases. This lives in a component-only setup (not the
// shared tests/setup.ts) because importing @testing-library/svelte pulls a
// .svelte source file that the node-env unit/integration projects can't
// transform without the Svelte plugin.
afterEach(() => {
  cleanup();
});
