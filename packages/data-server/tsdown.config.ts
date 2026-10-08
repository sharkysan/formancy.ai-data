import { defineConfig } from 'tsdown'

export default defineConfig({
  // main.ts is the composition root a container runs; index.ts is what a host
  // embedding the server imports. Both are entry points, so neither is bundled
  // into the other.
  entry: ['src/index.ts', 'src/main.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
})
