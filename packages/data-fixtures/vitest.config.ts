import { defineConfig } from 'vitest/config'
import { coverage } from '../../vitest.coverage'

export default defineConfig({
  test: {
    coverage,
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    // Both containers start in one hook, and SQL Server's image is about a
    // gigabyte and a half on a machine that has never pulled it.
    testTimeout: 120_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
})
