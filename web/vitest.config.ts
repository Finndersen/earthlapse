import { availableParallelism } from 'node:os'
import path from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Every test file runs in a fresh worker process (`isolate`), and each jsdom one re-imports jsdom
// (~0.75 s of parsing here). Node's compile cache, inherited by the workers through the
// environment, keeps that bytecode across them and across runs.
process.env.NODE_COMPILE_CACHE ??= path.resolve(import.meta.dirname, 'node_modules/.cache/node-compile')

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
    // The run is CPU-bound in its workers, the main process all but idle: one worker per core
    // rather than Vitest's cores - 1.
    maxWorkers: availableParallelism(),
    // Transformed modules persist between runs (in node_modules/.vitest-cache).
    fsModuleCache: true,
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
