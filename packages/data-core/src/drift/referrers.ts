import type { InboundKey } from '../metadata.js'
import { deleteEffect, unaccepted } from '../policy/cascades.js'
import { recordsDeleteFacts } from '../snapshot.js'
import { hiding } from './access.js'
import { type Comparison, describe, type Draft, list, sameList, sameRef } from './context.js'

/*
 * What refers to the form's root, compared (0050): the foreign keys a delete
 * of one of its records acts through, recorded on the root since 0049.
 *
 * A key that would make a delete do something the policy has not accepted
 * -- delete, clear or set a default in another table's rows -- stops delete,
 * by `unaccepted`, the predicate the publish check refuses a grant by, so a
 * form review calls deletable is one that publishes. A key that only refuses
 * a delete is for a person to review: the database enforces it. One gone is
 * noted. A key out of sight behind a `referenced-by` gap is the gap's to say.
 *
 * Review's alone: a request's description of the root holds no key onto it,
 * so the runtime decides delete without this family (0041), and the delete
 * statement's own guard refuses a key the request does not name (0050). The
 * runtime is never stricter than review.
 */

function sameKey(left: Pick<InboundKey, 'table' | 'name'>, right: Pick<InboundKey, 'table' | 'name'>): boolean {
  return sameRef(left.table, right.table) && left.name === right.name
}

/** Each property of a key that refers to the root, as a person reads it. */
const PROPERTIES: ReadonlyArray<[label: string, show: (key: InboundKey) => string, same: (was: InboundKey, now: InboundKey) => boolean]> = [
  ['its columns', (key) => `(${list(key.columns)})`, (was, now) => sameList(was.columns, now.columns)],
  ['the columns it refers to', (key) => `(${list(key.referencedColumns)})`, (was, now) => sameList(was.referencedColumns, now.referencedColumns)],
  ['on delete', (key) => key.onDelete, (was, now) => was.onDelete === now.onDelete],
  ['on update', (key) => key.onUpdate, (was, now) => was.onUpdate === now.onUpdate],
  ['enforcement', (key) => (key.enforced ? 'enforced' : 'not enforced'), (was, now) => was.enforced === now.enforced],
]

export function referrerChanges(comparison: Comparison): Draft[] {
  const { base, current, before, after, policy } = comparison
  // A base taken before 0049 says nothing to compare, and a form generated
  // from it offers no delete: every key would be "new" (0049).
  if (!recordsDeleteFacts(base)) return []
  const root = describe(after.ref)
  const subject = { kind: 'object', object: after.ref } as const
  if (!recordsDeleteFacts(current)) {
    return [
      {
        kind: 'access-narrowed',
        subject,
        affects: [],
        stops: ['delete'],
        breaksReads: false,
        otherwise: 'review',
        message: `This snapshot does not record what refers to ${root} or whether this connection's account may delete from it, and the snapshot the form was generated from did: a server older than 0049 took it. Delete is blocked until the database is discovered again by this release.`,
      },
    ]
  }

  const was = before.referencedBy ?? []
  const now = after.referencedBy ?? []
  const hidden = hiding(current.gaps, after.ref, 'referenced-by').length > 0
  const drafts: Draft[] = []
  for (const key of now) {
    const earlier = was.find((candidate) => sameKey(candidate, key))
    const changed = earlier === undefined ? [] : PROPERTIES.filter(([, , same]) => !same(earlier, key)).map(([label, show]) => `${label} from ${show(earlier)} to ${show(key)}`)
    if (earlier !== undefined && changed.length === 0) continue
    const acts = unaccepted(policy, key)
    const what = earlier === undefined ? `${key.name} of ${describe(key.table)} is a new foreign key that refers to ${root}` : `${key.name} of ${describe(key.table)}, which refers to ${root}, changed: ${changed.join('; ')}`
    drafts.push({
      kind: earlier === undefined ? 'referrer-added' : 'referrer-changed',
      subject: { kind: 'foreign-key', object: key.table, name: key.name },
      affects: [],
      stops: acts ? ['delete'] : [],
      breaksReads: false,
      otherwise: 'review',
      message: acts
        ? `${what}. ${deleteEffect(after.ref, key).replace(/^d/, 'D')}, which this form does not offer, so delete is blocked until the form is reviewed.`
        : `${what}. On delete it ${key.onDelete === 'restrict' ? 'restricts' : 'takes no action'}: the database refuses to delete a record of ${root} while rows of ${describe(key.table)} refer to it.`,
    })
  }
  for (const key of was) {
    // Out of sight is not gone: the gap reports itself, and stops delete.
    if (hidden || now.some((candidate) => sameKey(candidate, key))) continue
    drafts.push({
      kind: 'referrer-changed',
      subject: { kind: 'foreign-key', object: key.table, name: key.name },
      affects: [],
      stops: [],
      breaksReads: false,
      otherwise: 'info',
      message: `${key.name} of ${describe(key.table)}, which referred to ${root}, is gone. A delete of this form reaches nothing through it now.`,
    })
  }
  return drafts
}
