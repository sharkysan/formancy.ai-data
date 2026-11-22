import { useState } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'
import { AngularForm } from './angular-mount.js'
import { FIELDS_LEGEND, NAMING, TICK_FIELDS, VALUES } from './chosen-change.js'
import type { ChosenFlow } from './chosen-flow.js'
import { heading } from './chosen-request.js'
import { RENDERER_NAMES } from './leave.js'
import { ReactForm } from './react-form.js'
import { CONTINUE } from './running.js'
import { RegionHeading } from './words.js'

/*
 * A change of the records chosen, before its confirmation (0176), in the
 * region under the bar, as an action's dialog is drawn under what asked
 * (0162): focused, headed by how many records it is over; a box for each
 * field the form serves this person such a change in, none ticked; and
 * each field ticked drawn on white paper in Blueprint by the renderer the
 * person chose -- React where both are shown -- with the lookups' own
 * typeahead, its submit Continue, which runs the engine's submit. No rule
 * of the host's reaches the paper. Escape is Keep them, unless the
 * renderer took the key -- a list closing.
 */

export function ChangeAsk({ flow, idBase }: { flow: ChosenFlow; idBase: string }): ReactElement | null {
  const [sheet, setSheet] = useState<HTMLFormElement | null>(null)
  const now = flow.request
  if (now.state !== 'asking') return null
  const { ticked, engine, reading } = now.asked
  const escapes = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    flow.keep()
  }
  // A new paper for each set of fields ticked: the engine is the form narrowed to them.
  const paper = ticked.join(' ')
  return (
    <div role="region" className="action-ask" aria-labelledby={`${idBase}-heading`} tabIndex={-1} ref={flow.regionRef} onKeyDown={escapes}>
      <RegionHeading level={4} id={`${idBase}-heading`}>
        {heading('change', now.target, false)}
      </RegionHeading>
      <fieldset className="change-fields" aria-describedby={`${idBase}-tick`}>
        <legend>{FIELDS_LEGEND}</legend>
        {flow.changes.map(({ key, label }, index) => (
          <div className="change-field" key={key}>
            <input
              type="checkbox"
              id={`${idBase}-field-${String(index)}`}
              checked={ticked.includes(key)}
              aria-disabled={reading ? 'true' : undefined}
              onChange={(event) => flow.tick(key, event.target.checked)}
            />
            <label htmlFor={`${idBase}-field-${String(index)}`}>{label}</label>
          </div>
        ))}
      </fieldset>
      <p id={`${idBase}-tick`} className="hint">
        {TICK_FIELDS}
      </p>
      {engine === null ? null : (
        <form
          className="sheet"
          aria-label={`${VALUES}, ${RENDERER_NAMES[flow.renderer]}`}
          data-formancy-theme="blueprint"
          noValidate
          onSubmit={(event) => event.preventDefault()}
          ref={setSheet}
        >
          {flow.renderer === 'react' ? (
            <ReactForm key={paper} engine={engine} sources={flow.sources} submitLabel={CONTINUE} onSubmit={flow.answered} />
          ) : (
            <AngularForm key={paper} sheet={sheet} engine={engine} sources={flow.sources} submitLabel={CONTINUE} onSubmit={flow.answered} />
          )}
        </form>
      )}
      <p role="status" className="notice-text pending">
        {reading ? NAMING : ''}
      </p>
      <div className="notice-actions">
        <button type="button" className="button" onClick={flow.keep}>
          Keep them
        </button>
      </div>
    </div>
  )
}
