import { useEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import type { GridApi, IRowNode } from 'ag-grid-community'
import { parsePath } from '@formancy/core'
import type { FormEngine } from '@formancy/core'
import { fieldHeading } from '@formancy/data-client'
import type { DataClient, FormRecord, PublishedForm } from '@formancy/data-client'
import type { CellEditing, EditKey } from './cell-editors.js'
import { CHOOSE_COLUMN } from './choose-column.js'
import { DELETE_COLUMN } from './delete-column.js'
import type { MasterOpen } from './detail.js'
import { drawnCopies } from './drawn-copies.js'
import type { GridColumn, GridRow } from './grid-datasource.js'
import { cellEdit, drawnOf, invalidSaid, leaving, markOf, outcomeSaid, SAVE_WAITED, settled, stepFrom } from './grid-edit.js'
import type { CellEdit, DrawnField, RowState } from './grid-edit.js'
import type { Said } from './leave.js'
import { focusField, hearSaves, reachOf } from './pane-reach.js'
import type { SaveFrom } from './pane-reach.js'
import { renderersOf } from './panes.js'
import type { RendererChoice } from './prefs.js'
import type { RecordGridHandle, RowAt } from './record-grid.js'
import type { SaveResult, Session } from './session.js'
import { DECLINED_BY } from './words.js'

/*
 * The Records grid's edit of the open record in its row (0179): the open
 * row is the record's draft -- the engine of the session the detail draws,
 * the React pane's under Both (0029) -- so its cells draw that engine's
 * answers, an editor writes into it (cell-editors.tsx), and a save of the
 * row is the pane's own Save (pane-reach.ts): the same create and update
 * plan, route and outcomes. What is edited where, the row's states and
 * when it is left are grid-edit.ts's; this does them on AG Grid and the
 * page.
 *
 * - **F2 or a double click** on a cell of another row leaves the open one
 *   -- saving it first where the grid edited it -- opens the record as
 *   Space does, through the guard, and edits the cell once it is read; on
 *   a cell the record's form edits, the keyboard goes to that field there,
 *   the record shown as Enter shows it. In Drill down, where the grid is
 *   hidden once a record opens, every cell is the form's. Typing a
 *   character starts nothing (grid-keys.ts).
 * - **In an editor** Tab and Shift+Tab go to the row's next and previous
 *   editable cell shown; past the last, the row is saved and, once it is,
 *   the next row on the page is edited in its first; before the first, and
 *   on Enter, the row is saved and the edit ends, the keyboard on the cell.
 *   Escape puts the cell back and ends the edit, the row's other changes
 *   kept and its state as the editor began: a row the grid had not edited
 *   is not edited, so leaving it saves nothing the form alone typed, and a
 *   row not saved still says so.
 * - **A row is saved when it is left**, where the grid edited it since it
 *   was opened or saved and its answers still differ: the keyboard or a
 *   press moving to another row, Tab past its last cell, Enter. Focus
 *   leaving the grid saves nothing: the form beside it is the same draft.
 * - **While its save is out** the row says Saving…, its cells take no
 *   edit, F2 says the save is waited for, and the next row -- a press, F2
 *   or Space on another -- waits for the answer, and goes on only where the
 *   row saved. The form's Save of a row the grid edited is the row's save:
 *   while it is out the next row waits for it the same way, and nothing is
 *   sent beside it. The rest of the grid moves and pages.
 * - **Saved**, the row takes what is stored and its version in place, and
 *   no page is read, so no row moves under the keyboard: its sort places it
 *   once the page is read again. A lookup's label is asked for where the
 *   save changed it.
 * - **Not stored**, the row's first cell says so and the line says why, in
 *   the session's words; invalid, the first invalid cell shown takes the
 *   keyboard in its editor, the line naming the rest. A save of the form's
 *   that did not store marks the row too: it is the same draft.
 */

/** What a record grid asks of the open record's edit, and tells it: every grid callback that edits, beside what its editors ask (cell-editors.tsx). */
export interface GridEdit extends CellEditing {
  /** How the cell of `colId` on `row` is edited (grid-edit.ts): on the open row read from the engine, on another from the copy it would be drawn with. */
  how(row: GridRow | undefined, colId: string): CellEdit
  /** AG Grid's `editable`: the open row's cell, edited in its cell, with no save of it out and nothing holding its Save. */
  editable(row: GridRow | undefined, colId: string): boolean
  /** The row as the grid draws it: the open record's from its engine, every other as listed. */
  drawn(row: GridRow | undefined): GridRow | undefined
  /** What the row's first cell says after its value: the open row's state. */
  mark(row: GridRow | undefined): string
  /** F2 or a double click on the cell of `colId` on `row`, at `rowIndex`. */
  start(row: GridRow | undefined, colId: string, rowIndex: number | null): void
  /** A row asked for by a press, Space or Enter: `go` opens it once the open row is left -- saved first, or its save answered. */
  leave(token: string, go: () => void): void
  /** The keyboard moved to the row at `rowIndex`. */
  moved(rowIndex: number | null): void
  /** The grid's api, once it is made; null once it is gone. */
  attach(api: GridApi<GridRow> | null): void
}

export interface GridEditOptions {
  client: DataClient
  formId: string
  definition: PublishedForm
  /** The form's title, which names its records: "Order k1:9". */
  title: string
  columns: readonly GridColumn[]
  renderer: RendererChoice
  /** Drill down, where the grid is hidden once a record opens. */
  drilling: boolean
  sessions: readonly Session[]
  openRef: RefObject<MasterOpen>
  /** The record open now: its row is drawn from the engine from the render that shows it. */
  openToken: string | null
  grid: RefObject<RecordGridHandle | null>
  /** The form's way to act once the page has rendered (after-render.ts). */
  after: (action: () => void) => void
  /** `token` opened as Space opens a row, through the guard, and `then` once it is open. */
  open: (token: string, at: RowAt, then: () => void) => void
  /** The record shown, as Enter shows it: in Separate views its view, in Drill down its level. */
  toRecord: () => void
}

/** Whether two answers are the same value: answers are JSON, so their JSON is. */
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** The open record's edit in its row of the Records grid. */
export function useGridEdit(options: GridEditOptions): GridEdit {
  const latest = useRef(options)
  latest.current = options
  const { definition, sessions, renderer, openToken } = options
  const edit = useMemo(() => createGridEdit(latest, drawnCopies(definition)), [definition])

  // The open row drawn from its engine as it changes: each answer typed in the form, each form opened, each save.
  useEffect(() => {
    const shown = renderersOf(renderer)[0]
    const session = sessions.find((each) => each.renderer === shown)
    if (session === undefined) return undefined
    let stop = (): void => {}
    const watch = (): void => {
      stop()
      stop = session.opened().engine.subscribe(() => edit.refresh())
      edit.refresh()
    }
    watch()
    const unwatch = session.subscribe(watch)
    const unhear = hearSaves(session, (result, from) => edit.heard(result, from))
    return () => {
      stop()
      unwatch()
      unhear()
    }
  }, [edit, sessions, renderer])
  useEffect(() => edit.refresh(), [edit, openToken])
  return edit
}

type Latest = RefObject<GridEditOptions>

function createGridEdit(
  latest: Latest,
  copies: ReturnType<typeof drawnCopies>,
): GridEdit & { refresh(): void; heard(result: SaveResult | null, from: SaveFrom): void } {
  let api: GridApi<GridRow> | null = null
  /** The open row's state, for the record and the form it was set in: a form opened again -- discarded, loaded -- starts clean. */
  let row: { token: string; generation: number; state: RowState } | null = null
  /** The field whose editor is open. */
  let editing: string | null = null
  /** The open row's state as the editor open now began: what Escape, which gives that cell's typing up, gives back. */
  let began: { token: string; generation: number; state: RowState } | null = null
  /** What waits for the open row's save to store: another row, opened. */
  let pending: (() => void) | null = null
  /** The record last drawn from its engine: drawn as listed again once another is open. */
  let drawnToken: string | null = null

  const now = (): GridEditOptions => latest.current
  const live = (): GridApi<GridRow> | null => (api === null || api.isDestroyed() ? null : api)
  /** The session the detail draws: the first renderer shown, React under Both. */
  const sessionShown = (): Session | undefined => now().sessions.find((each) => each.renderer === renderersOf(now().renderer)[0])
  /** The open record, its session and its engine, while that session holds it. */
  function opened(): { token: string; session: Session; engine: FormEngine; generation: number } | null {
    const open = now().openRef.current
    const session = sessionShown()
    if (open?.kind !== 'record' || session === undefined || session.state().record !== open.token) return null
    const form = session.opened()
    return { token: open.token, session, engine: form.engine, generation: form.generation }
  }
  const nodeOf = (token: string): IRowNode<GridRow> | undefined => live()?.getRowNode(token)
  const stateNow = (): RowState => {
    const open = opened()
    return open !== null && row?.token === open.token && row.generation === open.generation ? row.state : { kind: 'clean' }
  }
  const labelOf = (field: string): string => {
    const def = now().definition.form.model.fields.find((each) => each.key === field)
    return def === undefined ? field : fieldHeading(def)
  }
  const tell = (said: Said, kind: 'stored' | 'refused' | 'pending' = 'refused'): void => now().grid.current?.tell(said, kind)

  /** The open row's cells, and the row drawn from its engine before, drawn again: all but the cell in edit, whose editor holds it. */
  function refresh(): void {
    const grid = live()
    if (grid === null) return
    const open = opened()
    const tokens = [...new Set([drawnToken, open?.token ?? null])].filter((token): token is string => token !== null)
    drawnToken = open?.token ?? null
    const rowNodes = tokens.map(nodeOf).filter((node): node is IRowNode<GridRow> => node !== undefined)
    if (rowNodes.length === 0) return
    // Never a cell AG Grid has an editor open in: drawn again, its editor would go, and the keyboard with it.
    const inEdit = new Set([editing, ...grid.getEditingCells().map((cell) => cell.column?.getColId())])
    const columns = (grid.getColumns() ?? []).map((column) => column.getColId()).filter((id) => !inEdit.has(id))
    grid.refreshCells({ rowNodes, columns, force: true })
  }

  function setState(state: RowState): void {
    const open = opened()
    if (open === null) return
    row = { token: open.token, generation: open.generation, state }
    refresh()
  }

  /** The field as the engine draws it now: its conditions evaluated. */
  function liveField(engine: FormEngine, field: string): DrawnField | undefined {
    if (!engine.fieldPaths().includes(field)) return undefined
    const snapshot = engine.getFieldSnapshot(parsePath(field))
    return { def: snapshot.def, disabled: snapshot.disabled, readOnly: snapshot.readOnly, visible: snapshot.visible }
  }

  function how(gridRow: GridRow | undefined, colId: string): CellEdit {
    if (gridRow === undefined) return { kind: 'never', why: null }
    const field = colId === CHOOSE_COLUMN || colId === DELETE_COLUMN ? null : colId
    const open = opened()
    const isOpen = open !== null && gridRow.record === open.token
    const record: FormRecord = { record: gridRow.record, version: gridRow.version, answers: gridRow.answers as FormRecord['answers'] }
    const drawn = field === null ? undefined : isOpen ? liveField(open.engine, field) : drawnOf(copies.of(record, false), field)
    const decided = cellEdit({ definition: now().definition, row: drawnRow(gridRow) ?? gridRow, field, drawn })
    // In Drill down a record opened goes down a level and the grid is hidden: its cells are the form's there.
    return now().drilling && decided.kind === 'cell' ? { kind: 'form' } : decided
  }

  function drawnRow(gridRow: GridRow | undefined): GridRow | undefined {
    const open = opened()
    if (gridRow === undefined || open === null || gridRow.record !== open.token) return gridRow
    const answers = (open.engine.value() ?? {}) as Record<string, unknown>
    // A lookup's label is the page's where its answer is the one listed; changed, the cell shows its token until it is asked for.
    const labels = Object.fromEntries(Object.entries(gridRow.labels).filter(([key]) => same(answers[key], gridRow.answers[key])))
    return { ...gridRow, answers: { ...gridRow.answers, ...answers }, labels }
  }

  /** The open row's fields edited in their cells, in the order their columns are shown. */
  function cellsOf(gridRow: GridRow | undefined): string[] {
    const grid = live()
    if (grid === null) return []
    return grid
      .getAllDisplayedColumns()
      .map((column) => column.getColId())
      .filter((colId) => how(gridRow, colId).kind === 'cell')
  }

  function editable(gridRow: GridRow | undefined, colId: string): boolean {
    const open = opened()
    if (open === null || gridRow?.record !== open.token) return false
    if (stateNow().kind === 'saving' || open.session.isSaving() || open.session.held() !== undefined) return false
    return how(gridRow, colId).kind === 'cell'
  }

  /** The editor opened on the open row's cell of `field`, the keyboard in it. */
  function begin(rowIndex: number, field: string): void {
    const grid = live()
    const open = opened()
    const node = open === null ? undefined : nodeOf(open.token)
    if (open === null || grid === null || node === undefined || !editable(node.data, field)) return
    grid.ensureIndexVisible(rowIndex)
    grid.setFocusedCell(rowIndex, field)
    editing = field
    began = { token: open.token, generation: open.generation, state: stateNow() }
    grid.startEditingCell({ rowIndex, colKey: field })
  }

  /** The edit ended and the keyboard on its cell. */
  function end(rowIndex: number, field: string, cancel: boolean): void {
    const grid = live()
    if (grid === null) return
    grid.stopEditing(cancel)
    grid.setFocusedCell(rowIndex, field)
  }

  /** The keyboard on `field` in the record's form, the record shown as Enter shows it. */
  function toField(field: string): void {
    const open = opened()
    if (open === null) return
    now().toRecord()
    const reach = reachOf(open.session)
    now().after(() => (reach === undefined ? focusField(open.engine, field) : reach.goTo(field)))
  }

  /** The open row saved, as its pane's Save saves it; `then` once it stored. */
  async function save(then?: () => void): Promise<void> {
    const open = opened()
    if (open === null) return
    pending = then ?? null
    setState({ kind: 'saving' })
    tell([`Saving ${now().title} `, { code: open.token }, '…'], 'pending')
    const reach = reachOf(open.session)
    if (reach !== undefined) {
      // The pane tells `heard` its answer, as it tells every save it answers.
      await reach.save()
      return
    }
    // No pane draws the session -- its renderer is not shown -- so the grid alone says what the save came to.
    const submitted = open.engine.submit()
    heard(await open.session.save(submitted.ok ? { ok: true, data: open.engine.value() } : { ok: false }), 'grid')
  }

  /** What is stored, in the open row in place, its version among it; a lookup it changed asked for its label. */
  function stored(open: NonNullable<ReturnType<typeof opened>>): void {
    const node = nodeOf(open.token)
    if (node?.data === undefined) return
    const saved = open.session.saved()
    const answers = { ...node.data.answers, ...saved.answers }
    const labels = Object.fromEntries(Object.entries(node.data.labels).filter(([key]) => same(answers[key], node.data?.answers[key])))
    const data: GridRow = { ...node.data, version: saved.version, answers, labels }
    node.setData(data)
    const { client, formId, columns } = now()
    for (const column of columns) {
      const token = answers[column.key]
      if (column.source === null || typeof token !== 'string' || token === '' || labels[column.key] !== undefined) continue
      void client.resolve(formId, column.source, { operation: 'read', tokens: [token] }).then((named) => {
        const label = named.ok ? named.value.find((each) => each.token === token)?.label : undefined
        if (label === undefined || node.data?.version !== data.version) return
        node.setData({ ...node.data, labels: { ...node.data.labels, [column.key]: label } })
      })
    }
  }

  /** A save of the open record a pane answered, from its Save or from the grid: the row's state, what it holds, and where the keyboard goes. */
  function heard(result: SaveResult | null, from: SaveFrom): void {
    // A press of the form's that sent nothing -- its engine refused it, a save was out, a create's loss held it, a row's form refused -- is
    // about that press, which the form says, not the draft's save; and a form replaced since is not the row's.
    if (from === 'form' && (result === null || result.kind === 'busy' || result.kind === 'held' || result.kind === 'rows')) return
    if (result?.kind === 'replaced') return
    const open = opened()
    const go = pending
    pending = null
    if (open === null) return
    setState(settled(result))
    if (result?.kind === 'saved' || result?.kind === 'created') {
      // Stored by the form's Save, for which the page is read again: a row asked for while it was out goes on now.
      if (from === 'form') {
        go?.()
        return
      }
      stored(open)
      tell(outcomeSaid(result, { noun: now().title, token: open.token, declinedBy: DECLINED_BY }).said, 'stored')
      go?.()
      return
    }
    if (from === 'form') return
    if (result === null || result.kind === 'invalid') {
      invalid(open, result)
      return
    }
    tell(outcomeSaid(result, { noun: now().title, token: open.token, declinedBy: DECLINED_BY }).said)
  }

  /** An invalid save, by the engine or the server: the first invalid cell shown in its editor, the rest named on the line. */
  function invalid(open: NonNullable<ReturnType<typeof opened>>, result: SaveResult | null): void {
    const node = nodeOf(open.token)
    const { engine } = open
    // What the form shows as wrong; failing that, every field the engine holds a problem on -- a server's verdict among them.
    const shown = engine.visibleErrors().map((each) => each.path)
    const wrong = shown.length > 0 ? shown : engine.fieldPaths().filter((path) => engine.getFieldSnapshot(parsePath(path)).errors.length > 0)
    if (wrong.length === 0) {
      tell(result === null ? ['Not saved.'] : outcomeSaid(result, { noun: now().title, token: open.token, declinedBy: DECLINED_BY }).said)
      return
    }
    const first = cellsOf(node?.data).find((field) => wrong.includes(field)) ?? null
    const rest = wrong.filter((field) => field !== first).map(labelOf)
    const declined = result?.kind === 'invalid' && result.declined === true ? ` ${DECLINED_BY}` : ''
    tell([`${invalidSaid(first === null ? null : labelOf(first), rest)}${declined}`])
    const rowIndex = node?.rowIndex ?? null
    // After the render that draws the problems, whose summary in the form takes the keyboard as it does on a Save there.
    if (first !== null && rowIndex !== null) now().after(() => begin(rowIndex, first))
  }

  /** The next row of the page shown after `rowIndex`, if it has one. */
  function nextRow(rowIndex: number): IRowNode<GridRow> | null {
    const grid = live()
    if (grid === null) return null
    const last = (grid.paginationGetCurrentPage() + 1) * grid.paginationGetPageSize() - 1
    const node = rowIndex + 1 > last ? undefined : grid.getDisplayedRowAtIndex(rowIndex + 1)
    return node?.data === undefined || node.rowIndex === null ? null : node
  }

  function leave(token: string, go: () => void): void {
    const open = opened()
    if (open === null || token === open.token) {
      go()
      return
    }
    const decision = leaving(stateNow(), open.session.changed(), open.session.isSaving())
    if (decision === 'go') go()
    else if (decision === 'wait') pending = go
    else void save(go)
  }

  function start(gridRow: GridRow | undefined, colId: string, rowIndex: number | null): void {
    if (gridRow === undefined || rowIndex === null) return
    const decided = how(gridRow, colId)
    if (decided.kind === 'never') {
      if (decided.why !== null) tell([decided.why])
      return
    }
    const open = opened()
    const token = gridRow.record
    if (token === null) return
    if (open === null || open.token !== token) {
      // Another row: the open one left, this record opened as Space opens it, and then edited -- or said why not, as its engine draws it.
      const listed = gridRow.version
      leave(token, () =>
        now().open(token, { rowIndex, colId }, () => {
          const node = nodeOf(token)
          if (node?.data === undefined || node.rowIndex === null) return
          const read = opened()
          if (read !== null && read.session.state().version !== listed)
            tell([`Opened ${now().title} `, { code: token }, ' as it is stored now: it changed since this page listed it.'], 'pending')
          start(node.data, colId, node.rowIndex)
        }),
      )
      return
    }
    if (stateNow().kind === 'saving' || open.session.isSaving()) {
      tell([SAVE_WAITED])
      return
    }
    const held = open.session.held()
    if (held !== undefined) {
      tell([held])
      return
    }
    if (decided.kind === 'form') toField(colId)
    else begin(rowIndex, colId)
  }

  function key(field: string, pressed: EditKey): void {
    const open = opened()
    const node = open === null ? undefined : nodeOf(open.token)
    const rowIndex = node?.rowIndex
    if (open === null || node === undefined || rowIndex === null || rowIndex === undefined) return
    const leaves = (): boolean => leaving(stateNow(), open.session.changed(), open.session.isSaving()) === 'save'
    if (pressed === 'cancel') {
      // The cell's typing given up, and the row's state with it: a row the grid had not edited is not, and one not saved still says so.
      if (began?.token === open.token && began.generation === open.generation && stateNow().kind !== 'saving') setState(began.state)
      return end(rowIndex, field, true)
    }
    if (pressed === 'end') {
      end(rowIndex, field, false)
      if (leaves()) void save()
      return
    }
    const step = stepFrom(cellsOf(node.data), field, pressed === 'back')
    if (step.kind === 'cell') {
      live()?.stopEditing()
      begin(rowIndex, step.field)
      return
    }
    end(rowIndex, field, false)
    const next = pressed === 'next' ? nextRow(rowIndex) : null
    // Past the last cell, the next row in its first editable cell -- as the copy it would be drawn with says, its engine deciding once it is read.
    const onward =
      next === null
        ? null
        : (): void => {
            const first = cellsOf(next.data)[0]
            if (first === undefined) live()?.setFocusedCell(next.rowIndex ?? 0, field)
            else start(next.data, first, next.rowIndex)
          }
    if (leaves()) void save(onward ?? undefined)
    else onward?.()
  }

  return {
    refresh,
    heard,
    how,
    editable,
    drawn: drawnRow,
    mark: (gridRow) => (gridRow !== undefined && gridRow.record !== null && gridRow.record === opened()?.token ? markOf(stateNow()) : ''),
    start,
    leave,
    key,
    moved(rowIndex) {
      const open = opened()
      const node = open === null ? undefined : nodeOf(open.token)
      if (open === null || node === undefined || rowIndex === null || node.rowIndex === rowIndex) return
      // The form's Save out is the row's save: its answer is the row's, and nothing is sent beside it.
      if (leaving(stateNow(), open.session.changed(), open.session.isSaving()) === 'save') void save()
    },
    attach(made) {
      api = made
      refresh()
    },
    engine: () => opened()?.engine ?? null,
    editorFor(field) {
      const open = opened()
      const decided = open === null ? undefined : how(nodeOf(open.token)?.data, field)
      return decided?.kind === 'cell' ? decided.editor : null
    },
    nameOf: (field) => `${labelOf(field)}, ${now().title} ${opened()?.token ?? ''}`,
    put(field, value) {
      const open = opened()
      if (open === null) return
      const before = (open.engine.value() as Record<string, unknown> | undefined)?.[field]
      open.engine.setValue(parsePath(field), value)
      if (!same(before, value) && stateNow().kind !== 'saving') setState({ kind: 'edited' })
    },
    closed(field) {
      // An editor gone after the next was opened in the same cell -- Tab back, an invalid save's -- leaves that one be.
      if (
        live()
          ?.getEditingCells()
          .some((cell) => cell.column?.getColId() === field) === true
      )
        return
      if (editing === field) editing = null
      refresh()
    },
  }
}
