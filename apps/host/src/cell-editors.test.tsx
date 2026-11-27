import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { computeAccessibleDescription } from 'dom-accessibility-api'
import { userEvent } from '@testing-library/user-event'
import { AgGridReact } from 'ag-grid-react'
import { useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { createDataClient } from '@formancy/data-client'
import type { FormRecord, PublishedForm } from '@formancy/data-client'
import type { FormSchema } from '@formancy/spec'
import { useAfterRender } from './after-render.js'
import type { ArrangedColumn } from './columns.js'
import type { MasterOpen } from './detail.js'
import { CHECK_IT } from './grid-edit.js'
import type { GridRow } from './grid-datasource.js'
import { columnDefsOf, gridOptionsFor } from './grid-options.js'
import type { Said } from './leave.js'
import type { RecordGridHandle } from './record-grid.js'
import { createSession } from './session.js'
import { audit, focusedName, unnamed } from './test-accessible.js'
import { useGridEdit } from './use-grid-edit.js'

/*
 * The open record's cells edited in its row (0179), without a server: AG
 * Grid as the page configures it, the page's own edit over a real session
 * and its real engine, and two fake rows -- what jsdom can show of AG
 * Grid's editing: F2 opening an editor of the page's own in the open row,
 * named for its field and record and passing the accessibility floor;
 * what it types written into the engine and drawn in the row; Tab and
 * Shift+Tab among the row's editable cells; Escape giving a cell's edit
 * up; no key but F2 starting one; F2 where a cell is never edited saying
 * why, and on one the record's form edits going there; and what AG Grid's
 * live region says of a cell F2 edits. A save here is lost by the network
 * -- the client is given no server -- so it is unknown, which the row
 * says. What a save stores, and every other answer, is
 * grid-editing.test.tsx's against the real server on both engines.
 *
 * Found by role and accessible name. The reads the accessibility tree
 * cannot answer, said where they are made: a cell by the `col-id` AG Grid
 * writes on it, and a row by its Id cell's text, since the tree names a
 * cell by its value alone and a row by nothing (`cellOf`); and what AG
 * Grid's live region says of a row, from the element it says it in
 * (`rowSays`), which has no role or name.
 */

afterEach(cleanup)

/** A client whose every write the network loses: the grid's save is then unknown (0031). */
const client = createDataClient({
  token: () => 'unused',
  fetch: () => Promise.reject(new TypeError('Failed to fetch')),
})

const FIELDS = [
  { key: 'id', type: 'number', label: 'Id' },
  {
    key: 'status',
    type: 'select',
    label: 'Status',
    options: [
      { value: 'draft', label: 'Draft' },
      { value: 'placed', label: 'Placed' },
    ],
  },
  { key: 'amount', type: 'text', label: 'Amount', pattern: '^[0-9]+(\\.[0-9]{1,4})?$' },
  { key: 'notes', type: 'textarea', label: 'Notes' },
  { key: 'group', type: 'text', label: 'Group' },
] as const

const DEFINITION = {
  form: {
    specVersion: '5',
    id: 'orders',
    title: 'Order',
    model: { fields: FIELDS },
    // Id is written by the database, as the generator draws it.
    logic: { rules: [{ target: 'id', kind: 'disabled', cel: 'true' }] },
    layouts: [{ name: 'default', nodes: FIELDS.map((field) => ({ kind: 'field', path: field.key })) }],
  } as unknown as FormSchema,
  operations: ['read', 'update'],
  readable: FIELDS.map((field) => field.key),
  list: null,
  deleting: null,
  copied: null,
  versions: null,
  writable: { create: null, update: ['status', 'amount', 'notes', 'group'] },
  moves: null,
  opens: [],
  together: null,
  actions: [],
  bulk: { delete: false, update: null },
} as unknown as PublishedForm

const COLUMNS: ArrangedColumn[] = FIELDS.map((field) => ({ key: field.key, label: field.label, sortable: false, source: null, shown: true }))
const RECORDS: FormRecord[] = [
  { record: 'k1:1', version: '1', answers: { id: 1, status: 'draft', amount: '12.5000', notes: 'first', group: 'Online' } },
  { record: 'k1:2', version: '1', answers: { id: 2, status: 'placed', amount: '3.0000', notes: 'second', group: null } },
]
const ROWS: GridRow[] = RECORDS.map((each) => ({ id: each.record ?? '', record: each.record, version: each.version, answers: each.answers, labels: {} }))

const words = (said: Said): string => said.map((part) => (typeof part === 'string' ? part : part.code)).join('')

/** What the page around the grid was told: each sentence on the grid's line, and each time the record was shown. */
interface Told {
  line: string[]
  shown: number
}

/** The grid of the two rows, the first record open in a real session, the page's edit over it. */
function Grid({ told, session }: { told: Told; session: ReturnType<typeof createSession> }): ReactElement {
  const openRef = useRef<MasterOpen>({ kind: 'record', token: 'k1:1' })
  const handle = useRef<RecordGridHandle | null>({ tell: (said: Said) => void told.line.push(words(said)) } as unknown as RecordGridHandle)
  const after = useAfterRender()
  const edit = useGridEdit({
    client,
    formId: 'orders',
    definition: DEFINITION,
    title: 'Order',
    columns: COLUMNS,
    renderer: 'react',
    drilling: false,
    sessions: [session],
    openRef,
    openToken: 'k1:1',
    grid: handle,
    after,
    open: () => {},
    toRecord: () => {
      told.shown += 1
    },
  })
  const [options] = useState(() =>
    gridOptionsFor({
      labelledBy: 'records',
      firstColumn: () => 'id',
      on: {
        openToken: () => 'k1:1',
        ready: (api) => {
          edit.attach(api)
          setTimeout(() => api.getRowNode('k1:1')?.setSelected(true), 0)
        },
        resized: () => {},
        asked: () => {},
        drilling: () => false,
        sorted: () => {},
        widthsSet: () => {},
        example: () => {},
        edits: (row, colId) => {
          const how = edit.how(row, colId)
          return how.kind === 'never' ? null : how.kind
        },
        edit: (row, colId, rowIndex) => edit.start(row, colId, rowIndex),
        moved: (rowIndex) => edit.moved(rowIndex),
      },
    }),
  )
  // Made once, as record-grid.tsx makes them: a new datasource would list the rows again.
  const columnDefs = useMemo(() => columnDefsOf(COLUMNS, undefined, new Set(), [], new Map(), undefined, edit), [edit])
  const [datasource] = useState(() => ({
    getRows: (params: { successCallback: (rows: GridRow[], last: number) => void }) => params.successCallback(ROWS, ROWS.length),
  }))
  return (
    <main>
      <h3 id="records">Records</h3>
      <div style={{ width: 900, height: 300 }}>
        <AgGridReact<GridRow> gridOptions={options} columnDefs={columnDefs} datasource={datasource} />
      </div>
    </main>
  )
}

function mount(): { told: Told; session: ReturnType<typeof createSession> } {
  document.title = 'Records'
  document.documentElement.lang = 'en'
  const told: Told = { line: [], shown: 0 }
  const session = createSession({ client, formId: 'orders', definition: DEFINITION, renderer: 'react' })
  session.open(RECORDS[0])
  render(<Grid told={told} session={session} />)
  return { told, session }
}

const grid = (): HTMLElement => screen.getByRole('grid', { name: 'Records' })

/** The cell of `colId` in the row whose Id says `id`: by the `col-id` and the Id cell's text, said above. */
async function cellOf(id: string, colId: string): Promise<HTMLElement> {
  return waitFor(() => {
    const row = within(grid())
      .getAllByRole('row')
      .find((each) =>
        within(each)
          .queryAllByRole('gridcell')
          .some((cell) => cell.getAttribute('col-id') === 'id' && (cell.textContent ?? '').startsWith(id)),
      )
    const cell =
      row === undefined
        ? undefined
        : within(row)
            .queryAllByRole('gridcell')
            .find((each) => each.getAttribute('col-id') === colId)
    if (cell === undefined) throw new Error(`no cell ${colId} in row ${id}`)
    return cell
  })
}

/** What AG Grid's live region last said of a row: a DOM read, said above. */
const rowSays = (): string => (document.querySelector('.ag-aria-description-container')?.textContent ?? '').replaceAll('​', '')

const answersOf = (session: ReturnType<typeof createSession>): Record<string, unknown> => session.opened().engine.value() as Record<string, unknown>

describe('an editor in the open row, without a server (0179)', () => {
  // F2 is the one key that edits: an editor of the page's own takes the
  // keyboard, named for its field and record, and passes the floor. What it
  // types is the engine's at once, so the form beside it is the same draft.
  test('F2 opens a named editor whose typing is the engine’s, and the floor holds', async () => {
    const { session } = mount()
    const user = userEvent.setup()
    ;(await cellOf('1', 'group')).focus()
    await user.keyboard('{F2}')
    await waitFor(() => expect(focusedName()).toBe('Group, Order k1:1'))
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])
    await user.keyboard('{Control>}a{/Control}Shop')
    expect(answersOf(session)['group']).toBe('Shop')
  })

  // Tab and Shift+Tab move among the row's editable cells shown: past
  // Notes, which the form edits, never into it; and what was typed is kept
  // and drawn in its cell once its editor has gone.
  test('Tab and Shift+Tab move among the editable cells, and the row draws what was typed', async () => {
    const { session } = mount()
    const user = userEvent.setup()
    ;(await cellOf('1', 'group')).focus()
    await user.keyboard('{F2}')
    await waitFor(() => expect(focusedName()).toBe('Group, Order k1:1'))
    await user.keyboard('{Control>}a{/Control}Shop')
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    await waitFor(() => expect(focusedName()).toBe('Amount, Order k1:1'))
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    await waitFor(() => expect(focusedName()).toBe('Status, Order k1:1'))
    await user.keyboard('{Tab}')
    await waitFor(() => expect(focusedName()).toBe('Amount, Order k1:1'))
    await user.keyboard('{Tab}')
    await waitFor(() => expect(focusedName()).toBe('Group, Order k1:1'))
    expect((document.activeElement as HTMLInputElement).value).toBe('Shop')
    await user.keyboard('{Escape}')
    const groupCell = await cellOf('1', 'group')
    await waitFor(() => expect(document.activeElement).toBe(groupCell))
    expect((await cellOf('1', 'group')).textContent).toBe('Shop')
    expect(answersOf(session)['group']).toBe('Shop')
  })

  // Escape gives up that cell's typing alone: the cell is what it held when
  // the edit began, the keyboard on it, and the row's other changes kept.
  test('Escape puts the cell back and ends the edit, the keyboard on the cell', async () => {
    const { session } = mount()
    const user = userEvent.setup()
    ;(await cellOf('1', 'amount')).focus()
    await user.keyboard('{F2}')
    await waitFor(() => expect(focusedName()).toBe('Amount, Order k1:1'))
    await user.keyboard('{Control>}a{/Control}99')
    expect(answersOf(session)['amount']).toBe('99')
    await user.keyboard('{Escape}')
    const amountCell = await cellOf('1', 'amount')
    await waitFor(() => expect(document.activeElement).toBe(amountCell))
    expect(answersOf(session)['amount']).toBe('12.5000')
    expect(screen.queryByRole('textbox', { name: 'Amount, Order k1:1' })).toBeNull()
  })

  // Typing a character starts nothing -- `=` is the filter's (0133), and a
  // screen reader's quick keys would edit by accident -- nor do Delete and
  // Backspace clear a cell AG Grid would otherwise clear.
  test('no key but F2 starts an edit, and none clears a cell', async () => {
    const { session } = mount()
    const user = userEvent.setup()
    const cell = await cellOf('1', 'group')
    cell.focus()
    await user.keyboard('x{Delete}{Backspace}')
    expect(screen.queryByRole('textbox', { name: 'Group, Order k1:1' })).toBeNull()
    expect(cell.textContent).toBe('Online')
    expect(answersOf(session)['group']).toBe('Online')
  })

  // F2 on a cell never edited says why, in the words of the rule that drew
  // it so; on one the record's form edits, it shows the record and goes
  // there; on another row it asks the page to open that record first,
  // which this page does not, so nothing is edited.
  test('F2 says why where a cell is never edited, and goes to the form where the form edits it', async () => {
    const { told } = mount()
    const user = userEvent.setup()
    ;(await cellOf('1', 'id')).focus()
    await user.keyboard('{F2}')
    await waitFor(() => expect(told.line).toContain('Id is not written from this form.'))
    ;(await cellOf('1', 'notes')).focus()
    await user.keyboard('{F2}')
    await waitFor(() => expect(told.shown).toBe(1))
    ;(await cellOf('2', 'group')).focus()
    await user.keyboard('{F2}')
    expect(screen.queryByRole('textbox', { name: /^Group, / })).toBeNull()
  })

  // What AG Grid's live region says of a row as the keyboard reaches a cell:
  // that F2 edits it there, or in the record's form, or nothing where F2
  // edits nothing. Without it a screen reader user would not know the cell
  // can be edited at all.
  test('the row’s words say what F2 does on the cell', async () => {
    mount()
    const user = userEvent.setup()
    ;(await cellOf('2', 'group')).focus()
    await user.keyboard('{ArrowUp}')
    await waitFor(() => expect(rowSays()).toBe('This record is open. F2 edits it.'))
    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(rowSays()).toBe("This record is open. F2 edits it in the record's form."))
    await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}')
    await waitFor(() => expect(rowSays()).toBe('This record is open.'))
  })

  // Enter saves the row the grid edited and ends the edit; the network lost
  // the answer, so the save may have been stored: the row says so in its
  // first cell, the line how to check, and the keyboard stays on the cell.
  test('Enter saves the edited row, and a lost answer is said on the row and the line', async () => {
    const { told } = mount()
    const user = userEvent.setup()
    ;(await cellOf('1', 'group')).focus()
    await user.keyboard('{F2}')
    await waitFor(() => expect(focusedName()).toBe('Group, Order k1:1'))
    await user.keyboard('{Control>}a{/Control}Shop{Enter}')
    await waitFor(() => expect((told.line.at(-1) ?? '').endsWith(CHECK_IT)).toBe(true))
    expect(told.line).toContain('Saving Order k1:1…')
    await waitFor(async () => expect((await cellOf('1', 'id')).textContent).toBe('1May have been saved'))
    expect(document.activeElement).toBe(await cellOf('1', 'group'))
  })

  // An engine's refusal sends nothing: the first invalid cell shown takes
  // the keyboard in its editor, invalid and described by the form's own
  // sentence, and the line names it.
  test('a submit the engine refuses puts the keyboard on the invalid cell, described', async () => {
    const { told } = mount()
    const user = userEvent.setup()
    ;(await cellOf('1', 'amount')).focus()
    await user.keyboard('{F2}')
    await waitFor(() => expect(focusedName()).toBe('Amount, Order k1:1'))
    await user.keyboard('{Control>}a{/Control}abc{Enter}')
    await waitFor(() => expect(told.line).toContain('Not saved: Amount is to fix.'))
    await waitFor(() => expect(focusedName()).toBe('Amount, Order k1:1'))
    const editor = document.activeElement as HTMLElement
    expect(editor.getAttribute('aria-invalid')).toBe('true')
    expect(computeAccessibleDescription(editor)).not.toBe('')
    expect(await audit()).toEqual([])
  })
})
