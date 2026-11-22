import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import type { ChosenRows } from './chosen-rows.js'
import type { GridRow } from './grid-datasource.js'
import { headerFloor } from './widths.js'

/*
 * The column a person chooses a page's records with, for an action over a
 * selection (0166) or a deletion or a change of them (0174, 0176): drawn first, and only on a
 * form that offers this person one. The grid's own row selection is the open row
 * (grid-options.tsx), so the choice is a column of real checkboxes, on
 * the pattern of a row's Delete (0053): a cell the arrow keys reach, which
 * hands the keyboard to its box whenever the cell is focused; the box is
 * `tabIndex` -1, so Tab still leaves the grid in one stop; and its Space
 * is its own -- the browser ticks it -- and never the row's, which would
 * open the record or, as AG Grid's own, deselect the open row. Enter on it
 * opens the record, as on any cell of the row.
 */

/** The column of the boxes: `~` is in no field key (session.ts), so it never names a field's column. */
export const CHOOSE_COLUMN = '~choose'

/** Its header, which names what the boxes do. */
export const CHOOSE_HEADING = 'Choose'

/**
 * A box: 24 pixels square, the least target WCAG 2.5.8 asks, in the violet
 * a person acts with. Its own style attribute, in room variables, because
 * no rule of host.css reaches into a grid (0047).
 */
const BOX_LOOK: CSSProperties = {
  width: '24px',
  height: '24px',
  margin: 0,
  accentColor: 'var(--client)',
  cursor: 'pointer',
}

/**
 * The box of one row, named for its record as its Delete names it, and
 * ticked while the record is chosen; after a deletion or a change of the
 * choice that did not do it, described by why until the choice changes
 * (0174, 0176): its
 * title, which is its description -- its name being its label -- and what a
 * pointer resting on it shows.
 */
function ChooseCell(params: ICellRendererParams<GridRow> & { choice: ChosenRows }): ReactElement | null {
  const box = useRef<HTMLInputElement>(null)
  const cell = params.eGridCell
  const { choice } = params
  const row = params.data
  const token = row?.record ?? null
  const chosen = useSyncExternalStore(choice.subscribe, () => token !== null && choice.now().chosen.has(token))
  const mark = useSyncExternalStore(choice.subscribe, () => (token === null ? undefined : choice.now().marks.get(token)))
  useEffect(() => {
    const forward = (event: FocusEvent): void => {
      if (event.target === cell) box.current?.focus({ preventScroll: true })
    }
    cell.addEventListener('focus', forward)
    if (document.activeElement === cell) box.current?.focus({ preventScroll: true })
    return () => cell.removeEventListener('focus', forward)
  }, [cell])
  // A row with no token, or none at a version, cannot be addressed by a run: no box.
  if (row === undefined || token === null || row.version === null) return null
  return (
    <input
      type="checkbox"
      tabIndex={-1}
      ref={box}
      style={BOX_LOOK}
      aria-label={`Choose ${choice.name(token)}`}
      title={mark}
      checked={chosen}
      onChange={() => choice.toggle(row)}
    />
  )
}

/** The column, first, so the boxes are where a person looks for them; Tab into the grid still lands on the open row's first field (grid-options.tsx). */
export function chooseColumn(choice: ChosenRows): ColDef<GridRow> {
  return {
    colId: CHOOSE_COLUMN,
    headerName: CHOOSE_HEADING,
    sortable: false,
    minWidth: headerFloor(CHOOSE_HEADING, false),
    maxWidth: 120,
    cellRenderer: ChooseCell,
    cellRendererParams: { choice },
  }
}
