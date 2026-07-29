import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
  },
  // NodeNext sources import with explicit .js extensions; map them back to .ts for Vitest.
  resolve: {
    extensionAlias: { '.js': ['.ts', '.js'] },
  },
});
