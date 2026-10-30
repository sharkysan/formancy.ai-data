import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { Refusal } from './client.js'
import { ENGINES, startPlane } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * Deleting a record through the client, on both engines (0050), across real
 * HTTP into the real server and its drivers, over the parity schema's table
 * a clerk may delete from within their tenant. What stale is, and whether a
 * second deletion finds anything, are database answers, so they are asked
 * of the databases.
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
})
