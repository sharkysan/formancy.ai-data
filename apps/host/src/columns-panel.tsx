import { useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { arrange, moveChoice, showChoice } from './columns.js'
import type { ArrangedColumn, ColumnChoice } from './columns.js'
import type { GridColumn } from './grid-datasource.js'
import { stepWidth, widthSaid } from './widths.js'
import type { Measured, WidthChange } from './widths.js'

/*
 * A grid's Columns (0106): behind a disclosure, as opening a record by its
 * token is (record-bar.tsx), the grid's columns in their order, each with Show and
 * a move up and down, then Reset columns. Every change is a press or a key:
 * nothing is dragged, and the grid's own columns stay unmovable
 * (grid-options.tsx), because a drag has no keyboard path (formancy.ai
 * 0046). A row's Delete is no field's column, and is never listed; a child
 * section's columns leave out its parent's field, as its grid does.
 *
 * A column's width is the keyboard's here too (0151), what a pointer does
 * on a header's edge: a minus and a plus (`Sign`), named "Make Amount
 * narrower" and "Make Amount wider", move it a step (widths.ts) from the
 * width the grid draws it at now (`measure`), never past its floor or the
 * widest, and Fit gives it back to its content; what each asks goes to
 * the grid (`onWidths`), which tells the section to keep it as it tells a
 * drag's, and Reset columns gives every column back to its content too.
 * Each press is said on the panel's line, in the page's own voice -- the
 * browser keeps a width, not the server, so it is never the teal of what
 * the server did (0146) -- a new element each time, so a press at an end
 * that says what it said before is heard again. The steps are drawn signs so that a
 * column's line stays one line in Side by side's lane: in words it was two
 * in a window 897 pixels wide, and the panel outgrew the Records panel,
 * whose edge, below the window, cut the lines under it (0151 says what was
 * measured).
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

/** A minus and a plus, drawn: the steps' only visible marks. */
const MINUS = 'M2.5 6h7'
const PLUS = 'M2.5 6h7M6 2.5v7'

/**
 * A step's sign, an SVG with no role or text: the button's name says what
 * it does. As a character, "−" or "+", axe could not decide its contrast
 * -- a text of only non-text characters -- and the gate fails a text it
 * cannot decide (CI run 43355345952). Drawn in the button's text colour;
 * no gate measures the sign itself (0151).
 */
function Sign({ path }: { path: string }): ReactElement {
  return (
    <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 12 12">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function ColumnsPanel({
  idBase,
  columns,
  choices,
  onChoices,
  onReset,
  measure,
  onWidths,
}: {
  /** What every element id of the panel starts with: one panel per grid. */
  idBase: string
  /** The grid's columns as the form gives them. */
  columns: readonly GridColumn[]
  /** The section's arrangement of them. */
  choices: readonly ColumnChoice[]
  onChoices: (next: ColumnChoice[]) => void
  onReset: () => void
  /** A column as the grid draws it now, read at each press; null while the grid has none. */
  measure: (field: string) => Measured | null
  /** A width set, or taken away so the column is sized to its content again (0151). */
  onWidths: (changes: WidthChange[]) => void
}): ReactElement | null {
  const [open, setOpen] = useState(false)
  /** What the line says of the last press, and the how-manyth press it is: a new element each time. */
  const [said, setSaid] = useState<{ text: string; count: number } | null>(null)
  const presses = useRef(0)
  if (columns.length === 0) return null
  const arranged = arrange(columns, choices)
  const current = arranged.map(({ key, shown }) => ({ field: key, shown }))
  const one = arranged.filter((column) => column.shown).length === 1
  const onlyId = `${idBase}-only`

  const change = (next: readonly ColumnChoice[]): void => {
    if (next !== current) onChoices([...next])
  }
  const say = (text: string): void => {
    presses.current += 1
    setSaid({ text, count: presses.current })
  }
  /** A step wider (1) or narrower (-1) from the width drawn now; at an end, nothing kept, and said why. */
  const step = (column: ArrangedColumn, by: -1 | 1): void => {
    const now = measure(column.key)
    if (now === null) return
    const width = stepWidth(now, by)
    const moved = width !== Math.round(now.width)
    if (moved) onWidths([{ field: column.key, width }])
    say(widthSaid(column.label, width, moved ? 'set' : by === 1 ? 'widest' : 'narrowest'))
  }

  return (
    <>
      <button
        type="button"
        className="button quiet disclosure"
        id={`${idBase}-toggle`}
        aria-expanded={open}
        aria-controls={`${idBase}-tool`}
        onClick={() => {
          setOpen(!open)
          setSaid(null)
        }}
      >
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
                  <button
                    type="button"
                    className="button"
                    aria-label={`Move ${column.label} up`}
                    aria-disabled={index === 0 ? 'true' : undefined}
                    onClick={() => change(moveChoice(current, column.key, -1))}
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    className="button"
                    aria-label={`Move ${column.label} down`}
                    aria-disabled={index === arranged.length - 1 ? 'true' : undefined}
                    onClick={() => change(moveChoice(current, column.key, 1))}
                  >
                    Down
                  </button>
                  <span className="columns-width">
                    <button type="button" className="button columns-step" aria-label={`Make ${column.label} narrower`} onClick={() => step(column, -1)}>
                      <Sign path={MINUS} />
                    </button>
                    <button type="button" className="button columns-step" aria-label={`Make ${column.label} wider`} onClick={() => step(column, 1)}>
                      <Sign path={PLUS} />
                    </button>
                    <button
                      type="button"
                      className="button"
                      aria-label={`Fit ${column.label} to its content`}
                      onClick={() => {
                        onWidths([{ field: column.key, width: null }])
                        say(widthSaid(column.label, 0, 'fitted'))
                      }}
                    >
                      Fit
                    </button>
                  </span>
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
          <p role="status" id={`${idBase}-said`} className="status columns-said" data-kind="answer" aria-labelledby={`${idBase}-toggle`}>
            {said === null ? '' : <span key={said.count}>{said.text}</span>}
          </p>
        </div>
      </div>
    </>
  )
}
