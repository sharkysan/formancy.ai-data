import { defineConfig } from 'vitest/config'
import { coverage } from '../../vitest.coverage'
import { reporters } from '../../vitest.results'

export default defineConfig({
  test: {
    reporters,
    coverage,
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    // The end-to-end suite starts PostgreSQL and SQL Server; SQL Server's image
    // is about a gigabyte and a half on a machine that has never pulled it.
    testTimeout: 120_000,
    hookTimeout: 600_000,
  },
})
