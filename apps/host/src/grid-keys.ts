import type {
  CellDoubleClickedEvent,
  CellFocusedEvent,
  CellKeyDownEvent,
  ColDef,
  GridOptions,
  RowClickedEvent,
  SuppressKeyboardEventParams,
} from 'ag-grid-community'
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
 *   the open record's row when it is on this page. In an editor they move
 *   among the open row's editable cells instead (use-grid-edit.ts, 0179).
 * - **An edit starts on F2 or a double click alone** (0179): on a grid
 *   that edits the open record's cells, the page is told (`edit`) and
 *   decides; AG Grid never starts one, nor ends one, on a key of its own
 *   -- an editor takes every key typed in it (cell-editors.tsx). Typing a
 *   character starts nothing, since `=` is the filter's (0133) and a screen
 *   reader's quick keys would edit by accident; Delete and Backspace clear
 *   nothing; and no key sends anything but one that leaves a row the grid
 *   edited -- an arrow to another row, Space or Enter there -- which saves
 *   that row as the form's Save does first (use-grid-edit.ts).
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
 *   Space and Enter open, and that F2 edits it, in its cell or in the
 *   record's form (0179); on the box and on Delete, which take their own
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

/** What F2 does on a field's cell, said after what Space and Enter do there (0179). */
const EDIT_WORDS = { cell: 'F2 edits it.', form: "F2 edits it in the record's form." } as const

/** What AG Grid's live region says of a row with the keyboard on the column `colId`, in Drill down or not, and whether F2 edits the cell there. */
function rowWords(colId: string | undefined, drilling: boolean, edits: 'cell' | 'form' | null): Readonly<Record<string, string>> {
  if (colId === CHOOSE_COLUMN) return drilling ? DRILL_CHOOSE_WORDS : CHOOSE_WORDS
  if (colId === DELETE_COLUMN) return DELETE_WORDS
  const words = drilling ? DRILL_ROW_WORDS : ROW_WORDS
  return edits === null ? words : Object.fromEntries(Object.entries(words).map(([key, said]) => [key, `${said} ${EDIT_WORDS[edits]}`]))
}

/** A key that types a character -- AltGr's, which is Ctrl and Alt together, among them -- and not a shortcut with Ctrl or Cmd. */
const types = (event: KeyboardEvent): boolean => event.key.length === 1 && (!(event.ctrlKey || event.metaKey) || (event.ctrlKey && event.altKey))

/**
 * Whether AG Grid is kept from a key on a cell: not editing, Space and
 * Enter, which are the page's, F2, the page's edit (0179), and every key
 * that would start or clear an edit of AG Grid's own -- a character,
 * Delete, Backspace; editing, Tab and Enter, which an editor takes first
 * and hands to the page (cell-editors.tsx), so AG Grid never moves an edit
 * on.
 */
function kept({ event, editing }: SuppressKeyboardEventParams<GridRow>): boolean {
  if (editing) return event.key === 'Tab' || event.key === 'Enter'
  return SPACE_OR_ENTER(event.key) || event.key === 'F2' || event.key === 'Delete' || event.key === 'Backspace' || types(event)
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
  /** Where the grid edits the open record's cells (0179): whether F2 edits `row`'s cell of `colId`, in its cell or in the record's form -- read every time AG Grid words a row. */
  edits?(row: GridRow | undefined, colId: string): 'cell' | 'form' | null
  /** F2 or a double click on a cell. */
  edit?(row: GridRow | undefined, colId: string, rowIndex: number | null): void
  /** The keyboard moved to the cell of the row at `rowIndex`: leaving the open row saves it where the grid edited it. */
  moved?(rowIndex: number | null): void
}

/** The keys' part of a grid's options: every column's, and the grid's own. */
export interface KeyOptions {
  /** What every column's cells hold from AG Grid, and that none edits but where a field's column says so (grid-options.tsx). */
  cell: Pick<ColDef<GridRow>, 'editable' | 'suppressKeyboardEvent'>
  /** Tab into the grid and out of it, the live region's words, what a press or a key on a row asks of the page, and how an edit starts and ends. */
  grid: Pick<
    GridOptions<GridRow>,
    | 'tabToNextCell'
    | 'tabToNextHeader'
    | 'getLocaleText'
    | 'focusGridInnerElement'
    | 'onRowClicked'
    | 'onCellKeyDown'
    | 'onCellDoubleClicked'
    | 'onCellFocused'
    | 'suppressClickEdit'
    | 'readOnlyEdit'
    | 'stopEditingWhenCellsLoseFocus'
  >
}

/** The keys' options of a grid, for its whole life: `firstColumn` is read each time, since a person moves and hides columns under them (0106). */
export function keyOptions({ firstColumn, on }: { firstColumn: () => string; on: KeyCallbacks }): KeyOptions {
  return {
    cell: {
      editable: false,
      // Space and Enter belong to the page: AG Grid's own toggle never runs. Nor does an edit of its own (0179).
      suppressKeyboardEvent: kept,
    },
    grid: {
      tabToNextCell: () => false,
      tabToNextHeader: () => false,
      // What AG Grid's live region says about a row is what the page does with
      // it, in the layout shown now and from the cell the keyboard is on: the
      // options are the grid's for its life, and a layout changes under it.
      getLocaleText: ({ key, defaultValue, api }) => {
        const focused = api.getFocusedCell()
        const colId = focused?.column.getColId()
        const row = focused === null || focused === undefined ? undefined : api.getDisplayedRowAtIndex(focused.rowIndex)?.data
        const how = colId === undefined || on.edits === undefined ? null : on.edits(row, colId)
        return rowWords(colId, on.drilling(), how)[key] ?? defaultValue
      },
      // An edit is the page's (0179): started by F2 or a double click, which
      // the page is told of, never by a click; and AG Grid writes nothing to
      // a row, an editor writing into the open record's engine instead. A
      // press outside the grid ends an edit, the engine keeping what was
      // typed: the form beside it is the same draft.
      suppressClickEdit: true,
      readOnlyEdit: true,
      stopEditingWhenCellsLoseFocus: true,
      onCellDoubleClicked: (event: CellDoubleClickedEvent<GridRow>) => {
        if (event.event?.target instanceof Element && event.event.target.closest('button, input, select') !== null) return
        on.edit?.(event.data, event.column.getColId(), event.rowIndex)
      },
      onCellFocused: (event: CellFocusedEvent<GridRow>) => on.moved?.(event.rowIndex),
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
        // F2 on a cell is the page's edit (0179): a box and a Delete hold none, and it says nothing there.
        if (key === 'F2') {
          if (!ownColumn(colId)) on.edit?.(event.data, colId, event.rowIndex)
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
