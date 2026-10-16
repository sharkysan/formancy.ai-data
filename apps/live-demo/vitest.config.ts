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
  },
})
