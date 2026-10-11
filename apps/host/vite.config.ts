import { fileURLToPath } from 'node:url'
import angular from '@analogjs/vite-plugin-angular'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { thirdPartyNotices } from '../../scripts/third-party-notices.mjs'

/**
 * What the Angular compiler is pointed at, and nothing else: the one component
 * file of ours, and `@formancy/angular`, which ng-packagr published in partial
 * Ivy form and which needs the linker. The examples page's list, for its
 * reason: the compiler's output for a module that declares no component drops
 * its exports, so the save token and the bootstrap are plain files beside the
 * component and are not on this list.
 */
export const ANGULAR_SOURCES = ['angular-form', '@formancy/angular']

/** Resolved when the plugin asks, as the examples page does: under Vitest `import.meta.url` is not a file URL. */
const TSCONFIG = (): string => fileURLToPath(new URL('./tsconfig.angular.json', import.meta.url))

/**
 * Where the data server is, for the dev server's and the preview's proxy. Its
 * own default port unless the person running `pnpm dev` says otherwise.
 */
const SERVER = process.env['FORMANCY_DATA_SERVER'] ?? 'http://127.0.0.1:4390'

/**
 * The host page, built the way the examples page is: Vite, React, and Angular
 * through the analog plugin.
 *
 * `/v1` is proxied rather than called across origins. The data server sends no
 * CORS headers, and a host page needs none: it is served from the server's
 * origin -- behind one reverse proxy in a deployment, through this proxy in
 * development -- so every request it makes is same-origin (0024, 0029).
 */
export default defineConfig({
  plugins: [
    react(),
    angular({
      tsconfig: TSCONFIG,
      transformFilter: (_code: string, id: string) => ANGULAR_SOURCES.some((part) => id.includes(part)),
    }),
    // dist/THIRD-PARTY-NOTICES.txt: every package the build bundles, with
    // the licence and notice files it ships; a package with no licence text,
    // or code the plugin cannot place, stops the build (0046).
    thirdPartyNotices(),
  ],
  // Fail rather than wander to the next free port: an address nobody was told
  // about is worse than an error. 4390 is the server's, 4391 the examples',
  // 4392 the studio's.
  server: { port: 4393, strictPort: true, proxy: { '/v1': SERVER } },
  preview: { port: 4393, strictPort: true, proxy: { '/v1': SERVER } },
})
