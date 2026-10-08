import { defineConfig } from 'vitest/config'
import { coverage } from '../../vitest.coverage'

export default defineConfig({
  test: {
    coverage,
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    // Container start dominates; the tests themselves are quick. SQL Server's
    // image is close to a gigabyte and a half and the server takes tens of
    // seconds to accept its first connection, so the hook timeout is generous:
    // it covers the pull on a machine that has never run it.
    testTimeout: 120_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
})
