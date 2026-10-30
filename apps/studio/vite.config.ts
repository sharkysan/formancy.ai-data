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
 * `/v1` is proxied rather than called across origins. The administrator's
 * plane answers no other origin (0060), and the studio needs none: it is
 * served from the server's origin -- behind one reverse proxy in a
 * deployment, through this proxy in development -- so every request it makes
 * is same-origin (0024).
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
  // Measured with `vite build` on 2026-10-30: one chunk of 908.7 kB
  // minified, 246.5 kB gzipped, with @formancy/* at 0.11.0, where main at
  // 78496ef, at 0.7.0, was 855.1 kB and 233.1 kB -- past the last limit,
  // which the studio's own code had outgrown since it was set, a warning
  // nobody reads. On 2026-10-22 it was 807.0 kB and 220.1 kB at 0.7.0, where
  // main at f7cb622, at 0.6.0, was 805.2 kB and 219.4 kB, as on 2026-10-18 at
  // 8b31cf5 against 797.1 kB and 217.1 kB at 0.5.0 -- the released renderer,
  // engine, spec validator and builder session, and since 0.5.0 the
  // renderers' words in English, German and French. The studio's own code
  // had grown it past the last limit before that: on 2026-10-11 it was
  // 754.7 kB at 0.5.0 and 730.1 kB at 0.4.0, on 2026-10-10 720.7 kB at 0.4.0
  // and 659.5 kB at 0.3.0, and on 2026-10-09 625 kB. Loading the preview
  // step on demand took 70 kB off it, not worth a loading state (0024). The
  // limit is the latest measurement with a little room, so a dependency that
  // grows the bundle still warns.
  build: { chunkSizeWarningLimit: 920 },
})
