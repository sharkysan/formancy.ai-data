import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { IDLE_MINUTES, MAX_INSTANCES, PER_TENANT, PERSONAS } from '../apps/live-demo/dist/worker/pure.mjs'
import { liveConfigProblems, liveDemoUrl, readLiveDemoConfig } from './live-demo.mjs'

/**
 * The README's account of the live demo (0070) held to what the demo is: the
 * address its Worker is routed at, the people the Worker offers, how long a
 * visitor's server outlives their last request and how many run at once, as
 * the Worker's own constants say (apps/live-demo/dist/worker/pure.mjs, so
 * `pnpm build` first, as for scripts/live-demo.test.mjs), how much data each
 * tenant has, as the generator's share says, and the commands it tells a
 * reader to run. Prose does not break when a route, a persona, a limit, the
 * data's size or a script moves, so this does. What the README says the demo
 * costs, or that a sentence about it is still true, is review's.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...path) => readFileSync(join(repo, ...path), 'utf8').replaceAll('\r\n', '\n')
const readme = read('README.md')
const root = JSON.parse(read('package.json'))
const host = JSON.parse(read('apps', 'host', 'package.json'))

/** The text under `## <title>`, up to the next heading of that level; empty when there is no such section. */
function section(title) {
  const start = readme.indexOf(`\n## ${title}\n`)
  if (start === -1) return ''
  const end = readme.indexOf('\n## ', start + 1)
  return readme.slice(start, end === -1 ? undefined : end)
}

/** Every whole number `pattern`'s first group captures in `text`. */
const numbers = (text, pattern) => [...text.matchAll(pattern)].map((match) => Number(match[1]))

describe("README.md's live demo", () => {
  const live = section('Live demo')

  // A route moved in the Worker's config, or the Worker's PREFIX, would leave
  // the README sending a reader to formancy.ai's 404 while the demo answered
  // somewhere else. The address is derived from the Worker's PREFIX, and the
  // committed config is held to route exactly that.
  test("Try it and Live demo send a reader to the address the live demo's Worker is routed at", () => {
    expect(liveConfigProblems(readLiveDemoConfig())).toEqual([])
    expect(section('Try it')).toContain(liveDemoUrl())
    expect(live).toContain(liveDemoUrl())
  })

  // A person added, renamed or taken away in personas.ts would leave the
  // README naming somebody the sign-in does not offer, or leaving out
  // somebody it does. The section lists them as items that open with the
  // person's name in bold, and those names are exactly the Worker's.
  test('Live demo lists exactly the people the Worker offers a visitor', () => {
    const listed = [...live.matchAll(/^- \*\*([^*]+)\*\*/gm)].map((match) => match[1])
    expect(PERSONAS.length).toBeGreaterThan(0)
    expect([...listed].sort()).toEqual(PERSONAS.map((persona) => persona.name).sort())
  })

  // The idle timeout and the cap are what a visitor and the rightsholder
  // plan by: how long a server keeps their changes, and how many people can
  // try the demo at once. Each number of minutes and each "at most" the
  // section states is the Worker's, and it states both, wherever the prose
  // wraps between the number and its word.
  test("every number of minutes and every cap the Live demo section states is the Worker's", () => {
    const minutes = numbers(live, /\b(\d+)\s+minutes?\b/g)
    expect(minutes.length).toBeGreaterThan(0)
    for (const each of minutes) expect(each).toBe(IDLE_MINUTES)
    const caps = numbers(live, /\bat\s+most\s+(\d+)\b/gi)
    expect(caps.length).toBeGreaterThan(0)
    for (const each of caps) expect(each).toBe(MAX_INSTANCES)
  })

  // The data generated for each tenant is what a visitor pages through; a
  // change to the generator's share would leave the README promising more
  // or fewer customers and orders than the demo has.
  test("the customers and orders the Live demo section says each tenant has are the generator's", () => {
    const shares = [...live.matchAll(/\b(\d+)\s+customers\s+and\s+(\d+)\s+orders\b/g)].map((match) => ({ customers: Number(match[1]), orders: Number(match[2]) }))
    expect(shares.length).toBeGreaterThan(0)
    for (const share of shares) expect(share).toEqual({ customers: PER_TENANT.customers, orders: PER_TENANT.orders })
  })

  // A script renamed in the root manifest would leave the README telling a
  // reader to run a command pnpm does not have. A code span `pnpm <name> …`
  // names a script; one whose first word is an option, `pnpm --filter …`,
  // does not.
  test("every pnpm command the Live demo section names is a script of the workspace's root", () => {
    const commands = [...live.matchAll(/`pnpm (\w[\w:-]*)[^`]*`/g)].map((match) => match[1])
    expect(commands).toEqual(expect.arrayContaining(['live-demo:deploy', 'test:live-demo']))
    for (const command of commands) expect(root.scripts[command], `pnpm ${command}`).toBeDefined()
  })

  // The demo's page is the host page's demo build; Host example says so, by
  // the script that makes it.
  test('Host example names the host page\'s demo build by the script that makes it', () => {
    expect(host.scripts['build:demo']).toBeDefined()
    expect(section('Host example')).toContain('build:demo')
  })
})
