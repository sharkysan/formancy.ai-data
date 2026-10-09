import { defineConfig } from 'vitest/config'
import { coverage } from '../../vitest.coverage'

export default defineConfig({
  test: {
    // The test plane is support, not the package: it is never built, and
    // counting it would report the harness's coverage as the client's.
    coverage: { ...coverage, exclude: [...(coverage.exclude ?? []), 'src/test-*.ts'] },
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    // PostgreSQL and SQL Server, started once for every file (0003).
    globalSetup: ['src/test-databases.ts'],
    // The integration suites start PostgreSQL and SQL Server, as data-server's
    // end-to-end suite does; SQL Server's image is about a gigabyte and a half
    // on a machine that has never pulled it.
    testTimeout: 120_000,
    hookTimeout: 600_000,
  },
})
