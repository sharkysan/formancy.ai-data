import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { thirdPartyNotices } from '../../scripts/third-party-notices.mjs'

/**
 * Where the data server is, for the dev server's proxy. Its own default port
 * unless the person running `pnpm dev` says otherwise.
 */
const SERVER = process.env['FORMANCY_DATA_SERVER'] ?? 'http://127.0.0.1:4390'

/**
 * The studio, built the way the examples page is: Vite and React, nothing else.
 *
 * `/v1` is proxied rather than called across origins. The data server sends no
 * CORS headers, and the studio needs none: it is served from the server's
 * origin -- behind one reverse proxy in a deployment, through this proxy in
 * development -- so every request it makes is same-origin (0024).
 */
export default defineConfig({
  // dist/THIRD-PARTY-NOTICES.txt: every package the build bundles, with the
  // licence and notice files it ships; a package with no licence text, or
  // code the plugin cannot place, stops the build (0046).
  plugins: [react(), thirdPartyNotices()],
  // Fail rather than wander to the next free port: an address nobody was told
  // about is worse than an error. 4390 is the server's, 4391 the examples'.
  server: { port: 4392, strictPort: true, proxy: { '/v1': SERVER } },
  preview: { port: 4392, strictPort: true, proxy: { '/v1': SERVER } },
  // Measured with `vite build` on 2026-10-10, with @formancy/* at 0.4.0: one
  // chunk of 720.7 kB minified, 195.4 kB gzipped -- the released renderer,
  // engine, spec validator and builder session; at 0.3.0 the same build was
  // 659.5 kB, and on 2026-10-09 625 kB. Loading the preview step on demand
  // took 70 kB off it, not worth a loading state (0024). The limit is the
  // latest measurement with a little room, so a dependency that grows the
  // bundle still warns.
  build: { chunkSizeWarningLimit: 760 },
})
