import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";
import pkg from "./package.json";

// Agent tooling and vendored assets are not application source — never lint or
// format them. Oxfmt does not honor .gitignore: .claude/workflows/*.js are
// gitignored machine-generated Claude Code workflow scripts. Shared so the
// lint and fmt ignores cannot drift apart.
const agentAssetIgnores = [
  ".agent/**",
  ".agents/**",
  ".claude/**",
  ".codex/**",
  ".continue/**",
  ".cursor/**",
  ".gemini/**",
  ".husky/**",
  ".opencode/**",
  ".pi/**",
  ".roo/**",
  ".vite-hooks/**",
  ".windsurf/**",
  "tools/oxlint/anti-slop/**",
];

const isApp = process.cwd() === import.meta.dirname;

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: ["**/.svelte-kit/**", ...agentAssetIgnores],
  },
  lint: isApp
    ? {
        ignorePatterns: ["sdks/**", ...agentAssetIgnores],
        jsPlugins: [
          { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
          { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
        ],
        rules: {
          "vite-plus/prefer-vite-plus-imports": "error",
          "oxc/no-accumulating-spread": "error",
          "anti-slop/no-array-filter-map": "error",
          "anti-slop/no-chained-type-assertions": "error",
          "anti-slop/no-conditional-empty-object-spread": "error",
          "anti-slop/no-known-value-widening": "error",
          "anti-slop/no-module-mocking": "error",
          "anti-slop/no-object-parameters": "error",
          "anti-slop/no-reduce-accumulator-copy": "error",
          "anti-slop/no-reflect-apply": "error",
          "anti-slop/no-reflect-get": "error",
          "anti-slop/no-runtime-typeof": "error",
          "anti-slop/no-shape-in-symbol-names": "error",
          "anti-slop/no-unknown-parameters": "error",
          "anti-slop/no-unknown-returns": "error",
          "anti-slop/no-unknown-type-aliases": "error",
          "anti-slop/no-unsafe-dictionary-type": "error",
          "anti-slop/no-widen-then-assert": "error",
          "anti-slop/require-readable-spacing": "error",
          "anti-slop/require-safety-comment-for-type-assertion": "error",
        },
        options: { typeAware: true, typeCheck: true },
      }
    : { options: { typeAware: true, typeCheck: true } },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: isApp ? [tailwindcss(), sveltekit()] : [],
});
