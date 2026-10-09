import type { ReactElement } from 'react'
import type { GeneratedForm, GenerationNote } from '@formancy/data-core'

/**
 * The five kinds of note, in the order a reviewer needs them, with what each
 * kind means -- the generator's own definitions (`GenerationNote`), not new
 * ones -- and what an empty kind says.
 *
 * An empty kind is said rather than left out. "Nothing was excluded" is a
 * finding about the table; a missing heading reads as a page that forgot.
 */
export const NOTE_KINDS: ReadonlyArray<{ kind: GenerationNote['kind']; heading: string; means: string; none: string }> = [
  { kind: 'blocked', heading: 'Blocked', means: 'An operation the form cannot offer, and why.', none: 'No operation is blocked.' },
  { kind: 'read-only', heading: 'Read-only', means: 'A field shown and not written, on every operation or on the one named.', none: 'No field is marked read-only.' },
  { kind: 'excluded', heading: 'Excluded', means: 'A column with no field.', none: 'No column was left without a field.' },
  { kind: 'inferred', heading: 'Inferred', means: 'Decided from the metadata, and editable.', none: 'Nothing was inferred.' },
  {
    kind: 'access',
    heading: 'Access',
    means: 'What the database itself limits for this connection: row-level security.',
    none: "The database limits no rows of this form's tables for this connection.",
  },
]

/**
 * What the generator chose for one form, beside the form.
 *
 * Saying what was chosen is the product (0009): the notes are the review
 * screen's content, so they are shown as the generator wrote them, kind by
 * kind, and the operations the bindings offer are printed from the bindings.
 *
 * A region named by the table and its own heading, so somebody moving by
 * landmark hears which form's notes these are.
 */
export function GenerationNotes({ generated, tableId }: { generated: GeneratedForm; tableId: string }): ReactElement {
  const headingId = `${tableId}-notes`
  const { create, update } = generated.bindings.operations
  return (
    <section className="notes" aria-labelledby={`${tableId} ${headingId}`}>
      <h3 id={headingId}>What the generator chose</h3>

      <h4 id={`${headingId}-operations`}>Operations</h4>
      <ul className="operations" aria-labelledby={`${headingId}-operations`}>
        <li data-offered={create}>
          Create: <strong>{create ? 'offered' : 'not offered'}</strong>
        </li>
        <li data-offered={update}>
          Update: <strong>{update ? 'offered' : 'not offered'}</strong>
        </li>
      </ul>

      {NOTE_KINDS.map(({ kind, heading, means, none }) => {
        const notes = generated.notes.filter((note) => note.kind === kind)
        const id = `${headingId}-${kind}`
        return (
          <div className="note-kind" data-kind={kind} key={kind}>
            {/* The list is named by the kind alone; the count beside it is
                derived from the notes and would only repeat the list's length. */}
            <h4>
              <span id={id}>{heading}</span> <span className="count">{notes.length}</span>
            </h4>
            <p className="means">{means}</p>
            {notes.length === 0 ? (
              <p className="none">{none}</p>
            ) : (
              <ul aria-labelledby={id}>
                {notes.map((note, index) => (
                  // Subject and message together are not unique -- a field can be
                  // inferred and read-only -- and the order is the generator's.
                  <li key={index}>
                    <code>{note.subject}</code> {note.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </section>
  )
}
