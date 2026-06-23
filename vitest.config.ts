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
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["src/**/*.{test,spec}.{js,ts}", "tests/**/*.{test,spec}.{js,ts}"],
    exclude: ["node_modules", ".svelte-kit", "build", "tests/e2e/**"],
    projects: [
      {
        define: {
          __APP_VERSION__: JSON.stringify(pkg.version),
        },
        test: {
          name: "unit",
          include: ["src/**/*.unit.test.ts"],
          environment: "node",
          globals: true,
          setupFiles: ["./tests/setup.ts"],
        },
      },
      {
        define: {
          __APP_VERSION__: JSON.stringify(pkg.version),
        },
        resolve: {
          alias: {
            $lib: path.resolve(__dirname, "./src/lib"),
          },
        },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.integration.test.ts", "scripts/**/*.test.ts"],
          environment: "node",
          globals: true,
          setupFiles: ["./tests/setup.ts"],
        },
      },
      {
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
          name: "component",
          include: ["src/**/*.component.test.ts"],
          environment: "jsdom",
          globals: true,
          setupFiles: ["./tests/setup.ts"],
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
      thresholds: {
        lines: 75,
        statements: 75,
        functions: 75,
        branches: 65,
      },
    },
  },
});
