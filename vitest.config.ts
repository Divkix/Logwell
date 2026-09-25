import path from "node:path";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";
import pkg from "./package.json";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, "./src/lib"),
    },
  },
  test: {
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
    // Vitest v4 compatibility: keep separate Vite servers for inline projects.
    // Remove when plugins and config hooks can run once for shared projects.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#inline-projects-share-the-vite-server-by-default
    sharedViteServer: false,
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["src/**/*.{test,spec}.{js,ts}", "tests/**/*.{test,spec}.{js,ts}"],
    exclude: ["node_modules", ".svelte-kit", "build", "tests/e2e/**"],
    projects: [
      {
        // Vitest v4 compatibility: keep this inline project independent of the root config.
        // Remove to inherit root options, including plugins and setup files.
        // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
        // https://vitest.dev/guide/migration/#inline-projects-inherit-the-root-config-by-default
        extends: false,
        define: {
          __APP_VERSION__: JSON.stringify(pkg.version),
        },
        test: {
          // Vitest v4 compatibility: preserve mock call history.
          // Remove after tests no longer rely on calls from setup or earlier tests.
          // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
          // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
          clearMocks: false,
          name: "unit",
          include: ["src/**/*.unit.test.ts"],
          environment: "node",
          globals: true,
          setupFiles: ["./tests/setup.ts"],
        },
      },
      {
        // Vitest v4 compatibility: keep this inline project independent of the root config.
        // Remove to inherit root options, including plugins and setup files.
        // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
        // https://vitest.dev/guide/migration/#inline-projects-inherit-the-root-config-by-default
        extends: false,
        define: {
          __APP_VERSION__: JSON.stringify(pkg.version),
        },
        resolve: {
          alias: {
            $lib: path.resolve(__dirname, "./src/lib"),
          },
        },
        test: {
          // Vitest v4 compatibility: preserve mock call history.
          // Remove after tests no longer rely on calls from setup or earlier tests.
          // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
          // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
          clearMocks: false,
          name: "integration",
          include: ["tests/integration/**/*.integration.test.ts", "scripts/**/*.test.ts"],
          environment: "node",
          globals: true,
          setupFiles: ["./tests/setup.ts"],
        },
      },
      {
        // Vitest v4 compatibility: keep this inline project independent of the root config.
        // Remove to inherit root options, including plugins and setup files.
        // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
        // https://vitest.dev/guide/migration/#inline-projects-inherit-the-root-config-by-default
        extends: false,
        define: {
          __APP_VERSION__: JSON.stringify(pkg.version),
        },
        plugins: [tailwindcss(), sveltekit()],
        resolve: {
          alias: {
            $lib: path.resolve(__dirname, "./src/lib"),
          },
          conditions: ["browser"],
        },
        test: {
          // Vitest v4 compatibility: preserve mock call history.
          // Remove after tests no longer rely on calls from setup or earlier tests.
          // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
          // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
          clearMocks: false,
          name: "component",
          include: ["src/**/*.component.test.ts"],
          environment: "jsdom",
          globals: true,
          setupFiles: ["./tests/setup.ts", "./tests/setup-component.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: ["src/**/*.{js,ts,svelte}"],
      exclude: [
        "src/**/*.spec.{js,ts}",
        "src/**/*.test.{js,ts}",
        "src/app.d.ts",
        "src/app.html",
        "**/*.config.{js,ts}",
        "**/node_modules/**",
        "**/.svelte-kit/**",
        // E2E-tested routes and pages
        "src/routes/\\(app\\)/**",
        "src/routes/+layout.svelte",
        "src/routes/+error.svelte",
        "src/routes/login/**",
        "src/hooks.server.ts",
        // shadcn UI primitives (not our code to test)
        "src/lib/components/ui/**",
        // Type definitions and barrel exports (no logic)
        "src/lib/index.ts",
        "src/lib/types/**",
        "src/lib/shared/types.ts",
        "src/lib/auth-client.ts",
      ],
    },
  },
});
