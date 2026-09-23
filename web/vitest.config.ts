import path from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Most `.ts` suites are pure logic and run in plain node, which is several times cheaper per file
// than building a jsdom window. A `.ts` suite that needs the DOM opts in with a
// `// @vitest-environment jsdom` docblock on its first line; component suites (`.tsx`) always get jsdom.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    setupFiles: ['src/test/setup.ts'],
    projects: [
      {
        extends: true,
        test: { name: 'node', environment: 'node', include: ['src/**/*.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'dom', environment: 'jsdom', include: ['src/**/*.test.tsx'] },
      },
    ],
  },
})
