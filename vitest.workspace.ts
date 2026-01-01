import { defineProject } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';

export default [
  defineProject({
    plugins: [tailwindcss(), sveltekit()],
    test: {
      name: 'unit',
      include: ['src/**/*.unit.test.ts'],
      environment: 'node',
      globals: true,
      setupFiles: ['./tests/setup.ts'],
    },
  }),
  defineProject({
    plugins: [tailwindcss(), sveltekit()],
    test: {
      name: 'integration',
      include: ['tests/integration/**/*.integration.test.ts'],
      environment: 'node',
      globals: true,
      setupFiles: ['./tests/setup.ts'],
    },
  }),
  defineProject({
    plugins: [tailwindcss(), sveltekit()],
    test: {
      name: 'browser',
      include: ['src/**/*.browser.test.ts'],
      globals: true,
      setupFiles: ['./tests/setup.ts'],
    },
  }),
];
