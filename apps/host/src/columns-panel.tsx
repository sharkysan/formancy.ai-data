import { useState } from 'react'
import type { ReactElement } from 'react'
import { arrange, moveChoice, showChoice } from './columns.js'
import type { ColumnChoice } from './columns.js'
import type { GridColumn } from './grid-datasource.js'

/*
 * A grid's Columns (0106): behind a disclosure, as the filter is
 * (filter-panel.tsx), the grid's columns in their order, each with Show and
 * a move up and down, then Reset columns. Every change is a press or a key:
 * nothing is dragged, and the grid's own columns stay unmovable
 * (grid-options.tsx), because a drag has no keyboard path (formancy.ai
 * 0046). A row's Delete is no field's column, and is never listed; a child
 * section's columns leave out its parent's field, as its grid does.
 *
 * What cannot be done is said, never removed from the keyboard's path: the
 * last column shown cannot be hidden -- a row is opened through its cells
 * -- so its Show is `aria-disabled` and described by the sentence that says
 * so, and a move at an end is `aria-disabled` too. A press of either does
 * nothing, and a move keeps the keyboard on the button pressed, which
 * travels with its column: React puts the focus back on an element it
 * moved.
 *
 * Its button and its panel are two of the toolbar's items: the button
 * beside View and Filter, and the panel, when open, a row of its own under
 * them, so the button never moves from under the pointer that opened it.
 */

export function ColumnsPanel({
  idBase,
  columns,
  choices,
  onChoices,
  onReset,
}: {
  /** What every element id of the panel starts with: one panel per grid. */
  idBase: string
  /** The grid's columns as the form gives them. */
  columns: readonly GridColumn[]
  /** The section's arrangement of them. */
  choices: readonly ColumnChoice[]
  onChoices: (next: ColumnChoice[]) => void
  onReset: () => void
}): ReactElement | null {
  const [open, setOpen] = useState(false)
  if (columns.length === 0) return null
  const arranged = arrange(columns, choices)
  const current = arranged.map(({ key, shown }) => ({ field: key, shown }))
  const one = arranged.filter((column) => column.shown).length === 1
  const onlyId = `${idBase}-only`

  const change = (next: readonly ColumnChoice[]): void => {
    if (next !== current) onChoices([...next])
  }

  return (
    <>
      <button type="button" className="button quiet disclosure" id={`${idBase}-toggle`} aria-expanded={open} aria-controls={`${idBase}-tool`} onClick={() => setOpen(!open)}>
        <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 12 12">
          <path d={open ? 'M2 4l4 4 4-4' : 'M4 2l4 4-4 4'} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Columns
      </button>
      <div id={`${idBase}-tool`} className="columns-tool" hidden={!open}>
        <div className="columns-box">
          <ul className="columns-list" aria-labelledby={`${idBase}-toggle`}>
            {arranged.map((column, index) => {
              const last = one && column.shown
              const id = `${idBase}-show-${column.key}`
              return (
                <li key={column.key}>
                  <input
                    type="checkbox"
                    id={id}
                    checked={column.shown}
                    aria-label={`Show ${column.label}`}
                    aria-disabled={last ? 'true' : undefined}
                    aria-describedby={last ? onlyId : undefined}
                    onChange={(event) => change(showChoice(current, column.key, event.target.checked))}
                  />
                  <label htmlFor={id}>{column.label}</label>
                  <button type="button" className="button" aria-label={`Move ${column.label} up`} aria-disabled={index === 0 ? 'true' : undefined} onClick={() => change(moveChoice(current, column.key, -1))}>
                    Up
                  </button>
                  <button type="button" className="button" aria-label={`Move ${column.label} down`} aria-disabled={index === arranged.length - 1 ? 'true' : undefined} onClick={() => change(moveChoice(current, column.key, 1))}>
                    Down
                  </button>
                </li>
              )
            })}
          </ul>
          {one ? (
            <p className="hint columns-hint" id={onlyId}>
              One column stays shown: a row is opened through its cells.
            </p>
          ) : null}
          <button type="button" className="button" onClick={onReset}>
            Reset columns
          </button>
        </div>
      </div>
    </>
  )
}
