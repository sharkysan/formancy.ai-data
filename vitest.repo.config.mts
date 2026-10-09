import { defineConfig } from 'vitest/config'
import { reporters } from './vitest.results'

/**
 * The repository's own guards: checks on the files that describe the repository
 * rather than on a package. codecov.yml matches its generator, every CLA
 * signature names the current text, upstream dependencies are exact releases,
 * and no source file is past the size budget CLAUDE.md sets.
 *
 * Run as `pnpm test:repo`, and by CI on every pull request. A guard that is not
 * a gate is a comment.
 */
export default defineConfig({
  test: {
    reporters,
    include: ['scripts/**/*.test.mjs'],
  },
})
