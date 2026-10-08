import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'host', include: ['tests/unit/**/*.test.ts'], environment: 'node' } },
      {
        test: {
          name: 'webview',
          include: ['webview/src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
        },
      },
    ],
  },
});
