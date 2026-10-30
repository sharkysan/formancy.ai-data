import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

/*
 * AG Grid Community is pinned to one release (0047): the gate measured the
 * grid's colours, its keyboard and its edges at that release, and an upgrade
 * is a reviewed change that runs the gate again. `ag-grid-react` and
 * `ag-grid-community` move together, or the React wrapper drives a grid it
 * was not built for. And Community only: the Enterprise modules are under a
 * commercial licence this module does not hold.
 */

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

// A range would let an install pick a release the gate never saw; two
// versions apart would pair a wrapper with a grid it does not match.
test('both AG Grid packages are pinned exactly, to one release', () => {
  const pinned = { community: manifest.dependencies['ag-grid-community'], react: manifest.dependencies['ag-grid-react'] }
  expect(pinned.community, 'ag-grid-community is a dependency').toMatch(/^\d+\.\d+\.\d+$/)
  expect(pinned.react).toBe(pinned.community)
  // What is installed is what is pinned, for the wrapper's own dependency
  // too. Read from the app's node_modules: neither package exports its
  // package.json.
  const installed = (name: string) =>
    JSON.parse(readFileSync(join(app, 'node_modules', name, 'package.json'), 'utf8')) as { version: string; dependencies?: Record<string, string> }
  expect(installed('ag-grid-community').version).toBe(pinned.community)
  expect(installed('ag-grid-react').version).toBe(pinned.community)
  expect(installed('ag-grid-react').dependencies?.['ag-grid-community']).toBe(pinned.community)
})

// No Enterprise package, in any dependency list: the grid's master/detail
// rows are Enterprise's, and the workspace links two Community grids instead.
test('no AG Grid Enterprise package is a dependency', () => {
  const names = [...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies)]
  expect(names.filter((name) => /^(@ag-grid-enterprise\/|ag-grid-enterprise|ag-charts-enterprise)/.test(name))).toEqual([])
})
