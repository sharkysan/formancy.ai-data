import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import type { ConfigurationStore } from '../config-store.js'
import { REFUSALS } from '../governance.js'
import {
  ADMIN_ROLES,
  answer,
  approve,
  as,
  db,
  INTERNAL,
  lines,
  proposed,
  published,
  PUBLISHER_ROLES,
  queue,
  read,
  registry,
  reject,
  root,
  serve,
  store,
  submit,
  useDrafts,
  verifyIdentity,
} from './test-drafts.js'

/*
 * The drafts under review (0065) as files on the volume: a store beside
 * the versions, numbered by its own compare-and-swap, read whole for each
 * form and never edited. What a store that cannot be read, or holds a file
 * edited by hand, answers; what concurrent appends number; and what the
 * queue lists. The routes' own decisions are admin-drafts.test.ts's.
 */

useDrafts()

describe('the drafts store', () => {
  // A draft is files on the volume, as a version is (0013), and a file can
  // be edited by hand. A draft that no longer validates is not what was
  // submitted: never served, approved or rejected, and the operator's log
  // says which form's entry. A form's drafts are read whole, since a
  // damaged entry could be the rejection of any draft before it, so the
  // form takes no new draft until the file is put right; the queue still
  // lists every other form's, and names the form it could not read.
  test('a draft entry edited on disk is 500 and never served, the log names the form and the entry, and other forms are still queued', async () => {
    await submit('author', { expectedBase: null, bundle: await proposed() })
    await submit('author', { expectedBase: null, bundle: await proposed({ formId: 'staff', title: 'Staff' }) }, 'staff')
    const file = join(root, '.drafts', 'employee', '1.json')
    const entry = JSON.parse(await readFile(file, 'utf8')) as {
      bundle: { snapshot: { objects: Array<{ columns: Array<{ name: string; type: { maxLength?: number } }> }> } }
    }
    const name = entry.bundle.snapshot.objects[0]?.columns.find((column) => column.name === 'name')
    if (name !== undefined) name.type.maxLength = 4000
    await writeFile(file, JSON.stringify(entry, null, 2))
    lines.length = 0
    for (const response of [
      await read('publisher', 1),
      await approve('publisher', 1),
      await reject('publisher', 1),
      await submit('author', { expectedBase: null, bundle: await proposed() }),
    ]) {
      expect(answer(response)).toEqual([500, INTERNAL])
    }
    expect(await store.latest('employee')).toBeNull()
    expect(await store.drafts().versions('employee')).toEqual([1])
    expect(
      lines.filter((line) => line.msg === 'a draft entry does not validate, and is not served').map(({ form, entry: number }) => ({ form, entry: number })),
    ).toEqual(Array.from({ length: 4 }, () => ({ form: 'employee', entry: 1 })))
    expect((await queue('publisher')).json()).toEqual({ drafts: [expect.objectContaining({ form: 'staff', draft: 1 })], unreadable: ['employee'] })

    await writeFile(file, '{ broken')
    expect(answer(await read('publisher', 1))).toEqual([500, INTERNAL])
  })

  // A drafts store that cannot be listed, read or written -- a volume
  // whose permissions changed -- is the operator's to put right. The
  // caller is told only that, as the menu tells a person (0045): Fastify's
  // own 500 would answer with the error, the volume's path in it. A store
  // that refuses every append and names nothing newer is thrown, not
  // retried for ever.
  test('a drafts store that cannot answer is 500 naming no path, and an append that cannot progress stops', async () => {
    const bundle = await proposed()
    expect((await submit('author', { expectedBase: null, bundle })).statusCode).toBe(201)
    expect((await submit('author', { expectedBase: null, bundle: await proposed({ formId: 'staff', title: 'Staff' }) }, 'staff')).statusCode).toBe(201)
    const denied = () => Object.assign(new Error(`EACCES: permission denied, open '${root}'`), { code: 'EACCES' })
    const inner = store.drafts()
    const failing: ConfigurationStore = {
      ...store,
      publish: async () => {
        throw denied()
      },
      drafts: () => ({
        ...inner,
        list: async () => {
          throw denied()
        },
        read: async (id, version) => {
          if (id === 'staff') throw denied()
          return inner.read(id, version)
        },
        publish: async (_id, expectedBase) => ({ ok: false, reason: 'conflict', current: expectedBase }),
      }),
    }
    const broken = await createDataServer({
      verifyIdentity,
      admin: { registry: registry(), store: failing, adminRoles: ADMIN_ROLES, publisherRoles: PUBLISHER_ROLES, audit: { sink: () => {} } },
    })
    const call = (method: 'GET' | 'POST', url: string, token: string, payload?: Record<string, unknown>) =>
      broken.inject({ method, url, headers: as(token), ...(payload === undefined ? {} : { payload }) })
    for (const response of [
      await call('GET', '/v1/drafts', 'publisher'),
      await call('GET', '/v1/forms/staff/drafts/1', 'publisher'),
      await call('POST', '/v1/forms/employee/drafts', 'author', { expectedBase: null, bundle }),
      await call('POST', '/v1/forms/employee/drafts/1/rejection', 'publisher'),
      await call('POST', '/v1/forms/employee/drafts/1/approval', 'publisher'),
    ]) {
      expect(answer(response)).toEqual([500, INTERNAL])
      expect(response.body).not.toContain(root)
    }
    expect(await store.latest('employee')).toBeNull()
  })

  // The gate a submit and an approval pass reads the versions store too:
  // the base whose keys a draft is compared with (0039). That volume can
  // stop answering as the drafts' can, and is answered the same way: 500,
  // nothing more, the error in the operator's log. Version 1 is written
  // straight into the store, so no draft is approved from it and the
  // draft's own read asks no version; the gate is the first to. Watched
  // failing with the gate's call outside the routes' try: Fastify's own
  // 500, with the error's code, its message and the version file's path.
  test('a versions store the gate cannot read is 500 naming no path, for a submit and an approval', async () => {
    const bundle = await proposed()
    expect((await store.publish('employee', null, bundle)).ok).toBe(true)
    expect((await submit('author', { expectedBase: 1, bundle: await proposed({ role: 'manager' }) })).statusCode).toBe(201)
    const file = join(root, 'employee', '1.json')
    const failing: ConfigurationStore = {
      ...store,
      read: async () => {
        throw Object.assign(new Error(`EACCES: permission denied, open '${file}'`), { code: 'EACCES' })
      },
    }
    const broken = await serve(true, failing)
    lines.length = 0
    for (const response of [
      await submit('author', { expectedBase: 1, bundle: await proposed({ role: 'auditor' }) }, 'employee', broken),
      await approve('publisher', 1, 'employee', broken),
    ]) {
      expect(answer(response)).toEqual([500, INTERNAL])
      expect(response.body).not.toContain('EACCES')
    }
    expect(lines.filter((line) => line.msg === 'the drafts or the versions could not be read or written').map(({ form }) => form)).toEqual([
      'employee',
      'employee',
    ])
    expect(await store.versions('employee')).toEqual([1])
    expect(await store.drafts().versions('employee')).toEqual([1])
  })

  // A version that no longer parses is not served (0019), so it is no
  // draft's: the draft it was approved from reads stale, never published
  // and never a 500, and the version's own read says what is wrong.
  test('a draft whose version was damaged on disk reads stale, not published', async () => {
    await published(await proposed())
    await writeFile(join(root, 'employee', '1.json'), '{ broken')
    expect(answer(await read('publisher', 1))).toEqual([200, expect.objectContaining({ state: 'stale', current: 1 })])
  })

  // Submits are appended by the drafts store's own compare-and-swap, and
  // one that loses the race takes the next number: twenty at once are
  // twenty drafts, each its own bundle, numbered 1 to 20 with none lost.
  // Watched failing with the retry taken out: the losers were 500s.
  test('twenty concurrent submits are numbered 1 to 20, and none is lost', async () => {
    const range = Array.from({ length: 20 }, (_, index) => index + 1)
    const bundles = await Promise.all(range.map((n) => proposed({ role: `clerk-${String(n)}` })))
    const answers = await Promise.all(bundles.map((bundle) => submit('author', { expectedBase: null, bundle })))
    expect(answers.map((each) => each.statusCode)).toEqual(range.map(() => 201))
    const numbers = answers.map((each) => each.json<{ draft: number }>().draft)
    expect([...numbers].sort((a, b) => a - b)).toEqual(range)
    for (const [index, draft] of numbers.entries()) {
      expect((await read('publisher', draft)).json().bundle.policy.operations.read, `draft ${String(draft)}`).toEqual([`clerk-${String(index + 1)}`])
    }
  })

  // The queue is what waits for a publisher: pending drafts only, in form
  // order and by number within a form, which is the order they were
  // submitted in -- an entry holds no time, so across forms there is no
  // older to say. Each says what this caller may not do with it, by the
  // same decision the routes make.
  test('the queue is the pending drafts, by form and number, each with what the caller may not do', async () => {
    await submit('author', { expectedBase: null, bundle: await proposed() })
    await submit('author', { expectedBase: null, bundle: await proposed({ role: 'manager' }) })
    await reject('author', 2)
    await submit('submitter', { expectedBase: null, bundle: await proposed({ formId: 'staff', title: 'Staff' }) }, 'staff')
    await submit('colleague', { expectedBase: null, bundle: await proposed({ role: 'auditor' }) })
    const PR = { code: 'publisher-required', message: REFUSALS['publisher-required'].message }
    const entries = (refuses: Array<Record<string, unknown>>) => [
      { form: 'employee', draft: 1, expectedBase: null, submittedBy: 'author', title: 'Employee', refuses: refuses[0] },
      { form: 'employee', draft: 4, expectedBase: null, submittedBy: 'colleague', title: 'Employee', refuses: refuses[1] },
      { form: 'staff', draft: 1, expectedBase: null, submittedBy: 'submitter', title: 'Staff', refuses: refuses[2] },
    ]
    expect((await queue('publisher')).json()).toEqual({ drafts: entries([{}, {}, {}]), unreadable: [] })
    expect((await queue('submitter')).json()).toEqual({
      drafts: entries([{}, {}, { approve: { code: 'own-draft', message: REFUSALS['own-draft'].message } }]),
      unreadable: [],
    })
    expect((await queue('author')).json()).toEqual({
      drafts: entries([{ approve: PR }, { approve: PR, reject: PR }, { approve: PR, reject: PR }]),
      unreadable: [],
    })
  })

  // A number in a path is a draft's number or nothing: a whole number
  // from 1, as a version is. A rejection's entry has a number and is no
  // draft; a form id the store cannot hold has none.
  test('a draft number is a whole number from 1: anything else is 400, and one no draft has is 404 unknown-draft', async () => {
    await submit('author', { expectedBase: null, bundle: await proposed() })
    await reject('author', 1)
    for (const bad of ['0', '01', '-1', '1.5', 'x', '1e3', '99999999999999999']) {
      for (const response of [await read('publisher', bad), await approve('publisher', bad), await reject('publisher', bad)]) {
        expect([response.statusCode, response.json().code], bad).toEqual([400, 'invalid-request'])
      }
    }
    for (const [draft, form] of [
      [2, 'employee'],
      [7, 'employee'],
      [1, 'staff'],
      [1, 'Employee'],
    ] as const) {
      for (const response of [await read('publisher', draft, form), await approve('publisher', draft, form), await reject('publisher', draft, form)]) {
        expect([response.statusCode, response.json().code], `${form} ${String(draft)}`).toEqual([404, 'unknown-draft'])
      }
    }
  })

  // Read before anything else, as a publish's body is, so a submit the
  // server cannot read never reaches a database: no base, a base that is
  // not a version, no bundle, a confirmation of another shape, a form id
  // the store cannot hold.
  test('a submit body of another shape is 400 before a database is asked', async () => {
    const bundle = await proposed()
    db.reachable = false
    for (const payload of [
      { bundle },
      { expectedBase: '1', bundle },
      { expectedBase: 1.5, bundle },
      { expectedBase: null },
      { expectedBase: null, bundle: [bundle] },
      { expectedBase: null, bundle, keysConfirmed: 'job_title' },
    ]) {
      const response = await submit('author', payload)
      expect([response.statusCode, response.json().code], JSON.stringify(Object.keys(payload))).toEqual([400, 'invalid-request'])
    }
    expect((await submit('author', { expectedBase: null, bundle }, 'Employee')).statusCode).toBe(400)
    expect(await store.drafts().list()).toEqual([])
  })
})
