import { defineConfig } from 'tsdown'

// Programs, and the Worker's parts for whoever stands in for Cloudflare.
// Named entries, so each lands at the path its reader names:
// `dist/data/cli.mjs` writes the demo's SQL and `dist/image/cli.mjs`
// publishes the demo's forms at the image's build (deploy/demo/Dockerfile);
// `dist/worker/pure.mjs`, with its declarations, is the package's
// `./worker` export, which the host page's tests, the image's gate and
// scripts/live-demo.mjs import.
const programs = defineConfig({
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

// The Worker itself, src/worker.ts, which Wrangler bundles from source when
// it deploys: built here too, to `dist/worker/cloudflare.mjs`, with
// `cloudflare:workers` left an import, for `pnpm test:live-demo`
// (scripts/live-demo-gate.mjs), which runs this very module -- its fetch and
// its DemoServer -- in front of the image, with Docker where Cloudflare's
// containers would be. No declarations: its types are the Workers runtime's,
// which tsconfig.worker.json checks it against, and nothing imports it but
// the gate.
const worker = defineConfig({
  entry: { 'worker/cloudflare': 'src/worker.ts' },
  format: ['esm'],
  dts: false,
  clean: false,
  deps: { onlyBundle: [], neverBundle: ['cloudflare:workers'] },
})

export default [programs, worker]
