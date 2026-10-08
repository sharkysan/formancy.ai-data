// @vitest-environment node
//
// Node rather than jsdom: the fixture package's comparator lives beside its
// container harness, and nothing here renders.
import { createSnapshot } from '@formancy/data-core'
import type { MetadataSnapshot } from '@formancy/data-core'
import { POSTGRES_IMAGE, snapshotDisagreements } from '@formancy/data-fixtures'
import { describe, expect, test } from 'vitest'
import customers from './fixture-customers.json'
import captured from './fixture-snapshot.json'
import { FIXTURE_SNAPSHOT, readSnapshot } from './snapshot.js'

/** The committed file, as data, with nothing assumed about its shape. */
function committed(): MetadataSnapshot {
  return structuredClone(captured) as unknown as MetadataSnapshot
}

describe('the committed fixture snapshot', () => {
  // A hand edit -- a column made nullable to see what the form does -- would
  // render a form for a database that does not exist, on a page that says it
  // was captured from PostgreSQL. The fingerprint is recomputed over the
  // contents, so every edit that is not a re-capture fails here.
  test("its fingerprint is what createSnapshot computes over its contents", () => {
    const { fingerprint, ...contents } = committed()
    expect(createSnapshot(contents).fingerprint).toBe(fingerprint)
  })

  // The file is the canonical form, not merely one that hashes the same: a
  // re-capture is then a diff of what the database changed, and a reviewer
  // reading it is not reading a reordering.
  test('is exactly what createSnapshot makes of it', () => {
    const { fingerprint: _, ...contents } = committed()
    expect(createSnapshot(contents)).toEqual(committed())
  })

  // The page checks before it generates, as the server checks a published
  // bundle every time it reads one (0019). Without this an edited file would
  // still render, and only the suite would have said anything.
  test('the page refuses an edited copy rather than generating from it', () => {
    const edited = committed()
    const column = edited.objects[0]?.columns[0]
    if (column === undefined) throw new Error('the snapshot has no first column to edit')
    column.nullable = !column.nullable
    expect(() => readSnapshot(edited)).toThrow(/fingerprint/)
    expect(readSnapshot(committed())).toEqual(FIXTURE_SNAPSHOT)
  })

  // The fixture changes and the snapshot does not follow until somebody runs
  // the capture again. The model is what both adapters answer to (0005), so a
  // snapshot it disagrees with shows forms for a database neither suite
  // describes -- and this is where that is noticed, without a container.
  test('still describes the shared fixture model', () => {
    expect(snapshotDisagreements(FIXTURE_SNAPSHOT)).toEqual([])
  })

  // The version is printed on the page and is outside the fingerprint, so an
  // edit to it would pass the tests above. It must be the major the fixture's
  // image names.
  test('names a server version from the image the fixture runs', () => {
    const major = /^postgres:(\d+)/.exec(POSTGRES_IMAGE)?.[1]
    expect(major).toBeDefined()
    expect(FIXTURE_SNAPSHOT.kind).toBe('postgres')
    expect(FIXTURE_SNAPSHOT.serverVersion.split('.')[0]).toBe(major)
  })

  // The lookup's rows and the snapshot come from one capture. A re-capture of
  // one file without the other would offer customers from a database the
  // forms were not generated from.
  test('was captured together with the customers the lookup offers', () => {
    expect(customers.snapshotFingerprint).toBe(FIXTURE_SNAPSHOT.fingerprint)
  })
})
