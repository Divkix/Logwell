import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";
import pkg from "./package.json";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    // Oxfmt does not honor .gitignore; .claude/workflows/*.js are gitignored,
    // machine-generated Claude Code workflow scripts — don't format them.
    ignorePatterns: [".claude/**"],
  },
  lint: {
    // sdks/** is independently linted (sdks/typescript has its own vp check +
    // tsconfig + CI; go/python have their own tools). .claude/** is generated.
    ignorePatterns: ["sdks/**", ".claude/**"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [tailwindcss(), sveltekit()],
});
