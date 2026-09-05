import { cleanup } from "@testing-library/svelte";
import { afterEach } from "vite-plus/test";

afterEach(() => {
  cleanup();
});
