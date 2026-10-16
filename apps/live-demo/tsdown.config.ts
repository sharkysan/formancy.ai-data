import { defineConfig } from 'tsdown'

export default defineConfig({
  // Programs and no library. Named entries, so each lands at the path the
  // image's Dockerfile runs: `dist/data/cli.mjs` writes the demo's SQL.
  entry: { 'data/cli': 'src/data/cli.ts' },
  format: ['esm'],
  dts: false,
  clean: true,
  // Nothing from node_modules is inlined (0046), as in every package: an
  // undeclared run-time import fails the build instead of being copied in.
  deps: { onlyBundle: [] },
})
