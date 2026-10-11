import { defineConfig } from 'tsdown'

export default defineConfig({
  // Programs and no library: the measurement, which writes
  // docs/performance/results.json; the renderer, which turns it into the
  // page; and P13's calibration. Separate entries, so the measurement never
  // loads the renderer.
  entry: ['src/measure.ts', 'src/render-cli.ts', 'src/calibrate.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
})
