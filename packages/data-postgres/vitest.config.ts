import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { coverage } from '../../vitest.coverage'

export default defineConfig({
  resolve: {
    alias: {
      // The built fixture, as a devDependency would resolve it. See tsconfig.json
      // for why this is an alias today, and remove both together.
      '@formancy/data-fixtures': fileURLToPath(new URL('../data-fixtures/dist/index.mjs', import.meta.url)),
    },
  },
  test: {
    coverage,
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    // Container start dominates; the tests themselves are quick. The hook
    // timeout also covers pulling the image on a machine that has never run it.
    testTimeout: 120_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
})
