import { describe, expect, test } from 'vitest'
import { END_MARKER, renderPerformance, replaceGenerated, START_MARKER, UNMEASURED_MARKER } from './render.js'
import type { Results } from './results.js'
import { publishedResults } from './test-results.js'

/** The lines of one section of the region, from its heading to the next. */
function section(region: string, heading: string): string {
  const start = region.indexOf(`### ${heading}`)
  if (start === -1) throw new Error(`no section "${heading}"`)
  const next = region.indexOf('\n### ', start + 1)
  return region.slice(start, next === -1 ? undefined : next)
}

/** The table rows of a section whose first cell starts with `label`. */
function rows(text: string, label: string): string[] {
  return text.split('\n').filter((line) => line.startsWith(`| ${label}`))
}

describe('the generated region', () => {
  // A p99 resting on fewer than ten samples is a guess about the tail; the
  // page says so in words rather than printing the guess, or "null".
  test('prints "n too small" for a percentile without ten samples above it', () => {
    const results = structuredClone(publishedResults())
    const unfiltered = results.scenarios.find((entry) => entry.engine === 'pg' && entry.scenario === 'lookup-common-unfiltered')
    if (unfiltered === undefined) throw new Error('the fixture has no unfiltered search')
    Object.assign(unfiltered, { n: 300, p99: null })
    const table = section(renderPerformance(results), 'One request at a time: PostgreSQL')
    const [row] = rows(table, 'Search many customers match (no tenant row filter)')
    expect(row).toContain('| n too small |')
    expect(row).not.toContain('null')
  })

  // The unfiltered form is a different policy, measured one request at a
  // time only. In the one-at-a-time table it is labelled with its policy, so
  // nobody reads a full-table figure as the tenant's; at eight in flight it
  // was never measured, so it has no row there.
  test('labels the unfiltered rows with their policy, and leaves them out of eight in flight', () => {
    const region = renderPerformance(publishedResults())
    const one = section(region, 'One request at a time: SQL Server')
    expect(rows(one, 'Open the customer lookup |')).toHaveLength(1)
    expect(rows(one, 'Open the customer lookup (no tenant row filter) |')).toHaveLength(1)
    const eight = section(region, '8 in flight: SQL Server')
    expect(rows(eight, 'Open the customer lookup')).toHaveLength(1)
    expect(eight).not.toContain('no tenant row filter')
  })

  // A hypervisor that reports no steal has said nothing about it; a 0
  // would claim the host took no time away.
  test('prints steal that was not reported in words', () => {
    const run = section(renderPerformance(publishedResults()), 'The run')
    expect(run).toContain('not reported')
    expect(run).not.toMatch(/\| 0 \| 1\.2 \|/)
  })

  // The times are printed as the run recorded them, in UTC. A renderer that
  // made a Date of them would print the reader's machine's time zone, and
  // the doc test would fail on whichever machine was not the author's.
  test('renders the same bytes under any time zone', () => {
    const before = process.env['TZ']
    try {
      process.env['TZ'] = 'UTC'
      const utc = renderPerformance(publishedResults())
      process.env['TZ'] = 'Europe/Zurich'
      const zurich = renderPerformance(publishedResults())
      expect(zurich).toBe(utc)
      expect(utc).toContain('2026-10-10T08:00:00.000Z')
    } finally {
      if (before === undefined) delete process.env['TZ']
      else process.env['TZ'] = before
    }
  })

  // The database's container works on its own as well, and a block's CPU
  // over its requests carried that: during the health check, which never
  // reaches the database, PostgreSQL's container ran 94 to 566 ms a second in
  // review, printed as up to 2.25 ms per request. The per-request figure is
  // printed with the container's rate in the idle gaps taken off, the rate
  // beside it, and none at all for a request that makes no round trip.
  test("prints the database's CPU per request less its idle rate, the rate beside it, and none without a round trip", () => {
    const results = structuredClone(publishedResults())
    const read = results.scenarios.find((entry) => entry.engine === 'pg' && entry.scenario === 'read' && entry.concurrency === 1)
    const health = results.scenarios.find((entry) => entry.engine === 'pg' && entry.scenario === 'health' && entry.concurrency === 1)
    if (read === undefined || health === undefined) throw new Error('the fixture has no read or health block')
    Object.assign(read, { throughput: 200, databaseCpuMsPerRequest: 1.5, databaseIdleCpuMsPerSecond: 100 })
    Object.assign(health, { databaseCpuMsPerRequest: 0.6, databaseIdleCpuMsPerSecond: 120 })
    const table = section(renderPerformance(results), 'One request at a time: PostgreSQL')
    expect(table).toContain('| Database CPU per request, idle rate taken off (ms) | Database CPU when idle (ms a second) |')
    expect(rows(table, 'Read an order |')[0]).toMatch(/\| 1\.00 \| 100 \|$/)
    expect(rows(table, 'Health check |')[0]).toMatch(/\| — \| 120 \|$/)
  })

  // The added-latency table measures what holding each answer adds through
  // the hop; its undelayed column is the hop by itself. Printed beside the
  // same request sent directly, so a hop that adds a cost of its own -- as
  // Nagle's algorithm did, 92 ms against 13.7 for a 100-key resolve -- is on
  // the page, not only in the run.
  test('prints each request sent directly beside the hop undelayed', () => {
    const results = structuredClone(publishedResults())
    const direct = results.scenarios.find((entry) => entry.engine === 'ms' && entry.scenario === 'resolve-100' && entry.concurrency === 1)
    if (direct === undefined) throw new Error('the fixture has no resolve-100 block')
    direct.p50 = 1.75
    const table = section(renderPerformance(results), 'Added database latency: SQL Server')
    expect(table).toContain('| Operation | Database round trips | p50 direct (ms) | p50 through the hop, undelayed (ms) |')
    expect(rows(table, 'Resolve the most one request may ask |')[0]).toMatch(/^\| Resolve the most one request may ask \| 2 \| 1\.75 \| 2\.01 \|/)
  })

  // A refused write is counted and never timed (0041): the page prints what
  // it still asks the database on each engine, beside the answer the server
  // gave, from the result -- not a count the renderer typed, and no time.
  test('prints each refusal with its answer and the round trips counted on each engine', () => {
    const results = structuredClone(publishedResults())
    const update = results.refusals.find((entry) => entry.engine === 'ms' && entry.scenario === 'update-drifted')
    if (update === undefined) throw new Error('the fixture has no update-drifted refusal')
    update.roundTrips = 7
    const table = section(renderPerformance(results), 'Refused, counted and never timed')
    expect(table).toContain('| Operation | Answer | Database round trips, PostgreSQL | Database round trips, SQL Server |')
    expect(rows(table, 'Update, on a form whose table narrowed after it was published |')).toEqual(['| Update, on a form whose table narrowed after it was published | 409 `drift` | 2 | 7 |'])
    expect(table).not.toMatch(/\bms\b/)
  })

  // The write count is recorded beside the write-id cache of 0031, and is not
  // a claim about its bound: the run sends more writes than the cache keeps,
  // and nothing measured whether it held them. A verdict the renderer typed
  // would be the one sentence in the region that no result decides.
  test('says how many writes were sent and claims nothing of the write-id cache', () => {
    const results = structuredClone(publishedResults())
    results.checks.writes = 50_000
    const sentence = section(renderPerformance(results), 'The run')
      .split(/(?<=\.) /)
      .find((candidate) => candidate.includes('creates and updates were sent'))
    expect(sentence).toMatch(/^50,000 creates and updates were sent\b/)
    expect(sentence).not.toMatch(/\bholds?\b|\bwithin\b|\bkept\b/)
  })

  // Every number in the region comes from the result. One the renderer
  // typed itself would be a number nobody measured on the page.
  test('takes its rows read from the catalogue the result carries', () => {
    const results: Results = structuredClone(publishedResults())
    const first = results.catalogue.scenarios.find((scenario) => scenario.name === 'lookup-first-page')
    if (first === undefined) throw new Error('no first page')
    results.catalogue = { ...results.catalogue, scenarios: results.catalogue.scenarios.map((scenario) => (scenario === first ? { ...scenario, rowsRead: { exactly: 7 } } : scenario)) }
    const [row] = rows(section(renderPerformance(results), 'One request at a time: PostgreSQL'), 'Open the customer lookup |')
    expect(row).toMatch(/^\| Open the customer lookup \| 7 \|/)
  })
})

describe('what the region says the product ran on', () => {
  // The runtime closure is over a hundred packages; the page names the
  // drivers and the server's own libraries with their versions and counts
  // the rest, whose versions results.json keeps. Every one listed would bury
  // the two drivers the figures depend on most.
  test('names the drivers and server libraries, and counts the rest', () => {
    const results = structuredClone(publishedResults())
    results.product.packages = { postgres: '3.4.9', mssql: '12.7.4', tedious: '20.3.3', fastify: '5.12.5', 'left-pad': '1.3.0', 'is-number': '7.0.0' }
    const when = section(renderPerformance(results), 'When and on what')
    expect(when).toContain('`fastify@5.12.5`, `mssql@12.7.4`, `postgres@3.4.9`, `tedious@20.3.3`, and 2 other packages')
    expect(when).not.toContain('left-pad')
  })

  // D and the protocol's values are settings, typed rather than measured:
  // "5 ms", not a measured-looking "5.00 ms".
  test('prints settings as they were written', () => {
    const region = renderPerformance(publishedResults())
    expect(section(region, 'Added database latency: PostgreSQL')).toContain('p50 with 5 ms per answer')
    expect(section(region, 'When and on what')).toContain('holds every database answer 5 ms')
  })
})

describe('replacing the region', () => {
  const page = ['# Performance', '', 'Prose before.', '', START_MARKER, 'old', END_MARKER, '', 'Prose after.', ''].join('\n')

  // The page's prose is written by hand around the region; a render that
  // touched it would undo an edit nobody sees in the diff of results.json.
  test('keeps the prose outside the markers', () => {
    const replaced = replaceGenerated(page, 'new region\n')
    expect(replaced).toBe(['# Performance', '', 'Prose before.', '', START_MARKER, 'new region', END_MARKER, '', 'Prose after.', ''].join('\n'))
  })

  // Before the first measurement the region renders nothing, so its marker
  // names no source: one naming results.json would be a rendering of a file
  // that is not there, which the repository's generated-block guard refuses
  // (0035). The first render must still find it, and from then on the region
  // names the file it was rendered from.
  test('replaces a region never rendered, and names results.json as its source from then on', () => {
    const unmeasured = ['# Performance', '', UNMEASURED_MARKER, 'No measurement yet.', END_MARKER, ''].join('\n')
    expect(UNMEASURED_MARKER).not.toContain(' from ')
    expect(START_MARKER).toBe(UNMEASURED_MARKER.replace('; do not edit', ' from docs/performance/results.json; do not edit'))
    expect(replaceGenerated(unmeasured, 'figures\n')).toBe(['# Performance', '', START_MARKER, 'figures', END_MARKER, ''].join('\n'))
  })

  // A page without its markers would otherwise be appended to, or lost.
  test('refuses a page without both markers', () => {
    expect(() => replaceGenerated('# Performance\n', 'x')).toThrow(/markers/)
    expect(() => replaceGenerated(`${END_MARKER}\n${START_MARKER}\n`, 'x')).toThrow(/markers/)
  })
})
