import type { Deleting } from '@formancy/data-client'
import { checkedText, DELETING, HELD, lead as leadOne } from './deletion.js'

/*
 * What only a deletion of the records chosen of a page says (0173, 0174):
 * the bar's button, the confirmation's lead from the form's `deleting`
 * (0050, 0051), as a delete of one says it (0053) -- each on its own, at
 * the version this page read it at, one that cannot be named and the
 * others deleted, never a table's name, never a cascade the form has not;
 * one record chosen is a delete of it alone, in that delete's words -- and
 * its outcome's words. Everything a deletion decides the way a change of
 * them does is chosen-request.ts's: its states, what became of each
 * record, what leaves the choice and what a check reads.
 */

/** The bar's button, which asks. */
export const DELETE_CHOSEN = 'Delete the chosen…'
/** First in a confirmation over more than one record: how a page of deletes goes (0173). */
export const EACH_ON_ITS_OWN =
  'Each is deleted on its own, at the version this page read it at: one that cannot be deleted is named, and the others are deleted.'
/** Then: a delete is for everybody, and for good. */
export const REMOVED_CHOSEN = 'They are removed from the database for everyone who can see them. This page cannot bring them back.'
/** The policy accepts a foreign key that deletes other rows with a record (0051). */
export const CASCADES_CHOSEN = 'Other records that refer to one of them are deleted with it.'
/** The policy accepts a foreign key that sets other rows' reference to NULL or its default (0051). */
export const CLEARS_CHOSEN = 'Other records that refer to one of them keep their place and lose that reference.'
/** A key refuses a delete while another row refers to the record (0050). */
export const RESTRICTED_CHOSEN = 'One that other records still refer to is kept, and named.'
/** Before the forms that hold work: the open record's, where it is chosen, and the Drill down levels that hold one (0094). */
export const DISCARDED_WITH_THEM = 'Unsaved changes in these forms are discarded with the record they hold:'
/** After the server's sentence, where it refused the request whole; and where a check found every record still stored. */
export const NONE_DELETED = 'None of the chosen records was deleted.'
/** A record a check found gone: the page cannot tell this deletion from another's. */
export const GONE = 'It is not there any more: this deletion, or somebody else’s, deleted it.'
/** A record whose own answer was lost. */
export const MAY_HAVE = 'It may have been deleted.'
/** After the open record's name, where a check found it gone and its forms hold work: it is not closed by itself (0053). */
export const STILL_OPEN = 'is still open in the detail, with work in its forms: Close the record discards it.'
/** Before the records the request stopped before. */
export const NOT_SENT = 'Not sent, so not deleted:'
/** One of them, on its box. */
export const NOT_SENT_ONE = 'Not sent, so not deleted.'

/** What deleting the records does, and also does, one sentence each, from the form's `deleting`: of one record, a delete of it alone's words (0053). */
export function lead(deleting: Deleting, n: number): string[] {
  if (n === 1) return leadOne(deleting)
  return [
    EACH_ON_ITS_OWN,
    REMOVED_CHOSEN,
    ...(deleting.cascades ? [CASCADES_CHOSEN] : []),
    ...(deleting.clears ? [CLEARS_CHOSEN] : []),
    ...(deleting.restricted ? [RESTRICTED_CHOSEN] : []),
  ]
}

/** How the page says what became of the records of a deletion: the words chosen-request.ts's outcome is said in. */
export const DELETE_WORDS = {
  verb: 'Delete',
  done: 'Deleted',
  past: 'deleted',
  request: 'deletion',
  refused: 'Not deleted',
  none: NONE_DELETED,
  mayHave: MAY_HAVE,
  notSent: NOT_SENT,
  notSentOne: NOT_SENT_ONE,
  found: GONE,
  /** After "2 of 4 records ": what a check found of those it found gone. */
  foundCount: (found: number): string =>
    `${found === 1 ? 'is' : 'are'} not there any more: this deletion, or somebody else’s, deleted ${found === 1 ? 'it' : 'them'}.`,
  /** After "1 of 2 records ": what a check found of those still stored. */
  keptCount: (kept: number): string => `${kept === 1 ? 'is' : 'are'} still stored, not deleted`,
  /** A record a check found still stored, at the version sent or changed since: not deleted either way. */
  kept: (changed: boolean): string => checkedText({ kind: changed ? 'changed' : 'unchanged' }),
  /** A record the check could not read. */
  unread: (message: string): string => checkedText({ kind: 'unread', message }),
  sending: DELETING,
  held: HELD,
  work: { out: 'deleting', unknown: 'delete-unknown' },
} as const
