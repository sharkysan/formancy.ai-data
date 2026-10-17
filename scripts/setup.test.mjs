import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { WRANGLER } from './demo.mjs'

/**
 * docs/setup.md, the one page that says what is set up outside this
 * repository's files and in what order, held to what it names: the Workers
 * every `apps/<app>/wrangler.json` deploys, the root scripts it tells a
 * reader to run, and the Wrangler both deploys pin. Its links and the
 * repository paths it writes in backticks are scripts/architecture.test.mjs's
 * to hold, as the architecture's are. What nothing reads is its *What is
 * done* table: a setting changed in GitHub or Cloudflare since the date it
 * gives is not seen here, which is why each row says how it was read.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...path) => readFileSync(join(repo, ...path), 'utf8').replaceAll('\r\n', '\n')
const SETUP = 'docs/setup.md'

/** Every code span and fenced line of `markdown`, a fence indented under a list item included: where a name, a command or a pin is written to be typed. */
function typed(markdown) {
  const spans = [...markdown.matchAll(/`([^`\n]+)`/g)].map((found) => found[1])
  const fenced = [...markdown.matchAll(/^ *```[^\n]*\n([\s\S]*?)^ *```/gm)].flatMap((found) => found[1].split('\n'))
  return [...spans, ...fenced]
}

/** The Worker each app with a wrangler.json deploys, by the name its config gives. */
const workers = () =>
  readdirSync(join(repo, 'apps'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      try {
        return [String(JSON.parse(read('apps', entry.name, 'wrangler.json')).name)]
      } catch (error) {
        if (error.code === 'ENOENT') return []
        throw error
      }
    })

/** pnpm's own commands, which a line may run and which are no script of the root's. */
const PNPM_COMMANDS = new Set(['install', 'exec', 'dlx', 'add', 'run'])

describe(SETUP, () => {
  const setup = read(SETUP)
  const lines = typed(setup)

  // A Worker renamed in its config leaves the page sending the maintainer to
  // create one nothing deploys to; a Worker added leaves one the page never
  // asks anybody to create, and its address formancy.ai's 404.
  test('names every Worker an app deploys, and no other', () => {
    const named = new Set(lines.filter((line) => /^formancy-data-[a-z-]+$/.test(line)))
    expect([...named].sort()).toEqual(workers().sort())
  })

  // A script renamed or dropped from package.json leaves a command that
  // answers "Command not found" to the one person who runs it once.
  test('tells a reader to run only scripts the root package.json has', () => {
    const scripts = Object.keys(JSON.parse(read('package.json')).scripts)
    const run = lines.flatMap((line) => [...line.matchAll(/\bpnpm ([a-z][\w:-]*)/g)].map((found) => found[1])).filter((name) => !PNPM_COMMANDS.has(name))
    expect(run.filter((name) => !scripts.includes(name))).toEqual([])
  })

  // A login with another Wrangler than the one the deploys run is a second
  // tool on the machine, and on a major's change one whose login the deploy
  // may not read.
  test('pins the Wrangler both deploys run', () => {
    const pins = [...new Set(lines.flatMap((line) => [...line.matchAll(/\bwrangler@[\w.-]+/g)].map((found) => found[0])))]
    expect(pins).toEqual([WRANGLER])
  })

  // A page nobody can find is a page nobody reads: the README and the
  // documentation's entry each link it.
  test('is linked from the README and from docs/README.md', () => {
    expect(read('README.md')).toMatch(/\]\(\.?\/?docs\/setup\.md(?:#[^)]*)?\)/)
    expect(read('docs', 'README.md')).toMatch(/\]\(setup\.md(?:#[^)]*)?\)/)
  })

  // A guard on the guard: each check above passes on a page that names
  // nothing, so the page is read as naming what it does today.
  test('is read at all', () => {
    expect(workers()).toEqual(expect.arrayContaining(['formancy-data-examples', 'formancy-data-demo']))
    expect(lines.some((line) => /\bpnpm live-demo:deploy\b/.test(line))).toBe(true)
  })
})
