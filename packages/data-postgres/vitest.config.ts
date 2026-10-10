import { defineConfig } from 'vitest/config'
import { coverage } from '../../vitest.coverage'
import { reporters } from '../../vitest.results'

export default defineConfig({
  test: {
    reporters,
    coverage,
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    // Container start dominates; the tests themselves are quick. The hook
    // timeout also covers pulling the image on a machine that has never run
    // it, and in lookups-sized.integration.test.ts loading the sized
    // customers (0034, P6: about 35 s on the Docker Sandbox VM, 2026-10-09;
    // CI's seconds are 0034's to record).
    testTimeout: 120_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
})
