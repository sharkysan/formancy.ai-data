import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { ConfigurationStore } from './config-store.js'
import { createFileConfigurationStore } from './config-store.js'

let root: string
let store: ConfigurationStore

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'formancy-data-store-'))
  store = createFileConfigurationStore(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('the file configuration store', () => {
  // The first publish has no base, and later ones name the version they edited.
  test('publishes versions in order and reads each back unchanged', async () => {
    expect(await store.latest('sales-order')).toBeNull()
    expect(await store.publish('sales-order', null, { title: 'one' })).toEqual({ ok: true, version: 1 })
    expect(await store.publish('sales-order', 1, { title: 'two' })).toEqual({ ok: true, version: 2 })
    expect(await store.latest('sales-order')).toBe(2)
    expect(await store.read('sales-order', 1)).toEqual({ title: 'one' })
    expect(await store.read('sales-order', 2)).toEqual({ title: 'two' })
    expect(await store.read('sales-order', 3)).toBeUndefined()
  })

  // Two administrators edit version 1 and both publish. Without the check the
  // second would silently replace the first one's work.
  test('a publish from a stale base is a conflict, and names what is current', async () => {
    await store.publish('sales-order', null, { by: 'a' })
    await store.publish('sales-order', 1, { by: 'b' })
    expect(await store.publish('sales-order', 1, { by: 'c' })).toEqual({ ok: false, reason: 'conflict', current: 2 })
    expect(await store.publish('sales-order', null, { by: 'd' })).toEqual({ ok: false, reason: 'conflict', current: 2 })
    expect(await store.read('sales-order', 2)).toEqual({ by: 'b' })
  })

  // The case the check-then-act above cannot cover alone: both read the same
  // newest version at the same moment. The hard link is what decides, and it
  // must decide exactly once — twenty racers, one winner, no torn file.
  test('of many concurrent publishes from one base, exactly one wins', async () => {
    await store.publish('sales-order', null, { n: 0 })
    const stores = Array.from({ length: 20 }, () => createFileConfigurationStore(root))
    const outcomes = await Promise.all(stores.map((each, n) => each.publish('sales-order', 1, { n: n + 1 })))
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1)
    expect(outcomes.filter((outcome) => !outcome.ok).every((outcome) => !outcome.ok && outcome.current === 2)).toBe(true)
    expect(await store.latest('sales-order')).toBe(2)
    const winner = outcomes.findIndex((outcome) => outcome.ok)
    expect(await store.read('sales-order', 2)).toEqual({ n: winner + 1 })
    // Every racer cleaned up its temporary file, winner and losers alike.
    expect((await readdir(join(root, 'sales-order'))).sort()).toEqual(['1.json', '2.json'])
  })

  // A crash between writing and linking leaves a temporary file. It is not a
  // version and must never be mistaken for one.
  test('ignores leftovers that are not versions', async () => {
    await store.publish('sales-order', null, { ok: true })
    await writeFile(join(root, 'sales-order', '.publishing-crashed'), '{"half":')
    await writeFile(join(root, 'sales-order', 'notes.txt'), 'hello')
    await writeFile(join(root, 'sales-order', '07.json'), '{}')
    expect(await store.latest('sales-order')).toBe(1)
    expect(await store.list()).toEqual(['sales-order'])
  })

  // A published version edited by hand is no longer what was reviewed.
  // Serving a guess in its place would be worse than refusing.
  test('refuses to read a version that is not valid JSON', async () => {
    await store.publish('sales-order', null, {})
    await writeFile(join(root, 'sales-order', '1.json'), '{ broken')
    await expect(store.read('sales-order', 1)).rejects.toThrow(/must never be edited/)
  })

  // An id becomes a directory name. One that could climb out of the root, or
  // name a hidden file, is refused before it touches a path. So is upper case:
  // on a case-insensitive filesystem Sales-Order and sales-order are one
  // directory, and one form would silently read the other's bundle.
  test('refuses ids that are not plain names, and versions that are not whole positive numbers', async () => {
    for (const id of ['..', '../etc', 'a/b', 'a\\b', '.hidden', '', 'x'.repeat(129), 'Sales-Order']) {
      await expect(store.latest(id)).rejects.toThrow(/not a configuration id/)
      await expect(store.publish(id, null, {})).rejects.toThrow(/not a configuration id/)
    }
    for (const version of [0, -1, 1.5, Number.NaN]) {
      await expect(store.read('sales-order', version)).rejects.toThrow(/not a version/)
    }
  })

  // A volume path that names a file is a misconfiguration. Reporting it as an
  // empty store would hide every published form behind "not found".
  test('a root that is a file fails loudly instead of looking empty', async () => {
    const file = join(root, 'not-a-directory')
    await writeFile(file, 'x')
    const misconfigured = createFileConfigurationStore(file)
    await expect(misconfigured.list()).rejects.toThrow(/is not a directory/)
    await expect(misconfigured.latest('sales-order')).rejects.toThrow(/is not a directory/)
    await expect(misconfigured.read('sales-order', 1)).rejects.toThrow(/is not a directory/)
    await expect(misconfigured.publish('sales-order', null, {})).rejects.toThrow(/is not a directory/)
  })

  // An empty store, or one whose directory does not exist yet, lists nothing
  // rather than failing — a fresh volume is the first state every deployment has.
  test('lists ids in codepoint order, and nothing for a store that does not exist yet', async () => {
    expect(await createFileConfigurationStore(join(root, 'missing')).list()).toEqual([])
    await store.publish('b', null, {})
    await store.publish('a.1', null, {})
    await store.publish('a-1', null, {})
    await store.publish('a', null, {})
    expect(await store.list()).toEqual(['a', 'a-1', 'a.1', 'b'])
  })
})
