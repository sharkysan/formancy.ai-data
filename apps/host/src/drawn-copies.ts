import type { FormRecord, PublishedForm } from '@formancy/data-client'
import type { FormSchema } from '@formancy/spec'
import { withMoves } from './moves.js'
import { disableFields } from './widgets.js'

/*
 * The host's copies of a published form, one for each way a pane draws a
 * record (0117, 0122): which copy a record is drawn with, decided once
 * here, for a pane's session (session.ts) and for a grid that asks which
 * of a row's cells it may edit (grid-edit.ts, 0179), so the two never
 * disagree about what a person may write.
 *
 * - **A new record** is drawn with the create's copy: the fields the page
 *   fills in and those the create does not accept from this person
 *   disabled, its state field as the moves a create may start it in
 *   (0127). A record created in a form keeps that copy through the updates
 *   after its create, since the engine is kept (0029).
 * - **A saved record** this person may update is drawn with the update's
 *   copy: a field written on create only disabled, which an update would
 *   refuse (0122), and its state field as the moves from the state it
 *   holds.
 * - **A saved record this person may not update**, and a version that has
 *   ended (0113), is drawn with every field disabled, as the generator
 *   draws a field nothing may write: presentation only, the server refuses
 *   the update (UX-SPEC D19).
 * - **A next version** (0115) takes its chain's key and its end from the
 *   version it follows: never the person's.
 */

/**
 * The fields this person may write in no write the form offers them (0117):
 * a pinned tenant, a field the database writes, one the policy lets them
 * read and not write. A field written on create only is not one of them.
 */
export function unwrittenFields({ form, writable }: PublishedForm): Set<string> {
  const written = new Set([...(writable.create ?? []), ...(writable.update ?? [])])
  return new Set(form.model.fields.map((field) => field.key).filter((key) => !written.has(key)))
}

/**
 * The fields one write does not accept from this person (0122): those its
 * list leaves out, or -- a write the form does not offer them -- those no
 * write accepts, since such a form is drawn for the other write or read-only.
 */
function notAcceptedOn({ form, writable }: PublishedForm, operation: 'create' | 'update', unwritten: ReadonlySet<string>): string[] {
  const accepted = writable[operation]
  if (accepted === null) return [...unwritten]
  return form.model.fields.map((field) => field.key).filter((key) => !accepted.includes(key))
}

export interface Copies {
  /** What this person writes in no operation: drawn as nothing writes it, and sent in no body (0117). */
  unwritten: ReadonlySet<string>
  /** The copy a form opened on `record` draws it with -- nothing for a new record -- or, `following`, a next version of one (0115). */
  of(record: FormRecord | undefined, following: boolean): FormSchema
}

/** The copies of `definition`, with `fixed` -- the fields the page fills in, a child's parent (0043) -- disabled on every one. */
export function drawnCopies(definition: PublishedForm, fixed: readonly string[] = []): Copies {
  // What this person writes in no operation is drawn as nothing writes it
  // and sent in no body: a renderer submits a disabled field, and a body
  // that echoed it would carry the tenant a token alone carries (0117).
  const unwritten = unwrittenFields(definition)
  // A field's default, the create's alone, is served only where this
  // person's create takes it (0149), so the copy starts nothing a save of
  // it would be refused for.
  const forCreate = disableFields(definition.form, [...fixed, ...notAcceptedOn(definition, 'create', unwritten)])
  const forUpdate = disableFields(definition.form, [...fixed, ...notAcceptedOn(definition, 'update', unwritten)])
  const form = definition.form
  const readOnly = disableFields(
    form,
    form.model.fields.map((field) => field.key),
  )
  /** The fields a next version takes from the one it follows, and its end: never the person's (0115). */
  const following = disableFields(forCreate, definition.versions === null ? [] : [...definition.versions.key, definition.versions.to])
  /** Whether `record` is a version that has ended: history, drawn as nothing to write (0113). */
  const ended = (record: FormRecord): boolean => definition.versions !== null && (record.answers[definition.versions.to] ?? null) !== null

  /**
   * The state a record holds, as the policy spells its states (0127): text,
   * a whole number as its digits, `null` for none; `undefined` where the
   * person may not read the field, whose choice is then left as it is.
   */
  function stateOf(record: FormRecord): string | null | undefined {
    const held = definition.moves === null ? undefined : record.answers[definition.moves.field]
    return held === null ? null : typeof held === 'string' || typeof held === 'number' ? String(held) : undefined
  }

  return {
    unwritten,
    of(record, isNext) {
      if (isNext) return following
      if ((record?.record ?? null) === null || record === undefined) return withMoves(forCreate, definition.moves, null)
      if (!definition.operations.includes('update') || ended(record)) return readOnly
      const from = stateOf(record)
      return from === undefined ? forUpdate : withMoves(forUpdate, definition.moves, from)
    },
  }
}
