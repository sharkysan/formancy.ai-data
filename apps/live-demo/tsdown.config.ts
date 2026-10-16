import { defineConfig } from 'tsdown'

export default defineConfig({
  // Programs, and the Worker's parts for whoever stands in for Cloudflare.
  // Named entries, so each lands at the path its reader names:
  // `dist/data/cli.mjs` writes the demo's SQL and `dist/image/cli.mjs`
  // publishes the demo's forms at the image's build (deploy/demo/Dockerfile);
  // `dist/worker/pure.mjs`, with its declarations, is the package's
  // `./worker` export, which the host page's tests and browser gate, the
  // image's gate and scripts/live-demo.mjs import. The Worker itself,
  // src/worker.ts, is not built here: Wrangler bundles it from source when
  // it deploys.
  entry: { 'data/cli': 'src/data/cli.ts', 'image/cli': 'src/image/cli.ts', 'worker/pure': 'src/worker/pure.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  // Nothing from node_modules is inlined (0046), as in every package: an
  // undeclared run-time import fails the build instead of being copied in.
  // The publish CLI imports @formancy/data-core, a dependency, so the
  // image's `pnpm deploy --prod` of this package carries it.
  deps: { onlyBundle: [] },
})
