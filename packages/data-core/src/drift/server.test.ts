import { describe, expect, test } from 'vitest'
import { generateForm } from '../generate/generate.js'
import { serverStanding } from '../server.js'
import type { ServerFacts } from '../server.js'
import { diffSnapshots, drift, kinds, NO_FILTERS, only, ORDER, remove, snapshot } from './fixture.js'

/*
 * The server a review's current snapshot was read from, when this release
 * was not tested on it (0068): said for review on every report against
 * that server, and never a reason to stop anything. Whether a server is
 * tested is serverStanding's to decide, held by src/server.test.ts; what is
 * held here is that drift says it, where, and that it decides nothing else.
 */

const POSTGRES_14: ServerFacts = { product: 'postgresql', major: 14 }
const POSTGRES_17: ServerFacts = { product: 'postgresql', major: 17 }
/** A 2022 server whose database was restored from 2017 and kept its level. */
const COMPAT_140: ServerFacts = { product: 'sqlserver', major: 16, compatibility: 140 }
const SQLSERVER_2022: ServerFacts = { product: 'sqlserver', major: 16, compatibility: 160 }

/** What the order form may do against the same database read from a server that records nothing: what a server change must leave alone. */
function unrecorded(kind: 'postgres' | 'sqlserver') {
  return drift(undefined, { kind })
}

describe('diffSnapshots: the server', () => {
  // The upgrade nobody announced: the catalog the same, the server one this
  // release never ran on. Unsaid, the form is reviewed as though the
  // matrix covered it. Said as a block, an estate this release was not
  // tested on could serve nothing, which 0068 decides against.
  test('a snapshot from a server this release was not tested on is for review, names it, and stops nothing', () => {
    for (const [kind, server] of [
      ['postgres', POSTGRES_14],
      ['sqlserver', COMPAT_140],
    ] as const) {
      const report = drift(undefined, { kind, server })
      expect(only(report)).toEqual({
        kind: 'server-untested',
        severity: 'review',
        subject: { kind: 'scope' },
        affects: [],
        message: expect.stringContaining(serverStanding(kind, server).says),
      })
      expect(only(report).message).toMatch(/Nothing is stopped/)
      const { changes: _changes, ...verdict } = report
      const { changes: _none, ...before } = unrecorded(kind)
      expect(verdict).toEqual(before)
      expect(report.blocking).toBe(false)
    }
  })

  // The server is outside the fingerprint (0068), so the same catalog on an
  // untested server has the fingerprint the published snapshot has, and the
  // fast path would report nothing: an in-place upgrade would go unsaid on
  // every review, which is the one place it is said.
  test('is said on every review against that server, even when nothing else changed', () => {
    const base = snapshot(undefined, { kind: 'postgres', server: POSTGRES_14 })
    const { bindings } = generateForm(base, ORDER)
    expect(kinds(diffSnapshots(base, base, bindings, NO_FILTERS))).toEqual(['server-untested'])
    // And beside a change that blocks: the root gone is not a reason to say less.
    const gone = diffSnapshots(
      base,
      snapshot((objects) => remove(objects, 'order'), { kind: 'postgres', server: POSTGRES_14 }),
      bindings,
      NO_FILTERS,
    )
    expect(kinds(gone)).toEqual(['root-dropped', 'server-untested'])
    expect(gone.changes.find((change) => change.kind === 'server-untested')?.severity).toBe('review')
  })

  // A tested server must not be reported -- a review that lists what is not
  // a change teaches people to click through it -- and an upgrade onto one
  // is not a change either. A snapshot that records no server (one taken
  // before 0068) decides nothing: it is not called tested, which
  // serverStanding refuses, and it is not reported as untested on every
  // review of every form published before this release.
  test('says nothing of a tested server, an upgrade onto one, or a snapshot that records none', () => {
    expect(drift(undefined, { kind: 'postgres', server: POSTGRES_17 }).changes).toEqual([])
    expect(drift(undefined, { kind: 'sqlserver', server: SQLSERVER_2022 }).changes).toEqual([])
    const upgraded = snapshot(undefined, { kind: 'postgres', server: POSTGRES_14 })
    expect(drift(undefined, { kind: 'postgres', server: POSTGRES_17 }, ORDER, upgraded).changes).toEqual([])
    expect(unrecorded('postgres').changes).toEqual([])
    expect(unrecorded('sqlserver').changes).toEqual([])
  })

  // What the base was read from is the past, and the review is of the
  // database as it is now: a form published on a tested server and reviewed
  // on one whose database is now below the compatibility floor says so,
  // though the base's server was tested -- as the upgrade above says
  // nothing, though the base's was not.
  test('is decided by the current snapshot alone', () => {
    const tested = snapshot(undefined, { kind: 'sqlserver', server: SQLSERVER_2022 })
    expect(kinds(drift(undefined, { kind: 'sqlserver', server: COMPAT_140 }, ORDER, tested))).toEqual(['server-untested'])
  })
})
