import { fileURLToPath } from 'node:url'
import angular from '@analogjs/vite-plugin-angular'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

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
  plugins: [
    react(),
    angular({
      tsconfig: TSCONFIG,
      transformFilter: (_code: string, id: string) => ANGULAR_SOURCES.some((part) => id.includes(part)),
    }),
  ],
  // Fail rather than wander to the next free port: an address nobody was told
  // about is worse than an error. 4390 is the server's.
  server: { port: 4391, strictPort: true },
})
