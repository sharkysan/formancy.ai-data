import { defineConfig } from 'tsdown'

export default defineConfig({
  // Programs and no library. Named entries, so each lands at the path the
  // image's Dockerfile runs: `dist/data/cli.mjs` writes the demo's SQL, and
  // `dist/image/cli.mjs` publishes the demo's forms at the image's build.
  entry: { 'data/cli': 'src/data/cli.ts', 'image/cli': 'src/image/cli.ts' },
  format: ['esm'],
  dts: false,
  clean: true,
  // Nothing from node_modules is inlined (0046), as in every package: an
  // undeclared run-time import fails the build instead of being copied in.
  // The publish CLI imports @formancy/data-core, a dependency, so the
  // image's `pnpm deploy --prod` of this package carries it.
  deps: { onlyBundle: [] },
})
