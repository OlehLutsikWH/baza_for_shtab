import { defineConfig } from 'vitest/config';
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: { testTimeout: 60000, hookTimeout: 60000 },
} as any);
