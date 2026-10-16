import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDataServer } from './app.js'
import { createFileConfigurationStore } from './config-store.js'
import type { ConnectionRegistry } from './connections.js'
import { publisherRolesProblem, publisherRolesSetting } from './publisher-roles.js'

/*
 * FORMANCY_DATA_PUBLISHER_ROLES, as the composition root reads it (0065):
 * the roles whose holders approve another administrator's draft. Unset is
 * no review, which is how every deployment ran before; anything set that
 * nobody could have meant stops the process with one sentence rather than
 * starting a server that reviews with nobody to approve, or approves by a
 * role that cannot reach the plane.
 */

const ON = { adminRoles: ['data-admin', 'data-publisher'], admin: true }

describe('publisherRolesSetting', () => {
  // A deployment that upgrades and sets nothing keeps publishing as it
  // did: one administrator, alone. Review that came on with the release
  // would stop every publish of every deployment on the day it upgraded.
  test('unset is no review', () => {
    expect(publisherRolesSetting(undefined, ON)).toEqual({ ok: true, publisherRoles: undefined })
    expect(publisherRolesSetting(undefined, { adminRoles: [], admin: false })).toEqual({ ok: true, publisherRoles: undefined })
  })

  // Comma-separated as FORMANCY_DATA_ADMIN_ROLES is, space around each
  // ignored and a role named twice counted once.
  test('reads comma-separated roles, each also an administrator role', () => {
    expect(publisherRolesSetting('data-publisher', ON)).toEqual({ ok: true, publisherRoles: ['data-publisher'] })
    expect(publisherRolesSetting(' data-publisher , data-admin,data-publisher ', ON)).toEqual({ ok: true, publisherRoles: ['data-publisher', 'data-admin'] })
  })

  // Set and empty is review with no publisher: every draft waits for an
  // approval nobody can give, and no version is ever written again. Not
  // something anybody meant, so it is not started.
  test.each(['', ' ', ',', ' , ,'])('stops on %j, which names no role', (text) => {
    const read = publisherRolesSetting(text, ON)
    expect(read.ok).toBe(false)
    expect(!read.ok && read.problem).toBe('FORMANCY_DATA_PUBLISHER_ROLES is set and names no role: a deployment under review that nobody can publish to is not one anybody meant. Name the roles that approve, or leave it unset for no review.')
  })

  // A publisher is an administrator who may also approve: a role the
  // plane does not admit would be refused at the plane's door before its
  // holder could approve anything, and the deployment would have no
  // publisher it can reach. The role is named, so the fix is in the line.
  test('stops on a role that is not an administrator role, naming it', () => {
    const read = publisherRolesSetting('data-publisher,data-approver', ON)
    expect(read).toEqual({ ok: false, problem: 'FORMANCY_DATA_PUBLISHER_ROLES names "data-approver", which is not in FORMANCY_DATA_ADMIN_ROLES: a publisher is an administrator who may also approve.' })
  })

  // Without the administrator's plane there is nothing to review: the
  // setting would be read, and nothing it says would happen. Stopped, as a
  // CORS list is stopped beside a server with no runtime plane.
  test('stops when the administrator plane is off', () => {
    const read = publisherRolesSetting('data-publisher', { adminRoles: ['data-publisher'], admin: false })
    expect(read).toEqual({ ok: false, problem: "FORMANCY_DATA_PUBLISHER_ROLES names publishers, and the administrator's plane is off: set FORMANCY_DATA_STORE_DIR, FORMANCY_DATA_CONNECTIONS and FORMANCY_DATA_ADMIN_ROLES, or leave it unset." })
    expect(publisherRolesSetting('data-publisher', { adminRoles: [], admin: false }).ok).toBe(false)
  })
})

describe('publisherRolesProblem', () => {
  // The same rule for an embedder's `admin.publisherRoles`, which no
  // environment variable reads: an empty list, a role the plane does not
  // admit, and a value that is no list from a caller the type does not
  // reach -- a .mjs file -- each stop the server being built.
  test('holds an embedder\'s list to the setting\'s rule', () => {
    expect(publisherRolesProblem(['data-publisher'], ['data-admin', 'data-publisher'])).toBeUndefined()
    expect(publisherRolesProblem([], ['data-admin'])).toMatch(/^admin\.publisherRoles is set and names no role/)
    expect(publisherRolesProblem(['data-approver'], ['data-admin'])).toBe('admin.publisherRoles names "data-approver", which is not in admin.adminRoles: a publisher is an administrator who may also approve.')
    expect(publisherRolesProblem('data-publisher' as never, ['data-publisher'])).toBe('admin.publisherRoles is not a list of roles.')
  })
})

describe('createDataServer', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'formancy-data-publisher-roles-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  /** The administrator's plane with `publisherRoles`, built or refused: nothing is connected, and the store is never written. */
  const built = (publisherRoles: readonly string[]) => {
    const registry: ConnectionRegistry = { ids: () => [], scope: () => undefined, open: async () => undefined, close: async () => {} }
    const store = createFileConfigurationStore(root)
    return createDataServer({ verifyIdentity: async () => ({ ok: false, reason: 'bad' }), admin: { registry, store, adminRoles: ['data-admin', 'data-publisher'], publisherRoles, audit: { sink: () => {} } } }).then(async (app) => {
      await app.close()
      return 'built'
    })
  }

  // The rule above is a function until the plane asks it. An embedder's
  // empty list would put the plane under review with nobody to approve; a
  // role the plane does not admit, review whose publisher is refused at
  // the door; a string from a .mjs caller, a Set of its characters, every
  // one a "role". Each stops the server being built, in the sentence the
  // function says. Watched failing with the plane's throw taken out: the
  // empty list was built.
  test("refuses an embedder's admin.publisherRoles the rule refuses, and builds with one it accepts", async () => {
    await expect(built([])).rejects.toThrow(/^admin\.publisherRoles is set and names no role/)
    await expect(built(['data-approver'])).rejects.toThrow('admin.publisherRoles names "data-approver", which is not in admin.adminRoles')
    await expect(built('data-publisher' as never)).rejects.toThrow('admin.publisherRoles is not a list of roles.')
    await expect(built(['data-publisher'])).resolves.toBe('built')
  })
})
