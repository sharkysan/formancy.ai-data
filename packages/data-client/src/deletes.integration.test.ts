import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { Refusal } from './client.js'
import { ENGINES, startPlane } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * Deleting a record through the client, on both engines (0050), across real
 * HTTP into the real server and its drivers, over the parity schema's table
 * a clerk may delete from within their tenant -- and the chosen records of
 * a page deleted (0173) or changed (0175) together. What stale is, and
 * whether a second deletion finds anything, are database answers, so they
 * are asked of the databases.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ removable: true })
})

afterAll(async () => {
  await plane?.close()
})

function expectOk<T>(outcome: { ok: true; value: T } | Refusal | { ok: false }): T {
  if (!outcome.ok) throw new Error(`expected success, got ${JSON.stringify(outcome)}`)
  return (outcome as { value: T }).value
}

describe.each(ENGINES)('a deletion through the client on $engine', ({ connection }) => {
  const formId = `${connection}-removable`

  // The form says delete and what it also does: nothing cascades or clears,
  // and the database may keep a record other rows refer to.
  test('the form offers delete, with what a delete also does', async () => {
    expect(expectOk(await plane.client().form(formId))).toMatchObject({
      operations: ['read', 'create', 'update', 'delete'],
      deleting: { cascades: false, clears: false, restricted: true },
    })
  })

  // A clerk deletes her record at the version she read: the answer is its
  // token and `deleted`, a read of it is then 404, and a second deletion is
  // a refusal, not found -- never an unknown write. Another tenant's clerk
  // is refused it as a record that does not exist, and a deletion at a
  // version since superseded is stale.
  test("deletes the clerk's record, and refuses another tenant's clerk, a stale version and a second deletion", async () => {
    const clerk = plane.client()
    const created = expectOk(await clerk.create(formId, { note: `delete through the client ${connection}` }))
    const record = created.record ?? ''
    const version = created.version ?? ''
    expect(await plane.client(plane.tokens.otherClerk).delete(formId, { record, version })).toEqual({
      ok: false,
      status: 404,
      code: 'not-found',
      message: 'No such record.',
    })

    const saved = expectOk(await clerk.update(formId, { record, version, answers: { note: 'changed' } }))
    expect(await clerk.delete(formId, { record, version })).toMatchObject({ ok: false, status: 409, code: 'stale' })

    expect(await clerk.delete(formId, { record, version: saved.version ?? '' })).toEqual({ ok: true, value: { record, deleted: true } })
    expect(await clerk.read(formId, record)).toMatchObject({ ok: false, status: 404, code: 'not-found' })
    expect(await clerk.delete(formId, { record, version: saved.version ?? '' })).toMatchObject({ ok: false, status: 404, code: 'not-found' })
  })

  // The chosen records of a page deleted together (0173): the form says a
  // clerk may, and each record is read as its delete alone would be -- the
  // clerk's own deleted, one changed since it was read stale, another
  // tenant's not found -- in the order sent, the request going on past the
  // two it could not delete. What was kept is there to read.
  test('deletes chosen records each on its own, and reads each as a delete of it alone', async () => {
    const clerk = plane.client()
    expect(expectOk(await clerk.form(formId))).toMatchObject({ bulk: { delete: true } })
    const created = async (note: string, as = clerk) => {
      const made = expectOk(await as.create(formId, { note }))
      return { record: made.record ?? '', version: made.version ?? '' }
    }
    const first = await created(`chosen through the client ${connection}`)
    const changed = await created(`changed since it was read ${connection}`)
    const theirs = await created(`another tenant's ${connection}`, plane.client(plane.tokens.otherClerk))
    const last = await created(`chosen last ${connection}`)
    expectOk(await clerk.update(formId, { ...changed, answers: { note: 'changed' } }))

    const outcome = await clerk.deleteChosen(formId, { records: [first, changed, theirs, last] })
    expect(outcome).toEqual({
      ok: true,
      value: [
        { ok: true, value: { record: first.record, deleted: true } },
        { ok: false, status: 409, code: 'stale', message: expect.any(String) },
        { ok: false, status: 404, code: 'not-found', message: 'No such record.' },
        { ok: true, value: { record: last.record, deleted: true } },
      ],
    })
    expect(await clerk.read(formId, first.record)).toMatchObject({ ok: false, status: 404 })
    expect(expectOk(await clerk.read(formId, changed.record))).toMatchObject({ record: changed.record })
  })

  // The chosen records of a page changed together (0175): the form says a
  // clerk may, in the note, and each record is read as its update alone
  // would be -- the clerk's own changed and answered as stored, one changed
  // since it was read stale, another tenant's not found -- in the order
  // sent, the request going on past the two it could not change. A field
  // ticked and sent empty, `null`, clears it.
  test('changes chosen records each on its own, and reads each as an update of it alone', async () => {
    const clerk = plane.client()
    expect(expectOk(await clerk.form(formId))).toMatchObject({ bulk: { update: ['note'] } })
    const created = async (note: string, as = clerk) => {
      const made = expectOk(await as.create(formId, { note }))
      return { record: made.record ?? '', version: made.version ?? '' }
    }
    const first = await created(`changed through the client ${connection}`)
    const since = await created(`changed since it was read ${connection}`)
    const theirs = await created(`another tenant's to change ${connection}`, plane.client(plane.tokens.otherClerk))
    const last = await created(`changed last ${connection}`)
    expectOk(await clerk.update(formId, { ...since, answers: { note: 'changed' } }))

    const outcome = await clerk.updateChosen(formId, { records: [first, since, theirs, last], answers: { note: 'changed together' } })
    expect(outcome).toMatchObject({
      ok: true,
      value: [
        { ok: true, value: { record: first.record, answers: { note: 'changed together' } } },
        { ok: false, status: 409, code: 'stale' },
        { ok: false, status: 404, code: 'not-found', message: 'No such record.' },
        { ok: true, value: { record: last.record, answers: { note: 'changed together' } } },
      ],
    })
    expect(expectOk(await clerk.read(formId, since.record))).toMatchObject({ answers: { note: 'changed' } })
    const cleared = await clerk.updateChosen(formId, {
      records: [{ record: last.record, version: expectOk(await clerk.read(formId, last.record)).version ?? '' }],
      answers: { note: null },
    })
    expect(cleared).toMatchObject({ ok: true, value: [{ ok: true, value: { answers: { note: null } } }] })
  })
})
