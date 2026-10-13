import { defineConfig } from 'tsdown'

export default defineConfig({
  // main.ts is the composition root a container runs; index.ts is what a host
  // embedding the server imports; identity-keys-cli.ts is the key set file
  // tool the image ships beside the server (0059), which an operator runs in
  // the container as `node dist/identity-keys-cli.mjs`. All three are entry
  // points, so none is bundled into another.
  entry: ['src/index.ts', 'src/main.ts', 'src/identity-keys-cli.ts'],
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
