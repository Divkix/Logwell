import path from 'node:path';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, './src/lib'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,ts}', 'tests/**/*.{test,spec}.{js,ts}'],
    exclude: ['node_modules', '.svelte-kit', 'build', 'tests/e2e/**'],
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.unit.test.ts'],
          environment: 'node',
          globals: true,
          setupFiles: ['./tests/setup.ts'],
        },
      },
      {
        resolve: {
          alias: {
            $lib: path.resolve(__dirname, './src/lib'),
          },
        },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.integration.test.ts', 'scripts/**/*.test.ts'],
          environment: 'node',
          globals: true,
          setupFiles: ['./tests/setup.ts'],
        },
      },
      {
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
          globals: true,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.{js,ts,svelte}'],
      exclude: [
        'src/**/*.spec.{js,ts}',
        'src/**/*.test.{js,ts}',
        'src/app.d.ts',
        'src/app.html',
        '**/*.config.{js,ts}',
        '**/node_modules/**',
        '**/.svelte-kit/**',
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
