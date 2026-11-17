// @vitest-environment node
//
// Node rather than jsdom: the fixture package's comparators live beside its
// container harness, and nothing here renders.
import { createSnapshot, serverStanding } from '@formancy/data-core'
import type { MetadataSnapshot } from '@formancy/data-core'
import {
  accessDisagreements,
  FIXTURE_MODEL,
  imageMajor,
  POSTGRES_IMAGE,
  READER_ACCESS,
  restrictedDisagreements,
  routineDisagreements,
  snapshotDisagreements,
  SQLSERVER_IMAGE,
  WRITER_ACCESS,
} from '@formancy/data-fixtures'
import type { FixtureAccount } from '@formancy/data-fixtures'
import { describe, expect, test } from 'vitest'
import owner from './fixtures/postgres-owner.json'
import reader from './fixtures/postgres-reader.json'
import writer from './fixtures/postgres-writer.json'
import sqlserver from './fixtures/sqlserver-owner.json'
import sqlserverReader from './fixtures/sqlserver-reader.json'
import sqlserverWriter from './fixtures/sqlserver-writer.json'
import {
  OWNER_ROUTINES,
  OWNER_SNAPSHOT,
  READER_ROUTINES,
  READER_SNAPSHOT,
  readSnapshot,
  SQLSERVER_READER_ROUTINES,
  SQLSERVER_READER_SNAPSHOT,
  SQLSERVER_ROUTINES,
  SQLSERVER_SNAPSHOT,
  SQLSERVER_WRITER_ROUTINES,
  SQLSERVER_WRITER_SNAPSHOT,
  WRITER_ROUTINES,
  WRITER_SNAPSHOT,
} from './test-server.js'
import { withoutRoutines } from './test-routines.js'

/**
 * The databases the suite's server discovers are captured from the shared
 * fixture on both engines by `scripts/capture-snapshots.mjs`, never written by
 * hand. These cases are what keeps them so.
 */
const FILES: ReadonlyArray<[string, unknown]> = [
  ['the owner', owner],
  ['the restricted reader', reader],
  ['the writer', writer],
  ['the SQL Server owner', sqlserver],
  ['the SQL Server reader', sqlserverReader],
  ['the SQL Server writer', sqlserverWriter],
]

describe('the captured snapshots', () => {
  // A hand edit -- a foreign key removed to see what the studio does -- would
  // make every test about gaps prove the studio against a database nobody
  // has. The fingerprint is recomputed over the contents, so an edit that is
  // not a re-capture fails here, and the canonical form means a re-capture
  // is a diff of what the database changed.
  test.each(FILES)('%s: is exactly what createSnapshot makes of its contents', (_who, file) => {
    const committed = structuredClone(file) as MetadataSnapshot
    const { fingerprint: _, ...contents } = committed
    expect(createSnapshot(contents)).toEqual(committed)
  })

  // The suite's server refuses an edited copy rather than serving it.
  test('an edited copy is refused, not served', () => {
    const edited = structuredClone(owner) as unknown as MetadataSnapshot
    const first = edited.objects[0]?.columns[0]
    if (first === undefined) throw new Error('the snapshot has no first column to edit')
    first.nullable = !first.nullable
    expect(() => readSnapshot(edited)).toThrow(/edited/)
  })

  // The fixture changes and these files do not follow until somebody runs
  // the capture again. The model is what both adapters answer to (0005).
  test('the owners still see the shared fixture model on both engines, and no gap', () => {
    expect(snapshotDisagreements(OWNER_SNAPSHOT)).toEqual([])
    expect(OWNER_SNAPSHOT.gaps).toEqual([])
    expect(SQLSERVER_SNAPSHOT.kind).toBe('sqlserver')
    expect(snapshotDisagreements(SQLSERVER_SNAPSHOT)).toEqual([])
    expect(SQLSERVER_SNAPSHOT.gaps).toEqual([])
  })

  // PostgreSQL's catalog answers every role (0027): its reader describes all
  // seven objects with what it may do, and has nothing to hide behind a gap.
  test('the PostgreSQL reader describes every object, with no gap, as the restricted fixture grants', () => {
    expect(restrictedDisagreements(READER_SNAPSHOT)).toEqual([])
    expect(accessDisagreements(READER_SNAPSHOT, READER_ACCESS)).toEqual([])
    expect(READER_SNAPSHOT.objects.map((object) => object.ref.name)).toEqual(FIXTURE_MODEL.map((object) => object.ref.name).sort())
    expect(READER_SNAPSHOT.gaps).toEqual([])
  })

  // SQL Server's reader is the "cannot tell" file: it sees sales.order, and
  // for everything else it says it cannot see rather than nothing.
  test('the SQL Server reader sees sales.order only, and says what it cannot see', () => {
    expect(restrictedDisagreements(SQLSERVER_READER_SNAPSHOT)).toEqual([])
    expect(accessDisagreements(SQLSERVER_READER_SNAPSHOT, READER_ACCESS)).toEqual([])
    expect(SQLSERVER_READER_SNAPSHOT.objects.map((object) => `${object.ref.schema}.${object.ref.name}`)).toEqual(['sales.order'])
    expect(SQLSERVER_READER_SNAPSHOT.gaps.length).toBeGreaterThan(0)
  })

  // The order form's own account: what it may do column by column, and the
  // row-level security that binds it, as the fixture grants them.
  test('the writer agrees with what the fixture grants it', () => {
    expect(accessDisagreements(WRITER_SNAPSHOT, WRITER_ACCESS)).toEqual([])
    expect(WRITER_SNAPSHOT.gaps).toEqual([])
  })

  // The order form's own account on SQL Server, the getting-started guide's
  // `ms` connection: what it may do as the fixture grants it, and no
  // employee it may read, so the guide's studio steps meet the lookups that
  // account is offered (0138).
  test('the SQL Server writer agrees with what the fixture grants it', () => {
    expect(SQLSERVER_WRITER_SNAPSHOT.kind).toBe('sqlserver')
    expect(accessDisagreements(SQLSERVER_WRITER_SNAPSHOT, WRITER_ACCESS)).toEqual([])
    const employee = SQLSERVER_WRITER_SNAPSHOT.objects.find((object) => object.ref.name === 'employee')
    expect(employee?.columns.some((column) => column.access.select)).toBe(false)
  })

  // The version is printed by the studio and is outside the fingerprint, so
  // an edit to it would pass the cases above. It must be the major of the
  // image the fixture runs -- for SQL Server, the major its year names,
  // through data-core's one table of years (imageMajor), which is what the
  // server reports.
  test('each names a server version from the image the fixture runs', () => {
    const major = String(imageMajor('postgres', POSTGRES_IMAGE))
    for (const snapshot of [OWNER_SNAPSHOT, READER_SNAPSHOT, WRITER_SNAPSHOT]) expect(snapshot.serverVersion.split('.')[0]).toBe(major)
    const release = String(imageMajor('sqlserver', SQLSERVER_IMAGE))
    for (const snapshot of [SQLSERVER_SNAPSHOT, SQLSERVER_READER_SNAPSHOT, SQLSERVER_WRITER_SNAPSHOT])
      expect(snapshot.serverVersion.split('.')[0]).toBe(release)
  })

  // The server is outside the fingerprint as well (0068), and the studio
  // says a standing from it: a capture taken before servers were recorded
  // would say "not tested" on every page the README pictures, and one
  // edited to another major a sentence no server gave. Each must name the
  // product and major of the image the fixture runs, which this release
  // was tested on -- for SQL Server, at the fixture database's own level.
  test('each records the server of the image the fixture runs, one this release was tested on', () => {
    const engines = [
      { kind: 'postgres', product: 'postgresql', major: imageMajor('postgres', POSTGRES_IMAGE), snapshots: [OWNER_SNAPSHOT, READER_SNAPSHOT, WRITER_SNAPSHOT] },
      { kind: 'sqlserver', product: 'sqlserver', major: imageMajor('sqlserver', SQLSERVER_IMAGE), snapshots: [SQLSERVER_SNAPSHOT, SQLSERVER_READER_SNAPSHOT] },
    ] as const
    for (const { kind, product, major, snapshots } of engines) {
      for (const snapshot of snapshots) {
        expect(snapshot.server).toMatchObject({ product, major })
        expect(serverStanding(kind, snapshot.server)).toMatchObject({ tested: true })
      }
    }
  })
})

/** Each captured database with its routines, as the suite's discovery reads it when asked, and the account it was captured as. */
const WITH_ROUTINES: ReadonlyArray<[string, MetadataSnapshot, MetadataSnapshot, FixtureAccount]> = [
  ['the owner', OWNER_ROUTINES, OWNER_SNAPSHOT, 'owner'],
  ['the restricted reader', READER_ROUTINES, READER_SNAPSHOT, 'reader'],
  ['the writer', WRITER_ROUTINES, WRITER_SNAPSHOT, 'writer'],
  ['the SQL Server owner', SQLSERVER_ROUTINES, SQLSERVER_SNAPSHOT, 'owner'],
  ['the SQL Server reader', SQLSERVER_READER_ROUTINES, SQLSERVER_READER_SNAPSHOT, 'reader'],
  ['the SQL Server writer', SQLSERVER_WRITER_ROUTINES, SQLSERVER_WRITER_SNAPSHOT, 'writer'],
]

describe('the routines the suite’s discovery reports when asked (0158, 0163)', () => {
  // The captures predate routines, so what each account's discovery says
  // of them is made in test-server.ts, from fixtures/routines.json. Every
  // fact the comparator both adapters' discovery suites answer to reads is
  // held to the shared model here: a routine the account may not execute
  // on SQL Server absent behind a gap, on PostgreSQL listed and not
  // executable. Without this the studio's actions would be proved against
  // routines nobody's database has. Watched failing with the PostgreSQL
  // reader's ship_order made executable: "sales.ship_order(pg_catalog.int8,
  // pg_catalog.int4) executable as the reader is true, expected false".
  test.each(WITH_ROUTINES)('%s: says what the model says of each routine, as that account', (_who, routines, _captured, account) => {
    expect(routineDisagreements(routines, account)).toEqual([])
  })

  // A scope that does not ask reads nothing more and makes the snapshot it
  // made before, to the byte (0158): the suite's discovery strips what it
  // added, so every case that never asks for routines discovers the
  // captured file it always did. Watched failing with the routines gap
  // kept: the SQL Server reader's fingerprint moved.
  test.each(WITH_ROUTINES)('%s: asked without routines, is the captured file to the byte', (_who, routines, captured) => {
    expect(withoutRoutines(routines)).toEqual(captured)
  })
})
