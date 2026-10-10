import { defineConfig } from 'vitest/config'
import { coverage } from '../../vitest.coverage'
import { reporters } from '../../vitest.results'

/*
 * The hook timeout is derived, not chosen (0034, P6). The harness test's
 * `beforeAll` is the whole smoke run: it may pull SQL Server's image on a
 * machine that has never had it -- the 600 s data-fixtures and
 * data-sqlserver allow a hook for that pull -- then starts both databases, loads the sized customers into each
 * one after the other, and runs the harness. On top of the pull allowance,
 * twice the load seconds of both engines.
 *
 * LOAD_SECONDS are the local measurement (P6: 35.4 s on PostgreSQL and 15.2 s
 * on SQL Server, the slowest of three loads each, 2026-10-09, on a Docker
 * Sandbox VM on a Windows 11 workstation) until this package's first CI job
 * measures them. The rest of the smoke run took about a minute there, inside
 * the pull allowance when the image is already present.
 */
const PULL_SECONDS = 600
const LOAD_SECONDS = { postgres: 35.4, sqlserver: 15.2 }
const HOOK_SECONDS = Math.ceil(PULL_SECONDS + 2 * (LOAD_SECONDS.postgres + LOAD_SECONDS.sqlserver))

export default defineConfig({
  test: {
    reporters,
    // The three programs are composition roots, as main.ts is elsewhere: what
    // they wire is run by `pnpm performance`, not by a suite, and the
    // modules they call are tested on their own. The test files' support is
    // not the package.
    coverage: { ...coverage, exclude: [...(coverage.exclude ?? []), 'src/test-*.ts', 'src/measure.ts', 'src/render-cli.ts', 'src/calibrate.ts'] },
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    testTimeout: 120_000,
    hookTimeout: HOOK_SECONDS * 1000,
    // One integration file, and it loads a million customers into each engine.
    fileParallelism: false,
  },
})
