import { useEffect, useRef } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import type { GridRow } from './grid-datasource.js'
import { headerFloor } from './widths.js'

/*
 * A row's Delete (0053) -- or a together tab's Remove and Undo remove
 * (0155) -- is a real button, in a last column where the form offers
 * delete (grid-options.tsx): a cell the arrow keys reach, whose button
 * takes the keyboard when the cell does. The button is out of the Tab
 * order, so the grid stays one stop, and its Enter and Space are its own,
 * never the row's (grid-keys.ts). It asks the page, which confirms in
 * place; no key deletes. Its column is not resized.
 */

/** The column of a row's Delete: `~` is in no field key (session.ts), so it never names a field's column. */
export const DELETE_COLUMN = '~delete'

/** What a row's Delete asks: the form's title, which its name gives, and what a press does. */
export interface RowDelete {
  noun: string
  press(row: GridRow): void
  /**
   * What a row's button says and is named, where it is not Delete: a
   * together tab's Remove and Undo remove (0155); null draws none on that
   * row -- at a bound, or where the person may not.
   */
  said?: (row: GridRow) => { text: string; name: string } | null
  /** The column's header, where it is not Delete. */
  heading?: string
}

/**
 * A row's Delete that reads the page's handler, and its words, each time it
 * is pressed or drawn (`now`): the column is made once, and a together
 * tab's words change with its set (0155).
 */
export function liveDelete(now: () => RowDelete | undefined, noun: string, worded: boolean, heading: string | undefined): RowDelete {
  return {
    noun,
    press: (row) => now()?.press(row),
    ...(worded ? { said: (row: GridRow) => now()?.said?.(row) ?? null } : {}),
    ...(heading === undefined ? {} : { heading }),
  }
}

/**
 * A row's Delete: an outline in the room's `--invalid`, text and border and
 * never a fill. Its own style attribute, in room variables, because no rule
 * of host.css reaches into a grid (0047); 28 pixels tall, past the 24 of
 * WCAG 2.5.8, inside the 36 of a row.
 */
const DELETE_LOOK: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: '28px',
  padding: '0 10px',
  border: '1px solid var(--invalid)',
  borderRadius: '999px',
  background: 'transparent',
  color: 'var(--invalid)',
  font: 'inherit',
  fontSize: '13px',
  lineHeight: 1,
  cursor: 'pointer',
}

/**
 * The cell of a row's Delete. AG Grid moves the keyboard between cells, and
 * this cell hands it to its button whenever the cell itself is focused, so
 * the arrow keys reach a real button named for the record; the button is
 * `tabIndex` -1, so Tab still leaves the grid in one stop. A row with no
 * token has none: it cannot be addressed.
 */
function DeleteCell(params: ICellRendererParams<GridRow> & { remove: RowDelete }): ReactElement | null {
  const button = useRef<HTMLButtonElement>(null)
  const cell = params.eGridCell
  useEffect(() => {
    const forward = (event: FocusEvent): void => {
      if (event.target === cell) button.current?.focus({ preventScroll: true })
    }
    cell.addEventListener('focus', forward)
    if (document.activeElement === cell) button.current?.focus({ preventScroll: true })
    return () => cell.removeEventListener('focus', forward)
  }, [cell])
  const row = params.data
  if (row === undefined || row.record === null) return null
  const { remove } = params
  const said = remove.said === undefined ? { text: 'Delete', name: `Delete ${remove.noun} ${row.record}` } : remove.said(row)
  if (said === null) return null
  return (
    <button type="button" tabIndex={-1} ref={button} style={DELETE_LOOK} aria-label={said.name} onClick={() => remove.press(row)}>
      {said.text}
    </button>
  )
}

/** The column of a row's Delete, headed Delete unless the page names it otherwise. */
export function deleteColumn(remove: RowDelete): ColDef<GridRow> {
  return {
    colId: DELETE_COLUMN,
    headerName: remove.heading ?? 'Delete',
    // A row's words, so the cell is drawn again when they change: a together tab's Remove becomes Undo remove (0155).
    valueGetter: (params) => (params.data === undefined ? '' : (remove.said?.(params.data)?.text ?? '')),
    sortable: false,
    minWidth: headerFloor(remove.heading ?? 'Delete', false),
    maxWidth: 160,
    cellRenderer: DeleteCell,
    cellRendererParams: { remove },
  }
}
