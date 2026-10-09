import { useState } from 'react'
import type { ReactElement } from 'react'
import type { BuilderSession, CommandOutcome } from '@formancy/builder-core'
import type { PresentationConflict } from '@formancy/data-core'
import type { Text } from '@formancy/spec'
import type { Carried } from './carry.js'
import { labelOf, useDocument } from './document.js'

/** A label as the conflict names it: words in quotes, or the message it points at. */
function shown(text: Text): string {
  return typeof text === 'string' ? `“${text}”` : `message ${text.$t}`
}

/**
 * A label the regenerated form no longer has a field for, offered to a field
 * that is new in it: a rename reads as a drop and an add (0030), and this is
 * how a person carries the label across. One command, so Undo takes it back.
 */
function GiveLabel({
  at,
  label,
  fresh,
  named,
  give,
}: {
  at: number
  label: Text
  fresh: readonly string[]
  /** A field's label as the document has it now. */
  named: (key: string) => string
  give: (key: string) => void
}): ReactElement {
  const [target, setTarget] = useState(fresh[0] ?? '')
  if (fresh.length === 0) return <p className="none">No field is new in this form to give it to.</p>
  const id = `carried-${String(at)}-target`
  return (
    <div className="inline-form">
      <div className="field">
        <label htmlFor={id}>Give {shown(label)} to</label>
        <select id={id} value={target} onChange={(event) => setTarget(event.target.value)}>
          {fresh.map((key) => (
            <option key={key} value={key}>
              {named(key)} ({key})
            </option>
          ))}
        </select>
      </div>
      <button type="button" className="button" onClick={() => give(target)}>
        Give {shown(label)}
      </button>
    </div>
  )
}

/**
 * What a draft brought with it from the one before (0030), in the
 * Presentation step: every conflict in the rebase's words, and a choice where
 * one exists. A choice is one session command, reported in the step's status
 * and undone by its Undo; the button pressed stays where it is, with the
 * keyboard on it. Whether it resolved anything is the publish's to derive --
 * this panel keeps no state of its own about it.
 */
export function CarriedPanel({
  session,
  carried,
  report,
}: {
  session: BuilderSession
  carried: Carried
  report: (outcome: CommandOutcome, done: string) => CommandOutcome
}): ReactElement {
  const document = useDocument(session)
  const relabel = (key: string, label: Text) => report(session.setFieldProperty([key], 'label', label), `Labelled ${key} ${shown(label)}.`)

  function choice(conflict: PresentationConflict, at: number): ReactElement | null {
    if (conflict.kind === 'both-changed') {
      return (
        <button type="button" className="button" onClick={() => relabel(conflict.field, conflict.generator)}>
          Use the generator&rsquo;s label for {conflict.field}
        </button>
      )
    }
    if (conflict.kind === 'field-gone' && conflict.property === 'label') {
      // A label's `yours` is text: 'all' and 'one' are a span's, and a label may read "all".
      const label = conflict.yours as Text
      return <GiveLabel at={at} label={label} fresh={carried.fresh} named={(key) => labelOf(document, key)} give={(key) => relabel(key, label)} />
    }
    return null
  }

  return (
    <section className="carried" aria-labelledby="carried-heading">
      <h3 id="carried-heading">Carried from {carried.from}</h3>
      {carried.conflicts.length === 0 ? (
        <p className="none">Everything you chose was carried.</p>
      ) : (
        <>
          <p className="hint">
            What could not be carried as it was, and what was done instead. A choice here is one edit, which Undo takes back.
          </p>
          <ul aria-labelledby="carried-heading">
            {carried.conflicts.map((conflict, index) => (
              // The rebase's order is the order to read them in, and two can concern one field.
              <li key={index}>
                <p>{conflict.message}</p>
                {choice(conflict, index)}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
