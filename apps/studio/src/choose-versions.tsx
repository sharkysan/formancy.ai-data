import type { ReactElement } from 'react'
import type { ObjectMeta } from '@formancy/data-core'
import type { Choice } from './choice.js'
import { describeRef, validityCandidates } from './choice.js'

/**
 * Whether the root's rows are versions of one thing (0113), and which
 * columns a version starts and ends at: a box, offered where the root has a
 * date or an instant that could start a version and one that could end it,
 * and then the two columns to choose. Offered and left unticked, the rows
 * are records of their own, as they were before. Whether the pair holds a
 * chain is the generator's to say, in its words, when the form is
 * generated.
 */
export function VersionsChoice({ root, choice, onChoice }: { root: ObjectMeta; choice: Choice; onChoice: (next: Choice) => void }): ReactElement | null {
  const { from, to } = validityCandidates(root)
  const first = (columns: typeof from) => columns[0]?.name
  const start = first(from)
  const end = first(to)
  if (start === undefined || end === undefined) return null
  const chosen = choice.validity
  return (
    <fieldset>
      <legend>Versions</legend>
      <div className="check">
        <input
          type="checkbox"
          id="versions"
          aria-describedby="versions-hint"
          checked={chosen !== null}
          onChange={(event) => onChoice({ ...choice, validity: event.target.checked ? { from: start, to: end } : null })}
        />
        <label htmlFor="versions">Each row of {describeRef(root.ref)} is a version, valid from a date until the next one starts</label>
      </div>
      <p id="versions-hint" className="hint">
        A person then changes the open version from a date: it ends there, and the next one starts, in one save. An ended
        version is not edited, and no version is deleted, through the form.
      </p>
      {chosen === null ? null : (
        <div className="pair">
          <div className="field">
            <label htmlFor="valid-from">Valid from</label>
            <select id="valid-from" value={chosen.from} onChange={(event) => onChoice({ ...choice, validity: { ...chosen, from: event.target.value } })}>
              {from.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="valid-to">Valid until, empty while open</label>
            <select id="valid-to" value={chosen.to} onChange={(event) => onChoice({ ...choice, validity: { ...chosen, to: event.target.value } })}>
              {to.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </fieldset>
  )
}
