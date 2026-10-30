import { eslintConfig } from './scripts/code-style/code-style.mjs'

/**
 * The repository's lint rules: the four formancy repositories' shared ones,
 * `scripts/code-style/code-style.mjs`, a copy of what formancy.ai will
 * publish as `@formancy/code-style` until this repository pins it, given
 * Formancy Data's paths (0113). `scripts/lint.test.mjs` holds what is passed
 * here.
 */
export default eslintConfig({
  root: import.meta.dirname,
  // The tsconfigs `pnpm typecheck` runs, by glob, so that a new package or
  // app is linted with types without an edit here. The client's suites and
  // the live demo's Worker have a tsconfig of their own beside the one that
  // builds; tsconfig.tools.json brings the vitest, Vite and tsdown configs
  // into the typecheck.
  project: [
    './packages/*/tsconfig.json',
    './packages/data-client/tsconfig.test.json',
    './apps/*/tsconfig.json',
    './apps/live-demo/tsconfig.worker.json',
    './tsconfig.tools.json',
  ],
  ignoreFiles: ['.gitignore'],
  tests: ['**/*.{test,spec}.{ts,tsx,mts,cts,js,mjs}'],
  // The install fixtures import the packed tarballs, which the workspace
  // does not resolve; the install gate type-checks them, in the consumer
  // project that has them.
  untyped: ['scripts/install-fixture/**'],
  // The scripts that drive Playwright: the apps' browser gates and pictures.
  browser: ['apps/*/scripts/**', 'scripts/pictures/**', 'scripts/browser-gate.mjs'],
  react: ['apps/examples/**/*.{ts,tsx}', 'apps/host/**/*.{ts,tsx}', 'apps/studio/**/*.{ts,tsx}'],
})
