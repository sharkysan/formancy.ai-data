import { defineConfig, mergeConfig } from 'vitest/config'
import { coverage } from '../../vitest.coverage'
import { reporters } from '../../vitest.results'
import app from './vite.config.ts'

/**
 * The suite runs through the same plugins the build does, merged rather than
 * restated: formancy.ai's playground kept two copies, and the first time the
 * test copy lacked the Angular plugin every file that mounted Angular failed
 * with "needs to be compiled using the JIT compiler".
 */
export default mergeConfig(
  app,
  defineConfig({
    test: {
      reporters,
      coverage: {
        ...coverage,
        // The shared policy counts `.ts`; this is the one workspace member with
        // `.tsx`, and a component no test reaches is exactly what it should see.
        // `main.tsx` is the composition root the shared policy already excludes
        // as `main.ts`, for the same reason. The two `test-` files are the
        // suite's own setup and queries: test code, which is not measured.
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts', 'src/main.tsx', 'src/test-setup.ts', 'src/test-accessible.ts', 'src/test-timing.ts'],
      },
      setupFiles: ['src/test-setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
      // Both renderers mount into jsdom, and Angular bootstraps a whole
      // application per preview. Measured on 2026-10-09: on a Windows 11
      // workstation the slowest case, tabbing through all four previews, took
      // 2.8 s, and 3.8 s under coverage; on CI's hosted runner, once the
      // client's and the host page's suites and their databases ran beside it,
      // it passed 20 s and timed out (PR #30), a spread the studio's suite
      // showed too (PR #27). Sixty leaves room for that spread without hiding a
      // test that hangs, and stays above the thirty seconds the waits inside
      // allow for Angular to arrive (src/test-timing.ts).
      testTimeout: 60_000,
    },
  }),
)
