import { useId } from 'react'
import type { ReactElement } from 'react'
import type { ColumnMeta, ObjectMeta, RowFilterRule, StampChoice } from '@formancy/data-core'
import type { Choice } from './choice.js'
import { describeRef, stampCandidates, stampSuggestion, stampValues, startingStamp } from './choice.js'

/** What fills a stamp, as the control names it. */
const FILLED: Readonly<Record<StampChoice['value']['kind'], string>> = {
  actor: "The signed-in person's id",
  attribute: "One of the signed-in person's attributes",
  time: "The time of the save, by the database's clock",
}

const WHEN: Readonly<Record<StampChoice['on'], string>> = { create: 'On create', update: 'On update', both: 'On create and on update' }

/** What a column's name suggests, as a hint says it; `null` where it suggests nothing. */
function suggested(column: ColumnMeta): string | null {
  const suggestion = stampSuggestion(column)
  if (suggestion === null) return null
  const what = suggestion.value.kind === 'time' ? 'when' : 'who'
  return `Its name suggests ${what} a record was ${suggestion.on === 'create' ? 'created' : 'last changed'}. Nothing is stamped until you tick it.`
}

/**
 * The columns the server stamps (0153): each column that could take a
 * stamp, with a box, unticked -- the ones whose names suggest an audit
 * column first, said so in a hint, and filled with what the name suggests
 * once ticked -- then what fills it and when. A name is a suggestion and
 * never a stamp: a person ticks it, as they confirm a version column.
 * Offered only where the root has a column a stamp can take, or one
 * already stamped; whether the generator honours one it says itself, in
 * its words.
 */
export function StampsChoice({
  root,
  choice,
  rowFilters,
  onChoice,
}: {
  root: ObjectMeta
  choice: Choice
  rowFilters: readonly RowFilterRule[]
  onChoice: (next: Choice) => void
}): ReactElement | null {
  const hint = useId()
  const candidates = stampCandidates(root, choice, rowFilters)
  // A column stamped before something else in the step took it -- a pin, a
  // lookup, the version column, a chain -- keeps its box where it was, so
  // the stamp the step or the generator then refuses can be unticked.
  const offered = root.columns.filter((column) => candidates.includes(column) || choice.stamps.some((stamp) => stamp.column === column.name))
  if (offered.length === 0) return null
  // The suggested first, each group in catalog order.
  const ordered = [...offered.filter((column) => stampSuggestion(column) !== null), ...offered.filter((column) => stampSuggestion(column) === null)]
  const set = (column: string, next: StampChoice | null) => {
    const others = choice.stamps.filter((stamp) => stamp.column !== column)
    onChoice({ ...choice, stamps: next === null ? others : [...others, next] })
  }
  return (
    <fieldset aria-describedby={hint}>
      <legend>Columns the server stamps</legend>
      <p id={hint} className="hint">
        A stamped column is never written from the form. The server fills it on the saves you name, with who is signed in or with the time, and a value sent for
        it is refused: who created or changed a record is not the person&rsquo;s to type. A stamp filters nothing, so everybody who may read sees the records
        others wrote.
      </p>
      {ordered.map((column) => {
        const stamp = choice.stamps.find((entry) => entry.column === column.name)
        const id = `stamp-${column.name}`
        const about = candidates.includes(column)
          ? suggested(column)
          : `Something else in this step now takes ${column.name}, so it cannot be stamped: untick it.`
        return (
          <div className="choice" key={column.name}>
            <div className="check">
              <input
                type="checkbox"
                id={id}
                checked={stamp !== undefined}
                aria-describedby={about === null ? undefined : `${id}-about`}
                onChange={(event) => set(column.name, event.target.checked ? startingStamp(column) : null)}
              />
              <label htmlFor={id}>Stamp {column.name}</label>
            </div>
            {about === null ? null : (
              <p id={`${id}-about`} className="hint">
                {about}
              </p>
            )}
            {stamp === undefined ? null : <StampControls column={column} stamp={stamp} onStamp={(next) => set(column.name, next)} />}
          </div>
        )
      })}
      <p className="hint">
        The candidates are the columns of {describeRef(root.ref)} a stamp can take: text for a person, a date or a time stamp for the time.
      </p>
    </fieldset>
  )
}

/** What fills one stamped column, the attribute where one does, and when. */
function StampControls({ column, stamp, onStamp }: { column: ColumnMeta; stamp: StampChoice; onStamp: (next: StampChoice) => void }): ReactElement {
  const id = `stamp-${column.name}`
  const kinds = stampValues(column)
  return (
    <div className="pair">
      {kinds.length === 1 ? <p className="hint">{FILLED[stamp.value.kind]}.</p> : null}
      {kinds.length === 1 ? null : (
        <div className="field">
          <label htmlFor={`${id}-value`}>What fills {column.name}</label>
          <select
            id={`${id}-value`}
            value={stamp.value.kind}
            onChange={(event) =>
              onStamp({ ...stamp, value: event.target.value === 'attribute' ? { kind: 'attribute', attribute: '' } : { kind: event.target.value as 'actor' } })
            }
          >
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {FILLED[kind]}
              </option>
            ))}
          </select>
        </div>
      )}
      {stamp.value.kind !== 'attribute' ? null : (
        <div className="field">
          <label htmlFor={`${id}-attribute`}>Attribute {column.name} is stamped with</label>
          <input
            id={`${id}-attribute`}
            value={stamp.value.attribute}
            spellCheck={false}
            onChange={(event) => onStamp({ ...stamp, value: { kind: 'attribute', attribute: event.target.value } })}
          />
        </div>
      )}
      <div className="field">
        <label htmlFor={`${id}-on`}>When {column.name} is stamped</label>
        <select id={`${id}-on`} value={stamp.on} onChange={(event) => onStamp({ ...stamp, on: event.target.value as StampChoice['on'] })}>
          {(['create', 'update', 'both'] as const).map((on) => (
            <option key={on} value={on}>
              {WHEN[on]}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
