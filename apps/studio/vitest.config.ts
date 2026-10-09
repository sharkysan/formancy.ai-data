import { defineConfig, mergeConfig } from 'vitest/config'
import { coverage } from '../../vitest.coverage'
import app from './vite.config.ts'

/**
 * The suite runs through the same plugins the build does, merged rather than
 * restated, as the examples page does and for its reason.
 */
export default mergeConfig(
  app,
  defineConfig({
    test: {
      coverage: {
        ...coverage,
        // `.tsx` counts here as it does in the examples. `main.tsx` is the
        // composition root the shared policy excludes as `main.ts`. The
        // `test-` files are the suite's own support -- the real server behind
        // a fake fetch, the accessibility queries -- which is test code.
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts', 'src/main.tsx', 'src/test-*.{ts,tsx}'],
      },
      include: ['src/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
      setupFiles: ['src/test-setup.ts'],
      // Each journey test runs the real data server and every step of the
      // studio against it, with axe over each step. Measured on 2026-10-09:
      // on a Windows 11 workstation, under coverage, the longest -- the
      // journey with axe at every state 0030 added -- took 10.3 s alone and
      // more than 20 s with the server's suites and both database containers
      // running beside it; on CI's hosted runner, sharing two CPUs with all of
      // that, a policy test took 9 s on one run and passed 20 s on another
      // (PR #27). Sixty leaves room for that spread without hiding a hang.
      testTimeout: 60_000,
    },
  }),
)
