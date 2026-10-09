// @vitest-environment node
//
// Node rather than jsdom: the fixture package's comparators live beside its
// container harness, and nothing here renders.
import { createSnapshot } from '@formancy/data-core'
import type { MetadataSnapshot } from '@formancy/data-core'
import { POSTGRES_IMAGE, restrictedDisagreements, snapshotDisagreements, SQLSERVER_IMAGE } from '@formancy/data-fixtures'
import { describe, expect, test } from 'vitest'
import owner from './fixtures/postgres-owner.json'
import reader from './fixtures/postgres-reader.json'
import sqlserver from './fixtures/sqlserver-owner.json'
import { OWNER_SNAPSHOT, READER_SNAPSHOT, readSnapshot, SQLSERVER_SNAPSHOT } from './test-server.js'

/**
 * The databases the suite's server discovers are captured from the shared
 * fixture on both engines by `scripts/capture-snapshots.mjs`, never written by
 * hand. These cases are what keeps them so.
 */
const FILES: ReadonlyArray<[string, unknown]> = [
  ['the owner', owner],
  ['the restricted reader', reader],
  ['the SQL Server owner', sqlserver],
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

  // The reader is the point of the second file: it sees sales.order, and for
  // everything else it says it cannot see rather than nothing.
  test('the reader sees what the restricted fixture grants, and says what it cannot see', () => {
    expect(restrictedDisagreements(READER_SNAPSHOT)).toEqual([])
    expect(READER_SNAPSHOT.objects.map((object) => `${object.ref.schema}.${object.ref.name}`)).toEqual(['sales.order'])
    expect(READER_SNAPSHOT.gaps.length).toBeGreaterThan(0)
  })

  // The version is printed by the studio and is outside the fingerprint, so
  // an edit to it would pass the cases above. It must be the major of the
  // image the fixture runs -- for SQL Server, the product version its year
  // names, which is what the server reports.
  test('each names a server version from the image the fixture runs', () => {
    const major = /^postgres:(\d+)/.exec(POSTGRES_IMAGE)?.[1]
    expect(major).toBeDefined()
    for (const snapshot of [OWNER_SNAPSHOT, READER_SNAPSHOT]) expect(snapshot.serverVersion.split('.')[0]).toBe(major)
    const year = /server:(\d{4})/.exec(SQLSERVER_IMAGE)?.[1]
    const PRODUCT_VERSIONS: Record<string, string> = { '2019': '15', '2022': '16', '2025': '17' }
    expect(SQLSERVER_SNAPSHOT.serverVersion.split('.')[0]).toBe(PRODUCT_VERSIONS[year ?? ''])
  })
})
