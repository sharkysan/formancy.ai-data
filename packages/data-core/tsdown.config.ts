import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  // Nothing from node_modules is inlined (0046): tsdown inlines a package
  // this one imports at run time without declaring it, and the dist -- and
  // an app's bundle or a tarball made from it -- would carry that code as
  // this repository's own, under its licence. With this list empty, such a
  // build fails instead, naming the package.
  deps: { onlyBundle: [] },
})
