// The README blocks that say what the repository is tested on (0035): a table
// in README.md and one line in each adapter's README, rendered from
// `testedOn()` -- what the checkout itself says -- in scripts/generated-block.mjs's
// grammar.
//
// `node scripts/release-report/readme.mjs --write` rewrites the three blocks
// after a dependency or an image changes; without `--write` it lists the
// documents whose block is stale and exits 1. tested-on.test.mjs fails until
// they match, naming this command. They hold static facts only: what a run
// answered -- each server's own build and digest, any other image a test
// started, the Node and the Chromium it launched -- is the release report's,
// from that run.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readBlock, replaceBlock } from '../generated-block.mjs'
import { testedOn } from './tested-on.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export const GENERATOR = 'scripts/release-report/readme.mjs'

/** The engines' names as a reader knows them; a third engine without one fails here, not silently. */
const ENGINE_NAMES = { postgres: 'PostgreSQL', sqlserver: 'SQL Server' }

const code = (text) => `\`${text}\``
/** A table cell: a `|` inside one would end it. */
const cell = (text) => String(text).replaceAll('|', '\\|')
const engineName = (engine) => {
  const name = ENGINE_NAMES[engine]
  if (name === undefined) throw new Error(`readme.mjs has no name for the engine ${engine}`)
  return name
}

/** A list in prose: `a`, `a and b`, `a, b and c`. */
const prose = (items) => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`)

/** How a runtime dependency is declared: its range, or its parent's range for it. */
function declared(entry) {
  if (entry.under === undefined) return code(entry.range)
  return entry.range === null ? `whatever ${code(entry.under)} brings` : `${code(entry.range)}, by ${code(entry.under)}`
}

/** Versions of a tool, each with where it is loaded when they differ. */
function versions(tool) {
  if (tool.versions.length === 1) return tool.versions[0].version
  return tool.versions.map(({ version, from }) => `${version} (${from.join(', ')})`).join('; ')
}

/** README.md's block: one table, every row derived. */
export function readmeTable(facts) {
  const rows = [
    ...facts.engines.map((engine) => [`**${engineName(engine)}**`, `${code(facts.images[engine])}, unless a test names another image`, '']),
    ...facts.runtime.map((entry) => [
      entry.under === undefined ? `${code(entry.name)}, by ${code(entry.package)}` : `${code(entry.name)}, under ${code(entry.under)}`,
      entry.loaded,
      declared(entry),
    ]),
    ...facts.upstream.map((entry) => [`${code(entry.name)}${entry.direct ? '' : ' (transitive)'}`, entry.version, entry.declared === null ? '' : code(entry.declared)]),
    ['Node, the workspace', '', facts.node.engines === null ? 'nothing' : code(facts.node.engines)],
    ['Node, the server image', [...new Set(facts.node.dockerfile)].map(code).join(', ') + (new Set(facts.node.dockerfile).size === 1 && facts.node.dockerfile.length > 1 ? ', every stage' : ''), ''],
    ['Node, CI', [...new Set(facts.node.ci.map((entry) => entry.version))].join(', '), ''],
    [facts.packageManager.name, `${facts.packageManager.version}, through corepack`, `${code(facts.packageManager.declared)}, the root's \`packageManager\``],
    [
      'Chromium',
      `${facts.browser.chromium.browserVersion}, the ${facts.browser.chromium.name} Playwright ${facts.browser.playwright} pins (revision ${facts.browser.chromium.revision})`,
      '',
    ],
    ...facts.tooling.map((tool) => [code(tool.name), versions(tool), '']),
  ]
  return [
    '| | Tested with | Declared as |',
    '| --- | --- | --- |',
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
    '',
    'What a run actually answered — each server’s own version and image digest, every other image a test started, the Node and Chromium it launched — is in the report every CI run produces and every release attaches, signed.',
  ].join('\n')
}

/** An adapter README's block: the image its suites start and the drivers they load, with how the package is published. */
export function adapterLine(facts, engine) {
  const drivers = facts.runtime.filter((entry) => entry.package === `@formancy/data-${engine}`)
  if (drivers.length === 0) throw new Error(`@formancy/data-${engine} declares no runtime dependency, so its README has no driver to name`)
  const named = drivers.map((entry) =>
    entry.under === undefined ? `${code(entry.name)} ${entry.loaded} (published as ${code(entry.range)})` : `the ${code(entry.name)} ${entry.loaded} under it (${declared(entry)})`,
  )
  return `The suites start ${code(facts.images[engine])} unless a test names another image, through ${prose(named)}.`
}

/** Every document with a block of this generator, and the body it should hold. */
export function documents(facts) {
  return [
    { file: 'README.md', body: readmeTable(facts) },
    ...facts.engines.map((engine) => ({ file: `packages/data-${engine}/README.md`, body: adapterLine(facts, engine) })),
  ]
}

/** The documents whose block differs from what `facts` renders: `{ file, current, next }`. */
export function stale(facts, root = repo) {
  return documents(facts).flatMap(({ file, body }) => {
    const current = readFileSync(join(root, file), 'utf8')
    return readBlock(current, GENERATOR) === body ? [] : [{ file, current, next: replaceBlock(current, GENERATOR, body) }]
  })
}

// `node scripts/release-report/readme.mjs [--write]`
if (process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/release-report/readme.mjs')) {
  const differing = stale(await testedOn(repo))
  if (process.argv.includes('--write')) {
    for (const { file, next } of differing) writeFileSync(join(repo, file), next, 'utf8')
    console.log(differing.length === 0 ? 'every tested-on block is current' : `rewrote ${differing.map(({ file }) => file).join(', ')}`)
  } else if (differing.length > 0) {
    console.error(`stale: ${differing.map(({ file }) => file).join(', ')}; run node scripts/release-report/readme.mjs --write`)
    process.exitCode = 1
  } else {
    console.log('every tested-on block is current')
  }
}
