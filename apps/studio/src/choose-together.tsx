import { useState } from 'react'
import type { ReactElement } from 'react'
import { TOGETHER_MAX_ROWS } from '@formancy/data-core'
import type { LookupChoice, ObjectMeta, RowFilterRule, TogetherBounds } from '@formancy/data-core'
import type { Choice } from './choice.js'
import { describeRef } from './choice.js'
import { readableRowversion, STARTING_BOUNDS, togetherCandidate, touchCandidates } from './together.js'

/** A bound as typed: a box left empty is no number, which the step refuses in the server's words rather than reading it as 0. */
function bound(text: string): number {
  return text.trim() === '' ? Number.NaN : Number(text)
}

/**
 * The two number boxes of a lookup whose rows are saved with their record:
 * what the person typed, kept as typed, so a box being cleared to type
 * another number is not filled again under the keyboard.
 */
function Bounds({
  id,
  target,
  bounds,
  onBounds,
}: {
  id: string
  target: string
  bounds: TogetherBounds
  onBounds: (next: TogetherBounds) => void
}): ReactElement {
  const [typed, setTyped] = useState({ min: String(bounds.min), max: String(bounds.max) })
  const set = (which: 'min' | 'max', text: string) => {
    const next = { ...typed, [which]: text }
    setTyped(next)
    onBounds({ min: bound(next.min), max: bound(next.max) })
  }
  const hint = `${id}-bounds-hint`
  return (
    <>
      <div className="pair bounds">
        <div className="field">
          <label htmlFor={`${id}-min`}>At least</label>
          <input
            type="number"
            id={`${id}-min`}
            inputMode="numeric"
            min={0}
            max={TOGETHER_MAX_ROWS}
            step={1}
            value={typed.min}
            aria-describedby={hint}
            onChange={(event) => set('min', event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-max`}>At most</label>
          <input
            type="number"
            id={`${id}-max`}
            inputMode="numeric"
            min={1}
            max={TOGETHER_MAX_ROWS}
            step={1}
            value={typed.max}
            aria-describedby={hint}
            onChange={(event) => set('max', event.target.value)}
          />
        </div>
      </div>
      <p id={hint} className="hint">
        How many of these rows each {target} holds, through this form and the {target}&rsquo;s. At most {TOGETHER_MAX_ROWS}: a save is planned from one page of
        the rows of one {target}. At least 1 means every {target} is created with its rows, never alone.
      </p>
    </>
  )
}

/**
 * Whether another key of `root` that could be saved with its record
 * references a table of the same name as `foreignKey` does, so that two
 * boxes would read alike and need their foreign keys to be told apart, as
 * every other control of a lookup on the step is named by its key.
 */
function namedAlike(root: ObjectMeta, foreignKey: string, target: string): boolean {
  return root.foreignKeys.some((other) => other.name !== foreignKey && other.references?.table.name === target && togetherCandidate(root, other))
}

/**
 * Whether the form's rows are saved with the record a lookup references
 * (0155): a box, offered under a lookup whose foreign key is NOT NULL and
 * onto another table, and once ticked the bounds, starting at no row
 * required and the cap data-core gives. Never ticked for anybody. Where
 * another such key references a table of the same name, the group and the
 * box name this one's foreign key too.
 *
 * Ticked, it also says what a save one level deep costs: a form whose
 * rows are saved with this one's records then saves none, and where it
 * requires rows, no record of this form can be created; and where the
 * referenced table's own form is saved with another record, this form's
 * rows are saved with none either. Nothing refuses either at publish,
 * each bundle being read alone.
 *
 * Where the generator would refuse it -- row security on the table, a
 * section, a form over versions, another lookup already saved with its
 * record -- the box is not offered and its words say why, as a through the
 * server refuses is said on the Policy step. Ticked, what the generator,
 * the policy check and publishing refuse of it is said under it, each in
 * its own words, and changes as the bounds and the pins do.
 */
export function TogetherChoice({
  id,
  root,
  target,
  lookup,
  blocker,
  refusals,
  onLookup,
}: {
  id: string
  root: ObjectMeta
  target: ObjectMeta
  lookup: LookupChoice
  /** The generator's refusal of this lookup's rows saved with their record, while its box is not ticked. */
  blocker: string | null
  /** While it is ticked: what the generator, the policy check and publishing refuse of it, each a sentence. */
  refusals: readonly string[]
  onLookup: (next: LookupChoice) => void
}): ReactElement {
  const { together, ...plain } = lookup
  const box = `${id}-together`
  const name = target.ref.name
  const refused = together === undefined ? blocker : null
  const key = namedAlike(root, lookup.foreignKey, name) ? `(${lookup.foreignKey})` : null
  const described = [`${box}-about`, ...(together === undefined ? [] : [`${box}-level`]), ...(refused === null ? [] : [`${box}-refused`])]
  return (
    <fieldset className="nested">
      <legend>
        {root.ref.name} saved with its {name}
        {key === null ? null : ` ${key}`}
      </legend>
      <div className="check">
        <input
          type="checkbox"
          id={box}
          checked={together !== undefined}
          disabled={refused !== null}
          aria-describedby={described.join(' ')}
          onChange={(event) => onLookup(event.target.checked ? { ...plain, together: { ...STARTING_BOUNDS } } : plain)}
        />
        <label htmlFor={box}>
          Rows of this form are saved with their {name}
          {key === null ? null : (
            <>
              {' '}
              <span className="visually-hidden">{key}</span>
            </>
          )}
        </label>
      </div>
      <p id={`${box}-about`} className="hint">
        A page lists them under each {name}, and the {name}&rsquo;s own Save stores them with it, in one transaction: every change or none. They are then
        created and deleted only in that save, and still updated one at a time; the field naming the {name} is written when a row is created, never after.
      </p>
      {together === undefined ? null : (
        <p id={`${box}-level`} className="hint">
          A save holds one level, so a form whose rows are saved with their record has none saved with its own. Once this is ticked, another form&rsquo;s rows
          saved with each {root.ref.name} are read-only under it, and where that form requires at least one, no {root.ref.name} can be created; and where the{' '}
          {name}&rsquo;s own form saves its rows with another record, these are read-only too. Publishing refuses neither.
        </p>
      )}
      {refused === null ? null : (
        <p id={`${box}-refused`} className="cannot-tell">
          The generator refuses it: {refused}.
        </p>
      )}
      {together === undefined ? null : <Bounds id={box} target={name} bounds={together} onBounds={(next) => onLookup({ ...plain, together: next })} />}
      <div aria-live="polite">
        {together === undefined || refusals.length === 0 ? null : (
          <ul className="cannot-tell" aria-label="What blocks it">
            {refusals.map((refusal) => (
              <li key={refusal}>{refusal}</li>
            ))}
          </ul>
        )}
      </div>
    </fieldset>
  )
}

/**
 * A rowversion root's touch column (0155): the column a save of a record's
 * rows alone sets to itself, so that the rowversion moves and a second save
 * of the same record's rows is stale rather than counted beside the first.
 * Only the generator's candidates are listed (`touchCandidates`), none is
 * chosen for anybody, and one chosen before a pin took it stays listed so
 * that the generator's refusal, said under it, can be answered here.
 */
export function TouchChoice({
  root,
  choice,
  rowFilters,
  refusal,
  onChoice,
}: {
  root: ObjectMeta
  choice: Choice
  rowFilters: readonly RowFilterRule[]
  /** The generator's refusal of the column chosen, in its words, or `null`. */
  refusal: string | null
  onChoice: (next: Choice) => void
}): ReactElement | null {
  const rowversion = readableRowversion(root)
  if (rowversion === undefined) return null
  const candidates = touchCandidates(root, rowFilters)
  const chosen = choice.touchColumn
  const offered = root.columns.filter((column) => candidates.includes(column) || column.name === chosen)
  const where = describeRef(root.ref)
  if (offered.length === 0) {
    return (
      <p className="hint">
        No column of {where} can carry a save of its records&rsquo; rows alone: each is in a key or a foreign key, generated, pinned, or one this connection may
        not both read and update. Rows of a form saved with these records are saved only as a record is created.
      </p>
    )
  }
  return (
    <div className="field">
      <label htmlFor="touch-column">Rows saved with these records move the rowversion through</label>
      <select
        id="touch-column"
        aria-describedby={refusal === null ? 'touch-column-hint' : 'touch-column-hint touch-column-refused'}
        value={chosen ?? ''}
        onChange={(event) => onChoice({ ...choice, touchColumn: event.target.value === '' ? null : event.target.value })}
      >
        <option value="">None: rows are saved with a record only as it is created</option>
        {offered.map((column) => (
          <option key={column.name} value={column.name}>
            {column.name}
          </option>
        ))}
      </select>
      <p id="touch-column-hint" className="hint">
        No statement sets {rowversion.name}. Where a form&rsquo;s rows are saved with these records and only the rows change, the save sets this column to
        itself, which moves {rowversion.name} and fires the table&rsquo;s UPDATE triggers with it updated. Offered: columns outside every key and foreign key,
        not generated, not pinned, that this connection may read and update. None is chosen for you.
      </p>
      {refusal === null ? null : (
        <p id="touch-column-refused" className="cannot-tell">
          The generator refuses it: {refusal}.
        </p>
      )}
    </div>
  )
}
