/**
 * Who approves publication, and the setting that turns review on (0065).
 *
 * `FORMANCY_DATA_PUBLISHER_ROLES` is read by the composition root (main.ts)
 * and parsed here, so the rule is tested without starting a process;
 * `adminRoutes` holds an embedder's `publisherRoles` to the same rule. Unset,
 * there is no review and every administrator publishes alone, as before
 * 0065. Set, nobody publishes directly: an administrator submits a draft and
 * a holder of one of these roles, other than its submitter, approves it.
 */

export type PublisherRolesSetting = { ok: true; publisherRoles: string[] | undefined } | { ok: false; problem: string }

interface Names {
  publisher: string
  admin: string
}

const EMBEDDED: Names = { publisher: 'admin.publisherRoles', admin: 'admin.adminRoles' }
const SETTING: Names = { publisher: 'FORMANCY_DATA_PUBLISHER_ROLES', admin: 'FORMANCY_DATA_ADMIN_ROLES' }

/**
 * What is wrong with `roles` as the roles that publish beside `adminRoles`,
 * or `undefined`: a list naming at least one role, each of them also a role
 * the administrator's plane admits -- a publisher is an administrator who
 * may also approve, and a role the plane refuses at its door could approve
 * nothing. A role is named in the sentence: it is a word in a token's
 * claim, never a secret.
 */
export function publisherRolesProblem(roles: readonly string[], adminRoles: readonly string[], names: Names = EMBEDDED): string | undefined {
  if (!Array.isArray(roles)) return `${names.publisher} is not a list of roles.`
  if (roles.length === 0) {
    return `${names.publisher} is set and names no role: a deployment under review that nobody can publish to is not one anybody meant. Name the roles that approve, or leave it unset for no review.`
  }
  const outside = roles.find((role) => !adminRoles.includes(role))
  if (outside !== undefined) return `${names.publisher} names ${JSON.stringify(outside)}, which is not in ${names.admin}: a publisher is an administrator who may also approve.`
  return undefined
}

/**
 * `FORMANCY_DATA_PUBLISHER_ROLES` as written: unset is no review; otherwise
 * roles separated by commas, space around each ignored, each counted once.
 * Set and naming no role, set while the administrator's plane is off -- no
 * store, no allowlist or no administrator role -- or naming a role
 * `adminRoles` does not have, it refuses with the sentence main.ts prints.
 */
export function publisherRolesSetting(text: string | undefined, plane: { adminRoles: readonly string[]; admin: boolean }): PublisherRolesSetting {
  if (text === undefined) return { ok: true, publisherRoles: undefined }
  const roles = [...new Set(text.split(',').map((role) => role.trim()).filter((role) => role !== ''))]
  if (roles.length > 0 && !plane.admin) {
    return { ok: false, problem: `${SETTING.publisher} names publishers, and the administrator's plane is off: set FORMANCY_DATA_STORE_DIR, FORMANCY_DATA_CONNECTIONS and ${SETTING.admin}, or leave it unset.` }
  }
  const problem = publisherRolesProblem(roles, plane.adminRoles, SETTING)
  return problem === undefined ? { ok: true, publisherRoles: roles } : { ok: false, problem }
}
