import { defineConfig, mergeConfig } from 'vitest/config'
import { coverage } from '../../vitest.coverage'
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
      coverage: {
        ...coverage,
        // The shared policy counts `.ts`; this is the one workspace member with
        // `.tsx`, and a component no test reaches is exactly what it should see.
        // `main.tsx` is the composition root the shared policy already excludes
        // as `main.ts`, for the same reason.
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts', 'src/main.tsx', 'src/test-setup.ts'],
      },
      setupFiles: ['src/test-setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
      // Both renderers mount into jsdom, and Angular bootstraps a whole
      // application per preview. Measured on 2026-10-09 on a Windows 11
      // workstation: the slowest case, tabbing through all four previews, took
      // 2.8 seconds, and the default of five is less than twice that -- too
      // little margin for a loaded CI runner. The waits inside the tests allow
      // ten seconds for Angular to arrive, so this is above them.
      testTimeout: 20_000,
    },
  }),
)
