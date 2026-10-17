import { defineConfig } from 'vitest/config'
import { coverage } from '../../vitest.coverage'
import { reporters } from '../../vitest.results'

export default defineConfig({
  test: {
    reporters,
    // A `cli.ts` is a composition root, as `main.ts` is elsewhere: it writes
    // what a tested function returns, and the image's build is what runs it.
    // `worker.ts` is the Worker's: its Durable Object needs Cloudflare's
    // runtime and a container, which this suite does not run --
    // `pnpm test:live-demo` runs it over a stand-in, in front of the image
    // (its header says so) -- and everything it decides with is in worker/,
    // tested. And
    // `worker/pure.ts` is a barrel, excluded for vitest.coverage's reason.
    coverage: { ...coverage, exclude: [...(coverage.exclude ?? []), 'src/**/cli.ts', 'src/worker.ts', 'src/worker/pure.ts'] },
    include: ['src/**/*.test.ts'],
    // The integration file starts PostgreSQL through testcontainers; the hook
    // covers pulling postgres:17-alpine on a machine that has never run it,
    // as data-postgres's does.
    testTimeout: 120_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
})
