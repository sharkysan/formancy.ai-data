/**
 * Who may read a connection's rows, and the setting that names them (0099).
 *
 * `FORMANCY_DATA_BROWSE_ROLES` is read by the composition root (main.ts) and
 * parsed here, so the rule is tested without starting a process;
 * `adminRoutes` holds an embedder's `browseRoles` to the same rule. Unset,
 * nobody browses: publishing a form and reading every row of every table
 * are different permissions, and the second is never granted by the first.
 */

export type BrowseRolesSetting = { ok: true; browseRoles: string[] | undefined } | { ok: false; problem: string }

interface Names {
  browse: string
  admin: string
}

const EMBEDDED: Names = { browse: 'admin.browseRoles', admin: 'admin.adminRoles' }
const SETTING: Names = { browse: 'FORMANCY_DATA_BROWSE_ROLES', admin: 'FORMANCY_DATA_ADMIN_ROLES' }

/**
 * What is wrong with `roles` as the roles that browse beside `adminRoles`,
 * or `undefined`: a list naming at least one role, each of them also a role
 * the administrator's plane admits, which the browse route is on. A role is
 * named in the sentence: it is a word in a token's claim, never a secret.
 */
export function browseRolesProblem(roles: readonly string[], adminRoles: readonly string[], names: Names = EMBEDDED): string | undefined {
  if (!Array.isArray(roles)) return `${names.browse} is not a list of roles.`
  if (roles.length === 0) return `${names.browse} is set and names no role. Name the roles that may browse, or leave it unset so that nobody does.`
  const outside = roles.find((role) => !adminRoles.includes(role))
  if (outside !== undefined)
    return `${names.browse} names ${JSON.stringify(outside)}, which is not in ${names.admin}: a browser is an administrator who may also read rows.`
  return undefined
}

/**
 * `FORMANCY_DATA_BROWSE_ROLES` as written: unset is nobody; otherwise roles
 * separated by commas, space around each ignored, each counted once. Set and
 * naming no role, set while the administrator's plane is off, or naming a
 * role `adminRoles` does not have, it refuses with the sentence main.ts
 * prints.
 */
export function browseRolesSetting(text: string | undefined, plane: { adminRoles: readonly string[]; admin: boolean }): BrowseRolesSetting {
  if (text === undefined) return { ok: true, browseRoles: undefined }
  const roles = [
    ...new Set(
      text
        .split(',')
        .map((role) => role.trim())
        .filter((role) => role !== ''),
    ),
  ]
  if (roles.length > 0 && !plane.admin) {
    return {
      ok: false,
      problem: `${SETTING.browse} names browsers, and the administrator's plane is off: set FORMANCY_DATA_STORE_DIR, FORMANCY_DATA_CONNECTIONS and ${SETTING.admin}, or leave it unset.`,
    }
  }
  const problem = browseRolesProblem(roles, plane.adminRoles, SETTING)
  return problem === undefined ? { ok: true, browseRoles: roles } : { ok: false, problem }
}
