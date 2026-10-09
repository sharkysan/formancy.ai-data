import { defineConfig, mergeConfig } from 'vitest/config'
import { coverage } from '../../vitest.coverage'
import app from './vite.config.ts'

/**
 * The suite runs through the same plugins the build does, merged rather than
 * restated, as the examples page does and for its reason: a test copy without
 * the Angular plugin fails every file that mounts Angular with "needs to be
 * compiled using the JIT compiler".
 */
export default mergeConfig(
  app,
  defineConfig({
    test: {
      coverage: {
        ...coverage,
        // `.tsx` counts, as in the examples and the studio. `main.tsx` is the
        // composition root the shared policy excludes as `main.ts`. The
        // `test-` files are the suite's own support -- the databases, the real
        // server behind a fake fetch, the accessibility queries -- which is
        // test code.
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts', 'src/main.tsx', 'src/test-*.{ts,tsx}'],
      },
      setupFiles: ['src/test-setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
      // PostgreSQL and SQL Server, started once for every file (0003, 0029):
      // what stale is, whether a selection is still a customer and what a
      // tenant's lookup offers are database answers.
      globalSetup: ['src/test-databases.ts'],
      // Each test drives both renderers against the real server and a real
      // database. Measured on 2026-10-09 on a Windows 11 workstation with
      // both images pulled: the slowest test, the accessibility floor over
      // six states, took 5.5 s, and 11.3 s under coverage, which is how CI
      // runs it; the whole suite 65 s with coverage. The studio's suite
      // measured a spread of up to five times on CI's hosted runner (PR #27),
      // which would put this one near a minute, so it gets the client
      // suite's two: room for that spread without hiding a test that hangs.
      // The waits inside allow fifteen seconds for Angular to arrive.
      testTimeout: 120_000,
      // Starting both containers, and pulling SQL Server's image of about a
      // gigabyte and a half on a machine that has never pulled it.
      hookTimeout: 600_000,
    },
  }),
)
