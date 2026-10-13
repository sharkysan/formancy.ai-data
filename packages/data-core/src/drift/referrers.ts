import type { InboundKey, ObjectRef } from '../metadata.js'
import { actsOnDelete, deleteEffect, reachOf, unaccepted } from '../policy/cascades.js'
import { findObject, recordsDeleteFacts } from '../snapshot.js'
import { hiding } from './access.js'
import { type Comparison, describe, type Draft, list, sameList, sameRef } from './context.js'

/*
 * What refers to the form's root, and to every table a delete of one of its
 * records reaches, compared (0050, 0051): the foreign keys a delete acts
 * through, recorded on each table since 0049.
 *
 * A key that would make a delete do something the policy has not accepted
 * -- delete, clear or set a default in another table's rows, or carry a
 * cleared reference on by ON UPDATE -- stops delete, by `unaccepted`, the
 * predicate the publish check refuses a grant by, so a form review calls
 * deletable is one that publishes. A key that only refuses a delete is for
 * a person to review: the database enforces it. One gone is noted. A key
 * out of sight behind a `referenced-by` gap is the gap's to say.
 *
 * The reach compared is both snapshots': the published one's, which each
 * delete is planned, locked and guarded over, and the current one's, which a
 * changed key may have widened. Review's alone: a request's description of
 * the root holds no key onto any of them, so the runtime decides delete
 * without this family (0041), and the delete statement's own guard refuses
 * a key the request does not name (0050, 0051). The runtime is never
 * stricter than review.
 */

function sameKey(left: Pick<InboundKey, 'table' | 'name'>, right: Pick<InboundKey, 'table' | 'name'>): boolean {
  return sameRef(left.table, right.table) && left.name === right.name
}

/** Each property of a key that refers to a table, as a person reads it. */
const PROPERTIES: ReadonlyArray<[label: string, show: (key: InboundKey) => string, same: (was: InboundKey, now: InboundKey) => boolean]> = [
  ['its columns', (key) => `(${list(key.columns)})`, (was, now) => sameList(was.columns, now.columns)],
  ['the columns it refers to', (key) => `(${list(key.referencedColumns)})`, (was, now) => sameList(was.referencedColumns, now.referencedColumns)],
  ['on delete', (key) => key.onDelete, (was, now) => was.onDelete === now.onDelete],
  ['on update', (key) => key.onUpdate, (was, now) => was.onUpdate === now.onUpdate],
  ['enforcement', (key) => (key.enforced ? 'enforced' : 'not enforced'), (was, now) => was.enforced === now.enforced],
]

/** How a delete of the root's records meets one table of its reach: it removes rows of it, or it only clears these columns of it. */
type Role = { removes: true } | { removes: false; cleared: readonly string[] }

/** Every table a delete reaches in either snapshot, the root first, with what the delete does to it there; removing its rows wins over clearing them. */
function reach(comparison: Comparison): Array<{ table: ObjectRef; role: Role }> {
  const found: Array<{ table: ObjectRef; role: Role }> = []
  const merge = (table: ObjectRef, role: Role) => {
    const known = found.find((entry) => sameRef(entry.table, table))
    if (known === undefined) found.push({ table, role })
    else if (role.removes) known.role = role
    else if (!known.role.removes) known.role = { removes: false, cleared: [...new Set([...known.role.cleared, ...role.cleared])] }
  }
  for (const snapshot of [comparison.base, comparison.current]) {
    const { removed, cleared } = reachOf(snapshot, comparison.bindings.root)
    for (const table of removed) merge(table, { removes: true })
    for (const { table, columns } of cleared) merge(table, { removes: false, cleared: columns })
  }
  return found
}

/** The keys onto a table a delete acts through, given its role: every one where it removes rows, those over a cleared column where it only clears them. */
function relevant(keys: readonly InboundKey[], role: Role): InboundKey[] {
  return role.removes ? [...keys] : keys.filter((key) => key.referencedColumns.some((column) => role.cleared.includes(column)))
}

/** What a key that changed or appeared means, as a sentence, and whether it stops delete. */
function meaning(comparison: Comparison, key: InboundKey, role: Role, what: string): { acts: boolean; message: string } {
  const { after, policy } = comparison
  const root = describe(after.ref)
  if (role.removes) {
    if (unaccepted(policy, key)) return { acts: true, message: `${what}. ${deleteEffect(after.ref, key).replace(/^d/, 'D')}, which this form does not offer, so delete is blocked until the form is reviewed.` }
    return { acts: false, message: `${what}. On delete it ${key.onDelete === 'restrict' ? 'restricts' : 'takes no action'}: the database refuses to delete a record of ${root} while rows of ${describe(key.table)} refer to it.` }
  }
  const followed = list(key.referencedColumns.filter((column) => role.cleared.includes(column)))
  if (actsOnDelete(key.onUpdate)) {
    return {
      acts: true,
      message: `${what}. It follows ${followed} ON UPDATE ${key.onUpdate.replace('-', ' ').toUpperCase()}: a delete of a record of ${root} clears them, and the change would be carried on into ${describe(key.table)}, which this form does not offer, so delete is blocked until the form is reviewed.`,
    }
  }
  return { acts: false, message: `${what}. On update it ${key.onUpdate === 'restrict' ? 'restricts' : 'takes no action'}: the database refuses to clear ${followed} while rows of ${describe(key.table)} refer to them.` }
}

function drafts(comparison: Comparison, table: ObjectRef, role: Role): Draft[] {
  const { base, current, after } = comparison
  const onto = sameRef(table, after.ref) ? describe(after.ref) : `${describe(table)}, which a delete of ${describe(after.ref)} reaches`
  const was = relevant(findObject(base, table)?.referencedBy ?? [], role)
  const now = relevant(findObject(current, table)?.referencedBy ?? [], role)
  const found: Draft[] = []
  for (const key of now) {
    const earlier = was.find((candidate) => sameKey(candidate, key))
    const changed = earlier === undefined ? [] : PROPERTIES.filter(([, , same]) => !same(earlier, key)).map(([label, show]) => `${label} from ${show(earlier)} to ${show(key)}`)
    if (earlier !== undefined && changed.length === 0) continue
    const what = earlier === undefined ? `${key.name} of ${describe(key.table)} is a new foreign key that refers to ${onto}` : `${key.name} of ${describe(key.table)}, which refers to ${onto}, changed: ${changed.join('; ')}`
    const { acts, message } = meaning(comparison, key, role, what)
    found.push({
      kind: earlier === undefined ? 'referrer-added' : 'referrer-changed',
      subject: { kind: 'foreign-key', object: key.table, name: key.name },
      affects: [],
      stops: acts ? ['delete'] : [],
      breaksReads: false,
      otherwise: 'review',
      message,
    })
  }
  // Out of sight is not gone: the gap reports itself, and stops delete.
  if (hiding(current.gaps, table, 'referenced-by').length > 0) return found
  for (const key of was) {
    if (now.some((candidate) => sameKey(candidate, key))) continue
    found.push({
      kind: 'referrer-changed',
      subject: { kind: 'foreign-key', object: key.table, name: key.name },
      affects: [],
      stops: [],
      breaksReads: false,
      otherwise: 'info',
      message: `${key.name} of ${describe(key.table)}, which referred to ${onto}, is gone. A delete of this form reaches nothing through it now.`,
    })
  }
  return found
}

export function referrerChanges(comparison: Comparison): Draft[] {
  const { base, current, after } = comparison
  // A base taken before 0049 says nothing to compare, and a form generated
  // from it offers no delete: every key would be "new" (0049).
  if (!recordsDeleteFacts(base)) return []
  if (!recordsDeleteFacts(current)) {
    return [
      {
        kind: 'access-narrowed',
        subject: { kind: 'object', object: after.ref },
        affects: [],
        stops: ['delete'],
        breaksReads: false,
        otherwise: 'review',
        message: `This snapshot does not record what refers to ${describe(after.ref)} or whether this connection's account may delete from it, and the snapshot the form was generated from did: a server older than 0049 took it. Delete is blocked until the database is discovered again by this release.`,
      },
    ]
  }
  return reach(comparison).flatMap(({ table, role }) => drafts(comparison, table, role))
}
