import { fileURLToPath } from 'node:url'
import angular from '@analogjs/vite-plugin-angular'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { thirdPartyNotices } from '../../scripts/third-party-notices.mjs'

/**
 * What the Angular compiler is pointed at, and nothing else.
 *
 * The component file of ours, and `@formancy/angular`, which ng-packagr
 * published in partial Ivy form and which needs the linker. Everything else in
 * this app is React or plain TypeScript, and formancy.ai's playground found
 * that the compiler's output for a module that declares no component drops its
 * exports. So the list is narrow on purpose, and a new Angular file is added
 * here by name.
 */
export const ANGULAR_SOURCES = ['angular-preview', '@formancy/angular']

/**
 * The Angular tsconfig, resolved when the plugin asks rather than when this
 * module loads: under Vitest's transform `import.meta.url` is not a file URL,
 * and resolving it eagerly throws (formancy.ai's playground, measured there).
 */
const TSCONFIG = (): string => fileURLToPath(new URL('./tsconfig.angular.json', import.meta.url))

/**
 * Both renderers, in one page, the way formancy.ai's playground mounts them.
 *
 * `transformFilter`, not `include`: the plugin's `include` adds files to
 * compile and narrows nothing.
 */
export default defineConfig({
  // Relative, so one build is right wherever it is served: at the root of
  // `vite preview` for `pnpm demo`, and under formancy.ai's /data/examples/,
  // where the demo is and where the browser gate serves it (0069). Vite's
  // default writes /assets/…, which under /data/examples/ is formancy.ai's
  // own directory: the page loads and its script does not. The dev server
  // takes it as /.
  base: './',
  plugins: [
    react(),
    angular({
      tsconfig: TSCONFIG,
      transformFilter: (_code: string, id: string) => ANGULAR_SOURCES.some((part) => id.includes(part)),
    }),
    // dist/THIRD-PARTY-NOTICES.txt: every package the build bundles, with
    // the licence and notice files it ships; a package with no licence text,
    // or code the plugin cannot place, stops the build (0046). The page is
    // served to anyone at formancy.ai/data/examples/, so its bundle of React,
    // Angular and upstream formancy goes with their texts as the studio's
    // and the host page's do.
    thirdPartyNotices(),
  ],
  // Fail rather than wander to the next free port: an address nobody was told
  // about is worse than an error. 4390 is the server's.
  server: { port: 4391, strictPort: true },
  preview: { port: 4391, strictPort: true },
})
