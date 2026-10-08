import { defineConfig } from 'vitest/config'
import { coverage } from '../../vitest.coverage'

export default defineConfig({
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
