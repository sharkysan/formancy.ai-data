import type { CellKeyDownEvent, ColDef, GridOptions, RowClickedEvent } from 'ag-grid-community'
import { CHOOSE_COLUMN } from './choose-column.js'
import { DELETE_COLUMN } from './delete-column.js'
import type { GridRow } from './grid-datasource.js'

/*
 * What a key or a press does on a record grid (0047), and what AG Grid's
 * live region says of a row as the keyboard reaches it: decided once here,
 * for every grid, and put in its options by grid-options.tsx.
 *
 * - **The page decides which row is open, not AG Grid.** Space and Enter
 *   are held from AG Grid on every cell, so its own Space never toggles a
 *   selection -- which would deselect the open row -- and the page is told
 *   of both keys and of a click instead (`asked`).
 * - **One Tab stop.** Tab and Shift+Tab leave the grid; Tab into it lands on
 *   the open record's row when it is on this page.
 * - **Nothing edits**, so Delete and Backspace clear nothing and no key
 *   sends anything.
 * - **A row's Delete and its box take their own keys.** Space and Enter on
 *   a row's Delete press it (delete-column.tsx, 0053), in every layout,
 *   never the row's. Space on a row's box ticks it (choose-column.tsx, 0166),
 *   never the row's, so it never opens the record or deselects the open
 *   row; its Enter opens the record as any cell's does. A row with no box
 *   -- no token, or none at a version -- leaves Space to the row, which
 *   says why it cannot be opened. A press of either is the button's or the
 *   box's, never the row's.
 * - **What AG Grid's live region says of a row** as the keyboard reaches
 *   one of its cells is what the keys do there: on a field's cell, what
 *   Space and Enter open; on the box and on Delete, which take their own
 *   keys, what those do. `=` keeps a field's value (0133); the box and
 *   Delete hold none, so it asks nothing there.
 */

export type OpenHow = 'click' | 'space' | 'enter'

const SPACE_OR_ENTER = (key: string): boolean => key === ' ' || key === 'Enter'

/** What AG Grid's live region says about a row: what the page does with it. */
const ROW_WORDS: Readonly<Record<string, string>> = {
  ariaRowSelect: 'Space opens this record. Enter opens it and moves to it.',
  ariaRowDeselect: 'This record is open.',
  ariaRowToggleSelection: 'Space opens this record.',
}

/** The same in Drill down, where Space and Enter both go down to the record (0090). */
const DRILL_ROW_WORDS: Readonly<Record<string, string>> = {
  ariaRowSelect: 'Space or Enter opens this record and moves to it.',
  ariaRowDeselect: 'This record is open. Space or Enter moves to it.',
  ariaRowToggleSelection: 'Space or Enter opens this record.',
}

/** On a row's box (0166), whose Space ticks it and opens nothing; Enter opens the record as on any cell. */
const CHOOSE_WORDS: Readonly<Record<string, string>> = {
  ariaRowSelect: 'Space ticks or unticks this box. Enter opens the record and moves to it.',
  ariaRowDeselect: 'This record is open. Space ticks or unticks this box.',
}

/** The same in Drill down, where Enter on the open record moves to it. */
const DRILL_CHOOSE_WORDS: Readonly<Record<string, string>> = {
  ariaRowSelect: 'Space ticks or unticks this box. Enter opens the record and moves to it.',
  ariaRowDeselect: 'This record is open. Space ticks or unticks this box; Enter moves to it.',
}

/** On a row's Delete (0053), whose Space and Enter press it, in every layout: it asks, and confirms in place. */
const DELETE_WORDS: Readonly<Record<string, string>> = {
  ariaRowSelect: 'Space or Enter asks to delete this record.',
  ariaRowDeselect: 'This record is open. Space or Enter asks to delete it.',
}

/** What AG Grid's live region says of a row with the keyboard on the column `colId`, in Drill down or not. */
function rowWords(colId: string | undefined, drilling: boolean): Readonly<Record<string, string>> {
  if (colId === CHOOSE_COLUMN) return drilling ? DRILL_CHOOSE_WORDS : CHOOSE_WORDS
  if (colId === DELETE_COLUMN) return DELETE_WORDS
  return drilling ? DRILL_ROW_WORDS : ROW_WORDS
}

/** A column of the page's own -- a row's box, or its Delete -- which takes its own keys and holds no field's value. */
const ownColumn = (colId: string): boolean => colId === CHOOSE_COLUMN || colId === DELETE_COLUMN

/** What a grid's keys and presses tell the page, and ask of it. */
export interface KeyCallbacks {
  /** The record open in the detail, if any: read every time, never kept. */
  openToken(): string | null
  /** A row asked for -- by a click, Space or Enter -- whether or not it has a token. */
  asked(row: GridRow | undefined, how: OpenHow, rowIndex: number | null, colId: string): void
  /** Whether the grid is shown in Drill down, where Space and Enter both go down: read every time AG Grid words a row. */
  drilling(): boolean
  /** `=` on a cell: its value kept as its column's condition (0133), or said where the column offers none. */
  example(row: GridRow | undefined, colId: string): void
}

/** The keys' part of a grid's options: every column's, and the grid's own. */
export interface KeyOptions {
  /** What every column's cells hold from AG Grid, and that none edits. */
  cell: Pick<ColDef<GridRow>, 'editable' | 'suppressKeyboardEvent'>
  /** Tab into the grid and out of it, the live region's words, and what a press or a key on a row asks of the page. */
  grid: Pick<GridOptions<GridRow>, 'tabToNextCell' | 'tabToNextHeader' | 'getLocaleText' | 'focusGridInnerElement' | 'onRowClicked' | 'onCellKeyDown'>
}

/** The keys' options of a grid, for its whole life: `firstColumn` is read each time, since a person moves and hides columns under them (0106). */
export function keyOptions({ firstColumn, on }: { firstColumn: () => string; on: KeyCallbacks }): KeyOptions {
  return {
    cell: {
      editable: false,
      // Space and Enter belong to the page: AG Grid's own toggle never runs.
      suppressKeyboardEvent: (params) => SPACE_OR_ENTER(params.event.key),
    },
    grid: {
      tabToNextCell: () => false,
      tabToNextHeader: () => false,
      // What AG Grid's live region says about a row is what the page does with
      // it, in the layout shown now and from the cell the keyboard is on: the
      // options are the grid's for its life, and a layout changes under it.
      getLocaleText: ({ key, defaultValue, api }) => rowWords(api.getFocusedCell()?.column.getColId(), on.drilling())[key] ?? defaultValue,
      focusGridInnerElement: (params) => {
        const token = on.openToken()
        const node = token === null ? undefined : params.api.getRowNode(token)
        if (node === undefined || node.rowIndex === null) return false
        params.api.ensureIndexVisible(node.rowIndex)
        params.api.setFocusedCell(node.rowIndex, firstColumn())
        return true
      },
      onRowClicked: (event: RowClickedEvent<GridRow>) => {
        // A press of the row's Delete is the button's, and of its box the box's, never the row's: neither opens the record (0053, 0166).
        if (event.event?.target instanceof Element && event.event.target.closest('button, input') !== null) return
        on.asked(event.data, 'click', event.rowIndex, firstColumn())
      },
      onCellKeyDown: (event: CellKeyDownEvent<GridRow>) => {
        const keyboard = event.event as KeyboardEvent | null | undefined
        const key = keyboard?.key ?? ''
        const colId = event.column.getColId()
        // `=` keeps the rows with the cell's value (0133) -- not with Ctrl or
        // Cmd, which zoom, nor a plain Alt; AltGr, which some layouts type `=`
        // with, is Ctrl and Alt together. A box or a Delete holds no value.
        if (key === '=' && keyboard !== null && keyboard !== undefined && !keyboard.metaKey && keyboard.ctrlKey === keyboard.altKey) {
          if (!ownColumn(colId)) on.example(event.data, colId)
          return
        }
        // Space and Enter on a row's Delete are its button's, and Space on its box the box's: the browser presses or ticks it (0166).
        const boxed = event.data?.record != null && event.data.version != null
        const own = colId === DELETE_COLUMN || (key === ' ' && colId === CHOOSE_COLUMN && boxed)
        if (!SPACE_OR_ENTER(key) || own) return
        event.event?.preventDefault()
        on.asked(event.data, key === 'Enter' ? 'enter' : 'space', event.rowIndex, colId)
      },
    },
  }
}
