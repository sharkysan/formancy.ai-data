import type { ReactElement } from 'react'
import type { GenerationNote } from '@formancy/data-core'
import type { Proposal } from './api.js'
import { describeRef } from './choice.js'

/**
 * The five kinds of note, in the order a reviewer needs them, with what each
 * means -- the generator's own definitions (`GenerationNote`) -- and what an
 * empty kind says. An empty kind is said rather than left out: "nothing was
 * excluded" is a finding about the table.
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
 * Step 4: what the server's generator made, and what it chose.
 *
 * Saying what was chosen is the product (0009): the notes are shown as the
 * generator wrote them, kind by kind, and the operations are printed from the
 * bindings, so a blocked update is never contradicted by a line that says the
 * form updates.
 */
export function GenerateStep({ proposal, onNext }: { proposal: Proposal; onNext: () => void }): ReactElement {
  const { form, bindings, notes } = proposal
  const { create, update } = bindings.operations
  return (
    <>
      <p className="lede">
        <code>{form.id}</code>, &ldquo;{form.title}&rdquo;, generated from {describeRef(bindings.root)} as the server
        discovered it just now: {form.model.fields.length} {form.model.fields.length === 1 ? 'field' : 'fields'}.
      </p>
      <section className="notes" aria-labelledby="chose-heading">
        <h3 id="chose-heading">What the generator chose</h3>
        <h4 id="operations-heading">Operations</h4>
        <ul className="operations" aria-labelledby="operations-heading">
          <li data-offered={create}>
            Create: <strong>{create ? 'offered' : 'not offered'}</strong>
          </li>
          <li data-offered={update}>
            Update: <strong>{update ? 'offered' : 'not offered'}</strong>
          </li>
        </ul>
        {NOTE_KINDS.map(({ kind, heading, means, none }) => {
          const ofKind = notes.filter((note) => note.kind === kind)
          const id = `notes-${kind}`
          return (
            <div className="note-kind" data-kind={kind} key={kind}>
              <h4>
                <span id={id}>{heading}</span> <span className="count">{ofKind.length}</span>
              </h4>
              <p className="means">{means}</p>
              {ofKind.length === 0 ? (
                <p className="none">{none}</p>
              ) : (
                <ul aria-labelledby={id}>
                  {ofKind.map((note, index) => (
                    // Subject and message together are not unique, and the order is the generator's.
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
      <p className="next">
        <button type="button" className="primary" onClick={onNext}>
          Write the policy
        </button>
      </p>
    </>
  )
}
