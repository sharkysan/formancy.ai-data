import { defineConfig } from 'vitest/config'
import { coverage } from '../../vitest.coverage'
import { reporters } from '../../vitest.results'

export default defineConfig({
  test: {
    reporters,
    // A `cli.ts` is a composition root, as `main.ts` is elsewhere: it writes
    // what a tested function returns, and the image's build is what runs it.
    coverage: { ...coverage, exclude: [...(coverage.exclude ?? []), 'src/**/cli.ts'] },
    include: ['src/**/*.test.ts'],
    // The integration file starts PostgreSQL through testcontainers; the hook
    // covers pulling postgres:17-alpine on a machine that has never run it,
    // as data-postgres's does.
    testTimeout: 120_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
})
