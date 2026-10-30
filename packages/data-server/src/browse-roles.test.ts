import { describe, expect, test } from 'vitest'
import { browseRolesProblem, browseRolesSetting } from './browse-roles.js'

/*
 * FORMANCY_DATA_BROWSE_ROLES, as the composition root reads it (0099): the
 * roles whose holders may read any table or view of a connection, row by
 * row. Unset is nobody, which is how every deployment ran before; anything
 * set that nobody could have meant stops the process with one sentence.
 */

const ON = { adminRoles: ['data-admin', 'data-browser'], admin: true }

describe('browseRolesSetting', () => {
  // Reading every row of every table is a grant of its own: a deployment that upgrades and sets nothing must not find its administrators reading business data they could not read the day before.
  test('unset is nobody', () => {
    expect(browseRolesSetting(undefined, ON)).toEqual({ ok: true, browseRoles: undefined })
    expect(browseRolesSetting(undefined, { adminRoles: [], admin: false })).toEqual({ ok: true, browseRoles: undefined })
  })

  // Comma-separated as FORMANCY_DATA_ADMIN_ROLES is, space around each ignored and a role named twice counted once.
  test('reads comma-separated roles, each also an administrator role', () => {
    expect(browseRolesSetting(' data-browser , data-admin,data-browser ', ON)).toEqual({ ok: true, browseRoles: ['data-browser', 'data-admin'] })
  })

  // Set and empty would read as "browsing is on" to whoever set it, and let nobody browse.
  test.each(['', ' ', ','])('stops on %j, which names no role', (text) => {
    expect(browseRolesSetting(text, ON)).toEqual({
      ok: false,
      problem: 'FORMANCY_DATA_BROWSE_ROLES is set and names no role. Name the roles that may browse, or leave it unset so that nobody does.',
    })
  })

  // The browse route is on the administrator's plane: a role the plane refuses at its door could browse nothing, and the deployment would have no browser it can reach.
  test('stops on a role that is not an administrator role, naming it', () => {
    expect(browseRolesSetting('data-browser,data-reader', ON)).toEqual({
      ok: false,
      problem:
        'FORMANCY_DATA_BROWSE_ROLES names "data-reader", which is not in FORMANCY_DATA_ADMIN_ROLES: a browser is an administrator who may also read rows.',
    })
  })

  // Without the administrator's plane the setting would be read and nothing it says would happen.
  test('stops when the administrator plane is off', () => {
    expect(browseRolesSetting('data-browser', { adminRoles: ['data-browser'], admin: false })).toEqual({
      ok: false,
      problem:
        "FORMANCY_DATA_BROWSE_ROLES names browsers, and the administrator's plane is off: set FORMANCY_DATA_STORE_DIR, FORMANCY_DATA_CONNECTIONS and FORMANCY_DATA_ADMIN_ROLES, or leave it unset.",
    })
  })
})

describe('browseRolesProblem', () => {
  // An embedder passes the list itself, and adminRoutes holds it to the same rule under the option's own name.
  test('names the embedded options', () => {
    expect(browseRolesProblem([], ['a'])).toBe(
      'admin.browseRoles is set and names no role. Name the roles that may browse, or leave it unset so that nobody does.',
    )
    expect(browseRolesProblem(['b'], ['a'])).toBe(
      'admin.browseRoles names "b", which is not in admin.adminRoles: a browser is an administrator who may also read rows.',
    )
    expect(browseRolesProblem(['a'], ['a'])).toBeUndefined()
  })
})
