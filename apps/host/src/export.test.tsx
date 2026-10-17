import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { computeAccessibleDescription } from 'dom-accessibility-api'
import type { PublishedForm, RecordExportQuery } from '@formancy/data-client'
import { focusedName } from './test-accessible.js'
import { answeredOnce, chooseForm, exportButton, exportLine, formLink, gridSection, gridStatus, keeping, load, loaded, mount, newRecord, searchRecords, signIn, stamp } from './test-host.js'
import type { User } from './test-host.js'
import { EDGES, ENGINES, holdingRequests, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane, Sent } from './test-plane.js'

/*
 * Download CSV on the host page (0080), on both engines, against the real
 * server: where it is offered, what it sends, what its line says while the
 * file is made, once it is, and when it is refused, and what becomes of a
 * file in the making when the person leaves. The export route itself --
 * its pages, bounds and refusals -- is data-server's to hold (0079); what is
 * held here is the page's half: that the file a person gets is the server's,
 * of the records the grid shows them.
 *
 * Found by role and accessible name (formancy.ai 0034). jsdom has no
 * `URL.createObjectURL`, so the file is taken where the page hands it to the
 * browser, through `mount`'s `save`; the browser's own download, an object
 * URL and an anchor, is the browser gate's (scripts/browser/exporting.mjs)
 * and save-file.test.ts's.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ children: true })
})

afterAll(async () => {
  await plane?.close()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

const ARRIVES = { timeout: 15_000 }

/** The file's records, RFC 4180 as the server writes them (0079): each a list of its cells. The byte-order mark is the caller's to check. */
function records(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let at = text.startsWith('﻿') ? 1 : 0; at < text.length; at += 1) {
    const char = text[at]
    if (quoted && char === '"' && text[at + 1] === '"') {
      cell += '"'
      at += 1
    } else if (char === '"') quoted = !quoted
    else if (quoted || (char !== ',' && char !== '\r')) cell += char
    else if (char === ',') {
      row.push(cell)
      cell = ''
    } else {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      at += 1
    }
  }
  return rows
}

/** A file's bytes, as numbers, so two files compare whole and a difference says where. */
async function bytesOf(file: Blob): Promise<number[]> {
  return [...new Uint8Array(await file.arrayBuffer())]
}

/** What the page sent to the export route, in order. */
const exportsSent = (sent: readonly Sent[], formId: string): Sent[] => sent.filter((request) => request.method === 'POST' && request.path === `/v1/forms/${formId}/records/export`)

/** The file the server makes for `query`, asked by tenant 1's clerk beside the page. */
async function serversFile(formId: string, query: Partial<RecordExportQuery>): Promise<{ bytes: number[]; name: string }> {
  const file = await plane.clerk.exportRecords(formId, query)
  if (!file.ok) throw new Error(`the server refused the file: ${file.message}`)
  return { bytes: await bytesOf(file.value.file), name: file.value.name }
}

async function definitionOf(formId: string): Promise<PublishedForm> {
  const definition = await plane.clerk.form(formId)
  if (!definition.ok) throw new Error(definition.message)
  return definition.value
}

/**
 * The header row the file must have for the grid's own headers: each of them,
 * and after a lookup's the column of its key -- the server's rule (0079),
 * written from what the grid draws rather than from the definition, so the
 * two cannot drift apart unseen.
 */
function headerFor(gridHeaders: readonly string[], definition: PublishedForm): string[] {
  const lookups = new Set(definition.form.model.fields.filter((field) => typeof (field as { optionsSource?: unknown }).optionsSource === 'string').map((field) => String(field.label ?? field.key)))
  return gridHeaders.flatMap((header) => (lookups.has(header) ? [header, `${header} (key)`] : [header]))
}

/** The column headers the grid in the section `heading` names draws, in order. */
function gridHeaders(heading: string): string[] {
  const grid = within(gridSection(heading)).getByRole('grid', { name: heading })
  return within(grid)
    .getAllByRole('columnheader')
    .map((header) => header.textContent?.trim() ?? '')
}

/** The first cell of every data row of the grid in the section `heading` names. */
function firstCells(heading: string): string[] {
  const grid = within(gridSection(heading)).getByRole('grid', { name: heading })
  return within(grid)
    .getAllByRole('row')
    .flatMap((row) => within(row).queryAllByRole('gridcell').slice(0, 1))
    .map((cell) => cell.textContent ?? '')
}

/** A fresh order of tenant 1's noted `notes`, with lines numbered `lines`, made beside the page: its token. */
async function freshOrder(engine: Engine, notes: string, lines: readonly number[] = []): Promise<string> {
  const definition = await definitionOf(engine.formId)
  const source = definition.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await plane.clerk.query(engine.formId, source, { operation: 'create', search: 'Muster' })
  if (!found.ok || found.value.rows[0] === undefined) throw new Error('no customer to order for')
  const created = await plane.clerk.create(engine.formId, { customer: found.value.rows[0].token, order_date: EDGES.orderDate, status: 'placed', amount: '1', notes })
  if (!created.ok || created.value.record === null) throw new Error('the order was not created')
  for (const no of lines) {
    const line = await plane.clerk.create(engine.lines, { order: created.value.record, line_no: String(no), quantity: String(no), unit_price: '2.50' })
    if (!line.ok) throw new Error(`line ${String(no)} was not created: ${line.message}`)
  }
  return created.value.record
}

/** The page given `fetch`, signed in as tenant 1's clerk, `formId` chosen and its grid answered. */
async function workspace(fetch: typeof globalThis.fetch, formId: string, save = keeping().save): Promise<User> {
  const user = mount(fetch, { save })
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, formId)
  return user
}

/** Download CSV pressed from the keyboard, as a person who tabbed to it does: focused, then Enter. */
async function pressFromKeyboard(user: User, heading: string, key = '{Enter}'): Promise<void> {
  exportButton(heading).focus()
  await user.keyboard(key)
}

describe.each(ENGINES)('Download CSV on $engine', (engine) => {
  const made = (formId: string): string => `Made ${formId}.csv; your browser saves it.`

  // One press, one request: the search the grid lists, never what the box
  // holds now, and the grid's sort, the last its datasource asked with. The
  // file is the server's, byte for byte, under the form's name, and its
  // header is the grid's headers with each lookup's key after it (watched
  // failing with the box's text sent: "search": "<stamp> typed"; with the
  // sort left out: "sort": []; and with Notes left out of the grid's
  // columns: the file's header held a Notes the grid did not).
  test("sends the search as submitted and the grid's sort, once, and saves the server's file, headed as the grid is", async () => {
    const notes = stamp('export')
    const orders = [await freshOrder(engine, notes), await freshOrder(engine, notes), await freshOrder(engine, notes)].map((token) => token.slice(3))
    const kept = keeping()
    const user = await workspace(plane.fetch, engine.formId, kept.save)
    await searchRecords(user, notes, orders)
    // Read before the sort: a sorted header's text holds its sort's number too, which jsdom, applying no CSS, does not hide.
    const headers = gridHeaders('Records')
    // Id descending, from the keyboard: a cell of the column, up to its header, Enter twice.
    const grid = within(gridSection('Records')).getByRole('grid', { name: 'Records' })
    await user.click(within(grid).getAllByRole('gridcell')[0] as HTMLElement)
    await user.keyboard('{ArrowUp}{Enter}{Enter}')
    await waitFor(() => expect(within(grid).getByRole('columnheader', { name: /^Id/ }).getAttribute('aria-sort')).toBe('descending'), ARRIVES)
    await waitFor(() => expect(firstCells('Records')).toEqual([...orders].reverse()), ARRIVES)
    // Typed and not submitted: not what the grid lists.
    await user.type(within(screen.getByRole('search', { name: 'Search records' })).getByRole('textbox', { name: 'Search' }), ' typed')
    plane.sent.length = 0

    await pressFromKeyboard(user, 'Records')
    await waitFor(() => expect(exportLine('Records').textContent).toBe(made(engine.formId)), ARRIVES)
    expect(focusedName()).toBe('Download CSV')
    const sent = exportsSent(plane.sent, engine.formId)
    expect(sent.map((request) => JSON.parse(request.body ?? '{}') as unknown)).toEqual([{ search: notes, sort: [{ field: 'id', direction: 'desc' }], parent: null }])
    expect(kept.saved).toHaveLength(1)
    const [saved] = kept.saved
    if (saved === undefined) throw new Error('nothing was saved')
    const server = await serversFile(engine.formId, { search: notes, sort: [{ field: 'id', direction: 'desc' }] })
    expect({ name: saved.name, bytes: await bytesOf(saved.file) }).toEqual({ name: `${engine.formId}.csv`, bytes: server.bytes })
    expect(server.bytes.slice(0, 3)).toEqual([0xef, 0xbb, 0xbf])
    const [header, ...rows] = records(await saved.file.text())
    expect(header).toEqual(headerFor(headers, await definitionOf(engine.formId)))
    expect(rows.map((cells) => cells[0])).toEqual([...orders].reverse())
  })

  // While the file is made the button stays where the keyboard is, says it
  // is busy with aria-disabled -- never `disabled`, which drops the focus
  // (0029) -- and is described by its line; Enter, Space and a click on it
  // then send nothing (watched failing with the press unguarded: four
  // requests for one file; and with `disabled` for aria-disabled: no
  // aria-disabled at all).
  test('is aria-disabled while the file is made, says so, keeps the keyboard, and sends nothing more when pressed again', async () => {
    let asked = 0
    const held = holdingRequests(plane.fetch, ({ path }) => path.endsWith('/records/export'))
    const fetch: typeof globalThis.fetch = (input, init) => {
      if (new URL(input instanceof Request ? input.url : String(input), 'http://host.test').pathname.endsWith('/records/export')) asked += 1
      return held.fetch(input, init)
    }
    const kept = keeping()
    const user = await workspace(fetch, engine.formId, kept.save)
    await pressFromKeyboard(user, 'Records')
    await waitFor(() => expect(held.held).toHaveLength(1), ARRIVES)
    const button = exportButton('Records')
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.hasAttribute('disabled')).toBe(false)
    expect(exportLine('Records').textContent).toBe(`Making ${engine.formId}.csv.`)
    expect(computeAccessibleDescription(button)).toBe(`Making ${engine.formId}.csv.`)
    expect(focusedName()).toBe('Download CSV')

    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    await user.click(button)
    expect(asked).toBe(1)
    await held.pass()
    await waitFor(() => expect(exportLine('Records').textContent).toBe(made(engine.formId)), ARRIVES)
    expect(exportButton('Records').getAttribute('aria-disabled')).toBeNull()
    expect(kept.saved).toHaveLength(1)
    expect(asked).toBe(1)
  })

  // A refusal is the server's own sentence on the line, nothing saved; the
  // button is pressable again at once, and pressing it is the retry, which
  // makes the file once the database answers (watched failing with the
  // refusal's code shown for its sentence: "unavailable").
  test("says a refusal in the server's words, and pressing again is the retry", async () => {
    const kept = keeping()
    const user = await workspace(plane.fetch, engine.formId, kept.save)
    plane.unreachable.add(engine.connection)
    let sentence: string
    try {
      const refused = await plane.clerk.exportRecords(engine.formId)
      if (refused.ok) throw new Error('the export was not refused')
      sentence = refused.message
      await pressFromKeyboard(user, 'Records')
      await waitFor(() => expect(exportLine('Records').textContent).toBe(sentence), ARRIVES)
    } finally {
      plane.unreachable.delete(engine.connection)
    }
    expect(sentence).toBe('The database cannot be reached. Nothing was saved.')
    expect(kept.saved).toEqual([])
    expect(exportButton('Records').getAttribute('aria-disabled')).toBeNull()
    await pressFromKeyboard(user, 'Records', ' ')
    await waitFor(() => expect(exportLine('Records').textContent).toBe(made(engine.formId)), ARRIVES)
    expect(kept.saved.map((file) => file.name)).toEqual([`${engine.formId}.csv`])
  })

  // A file in the making is the form's: choosing another form, or signing
  // out, stops it -- the request's signal aborted -- and says nothing
  // anywhere, and the file that would have arrived is never saved (watched
  // failing with nothing aborted when the section leaves: the export's
  // signal still live once the lines' form was open).
  test('stops a file in the making when the person leaves the form or signs out, and says nothing', async () => {
    const signals: AbortSignal[] = []
    const held = holdingRequests(plane.fetch, ({ path }) => path.endsWith('/records/export'))
    const fetch: typeof globalThis.fetch = (input, init) => {
      if (init?.signal != null && new URL(input instanceof Request ? input.url : String(input), 'http://host.test').pathname.endsWith('/records/export')) signals.push(init.signal)
      return held.fetch(input, init)
    }
    const kept = keeping()
    const user = await workspace(fetch, engine.formId, kept.save)
    await pressFromKeyboard(user, 'Records')
    await waitFor(() => expect(held.held).toHaveLength(1), ARRIVES)
    await user.click(await formLink(engine.lines))
    await screen.findByRole('heading', { level: 2, name: new RegExp(` ${engine.lines}$`) }, ARRIVES)
    expect(signals.map((signal) => signal.aborted)).toEqual([true])
    await held.pass()
    await answeredOnce('Records')
    expect(exportLine('Records').textContent).toBe('')
    expect(screen.queryByRole('alert')).toBeNull()

    await pressFromKeyboard(user, 'Records')
    await waitFor(() => expect(held.held).toHaveLength(1), ARRIVES)
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Forms' })).toBeNull())
    expect(signals.map((signal) => signal.aborted)).toEqual([true, true])
    await held.pass()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(kept.saved).toEqual([])
  })

  // A child section's file is its parent's rows, in its grid's order: the
  // parent travels, the search is none, the sort is the one the grid last
  // asked with, and the file -- the child form's, whole -- keeps the
  // parent's column the grid leaves out, so it says whose rows they are
  // (watched failing with the parent left out of the request: "parent":
  // null; with the section's sort left out: "sort": []; and with the grid's
  // columns in reverse: the file's header no longer the grid's).
  test("in a child section, sends the parent and the grid's sort, and saves that parent's rows in that order, the parent's column kept", async () => {
    const order = await freshOrder(engine, stamp('lines'), [1, 2, 3])
    const kept = keeping()
    const user = await workspace(plane.fetch, engine.formId, kept.save)
    await load(user, order)
    await waitFor(() => expect(within(gridSection('Order line')).queryByRole('grid', { name: 'Order line' })).not.toBeNull(), ARRIVES)
    expect(await answeredOnce('Order line')).toBe('Order line rows 1–3.')
    // Read before the sort, for the Records case's reason.
    const headers = gridHeaders('Order line')
    // Line no descending, from the keyboard, as the Records case sorts Id: a cell of the column, up to its header, Enter twice.
    const grid = within(gridSection('Order line')).getByRole('grid', { name: 'Order line' })
    await user.click(within(grid).getAllByRole('gridcell')[0] as HTMLElement)
    await user.keyboard('{ArrowUp}{Enter}{Enter}')
    await waitFor(() => expect(within(grid).getByRole('columnheader', { name: /^Line no/ }).getAttribute('aria-sort')).toBe('descending'), ARRIVES)
    await waitFor(() => expect(firstCells('Order line')).toEqual(['3', '2', '1']), ARRIVES)
    plane.sent.length = 0
    await pressFromKeyboard(user, 'Order line')
    await waitFor(() => expect(exportLine('Order line').textContent).toBe(made(engine.lines)), ARRIVES)
    const parent = { field: 'order', record: order }
    const sort = [{ field: 'line_no', direction: 'desc' as const }]
    expect(exportsSent(plane.sent, engine.lines).map((request) => JSON.parse(request.body ?? '{}') as unknown)).toEqual([{ search: '', sort, parent }])
    const [saved] = kept.saved
    if (saved === undefined) throw new Error('nothing was saved')
    expect({ name: saved.name, bytes: await bytesOf(saved.file) }).toEqual({ name: `${engine.lines}.csv`, bytes: (await serversFile(engine.lines, { parent, sort })).bytes })
    const definition = await definitionOf(engine.lines)
    const [header, ...rows] = records(await saved.file.text())
    const label = String(definition.form.model.fields.find((field) => field.key === 'order')?.label)
    expect(header?.filter((cell) => cell !== label && cell !== `${label} (key)`)).toEqual(headerFor(headers, definition))
    expect(rows.map((cells) => cells[(header ?? []).indexOf(`${label} (key)`)])).toEqual([order, order, order])
    expect(rows.map((cells) => cells[(header ?? []).indexOf('Line no')])).toEqual(['3', '2', '1'])
    // The record's own Download CSV, in the Records panel, is a button of its own.
    expect(exportLine('Records').textContent).toBe('')
  })

  // A line's file in the making is its order's: opening another order
  // mounts the section again, for that order, which stops the file -- the
  // request's signal aborted -- says nothing on the new section's line, and
  // saves nothing (watched failing with the order left out of the section's
  // key: the signal still live once the other order's lines were listed).
  test("stops a line's file in the making when another order is opened, and says nothing", async () => {
    const notes = stamp('parents')
    const [first, second] = [await freshOrder(engine, notes, [1, 2]), await freshOrder(engine, notes, [1, 2, 3])]
    const signals: AbortSignal[] = []
    const held = holdingRequests(plane.fetch, ({ path }) => path.endsWith('/records/export'))
    const fetch: typeof globalThis.fetch = (input, init) => {
      if (init?.signal != null && new URL(input instanceof Request ? input.url : String(input), 'http://host.test').pathname.endsWith('/records/export')) signals.push(init.signal)
      return held.fetch(input, init)
    }
    const kept = keeping()
    const user = await workspace(fetch, engine.formId, kept.save)
    await load(user, first)
    await waitFor(() => expect(gridStatus('Order line')?.textContent).toBe('Order line rows 1–2.'), ARRIVES)
    await pressFromKeyboard(user, 'Order line')
    await waitFor(() => expect(held.held).toHaveLength(1), ARRIVES)

    await load(user, second)
    await waitFor(() => expect(gridStatus('Order line')?.textContent).toBe('Order line rows 1–3.'), ARRIVES)
    expect(signals.map((signal) => signal.aborted)).toEqual([true])
    await held.pass()
    expect(exportLine('Order line').textContent).toBe('')
    expect(exportButton('Order line').getAttribute('aria-disabled')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(kept.saved).toEqual([])
  })

  // Offered exactly where the definition says a list can be read: in the
  // Records panel and in each child section with a saved parent -- a new
  // record's section has no rows to give -- and nowhere once the form's
  // version hides its key from the person, so `list` is null: not in the
  // Records panel, and not under an order whose lines' form did so after
  // the menu named it, whose section the workspace leaves out when the
  // order form is chosen (watched failing with the Records panel's button
  // drawn whatever `list` says: a Download CSV where nothing can be
  // listed; and with the workspace keeping a child whose `list` is null:
  // an Order line section under the order, and its Download CSV). Last of
  // its engine's cases: it publishes version 2 of the lines' form and of
  // the order form.
  test('is offered exactly where the definition lists records', async () => {
    expect((await definitionOf(engine.formId)).list).not.toBeNull()
    const user = await workspace(plane.fetch, engine.formId)
    expect(exportButton('Records')).toBeTruthy()
    await newRecord(user)
    const waiting = await waitFor(() => gridSection('Order line'), ARRIVES)
    expect(within(waiting).queryByRole('button', { name: 'Download CSV' })).toBeNull()
    expect(within(waiting).getByRole('status').textContent).toBe('Order line rows are listed once this Order is saved.')
    cleanup()

    // The menu is read at sign-in, naming Order line under Order; the lines' form then hides Line no, half its key.
    // Arriving on no form: with the fragment the first mount left, sign-in would open the order form, its children read, before the publish.
    window.history.replaceState(null, '', '/')
    const order = await freshOrder(engine, stamp('unlisted'), [1])
    const reader = mount(plane.fetch)
    await signIn(reader, TOKENS.clerk)
    await formLink(engine.formId)
    const menu = await plane.clerk.forms()
    expect(menu.ok && menu.value.forms.find((form) => form.id === engine.formId)?.children).toContainEqual({ form: engine.lines, field: 'order' })
    const lines = (await plane.store.read(engine.lines, 1)) as { policy: { fields: Record<string, { read: string[] }> } }
    const lineNo = lines.policy.fields['line_no']
    if (lineNo === undefined) throw new Error('the lines form has no line_no field')
    lineNo.read = []
    expect(await plane.store.publish(engine.lines, 1, lines)).toEqual({ ok: true, version: 2 })
    expect((await definitionOf(engine.lines)).list).toBeNull()
    await chooseForm(reader, engine.formId)
    await load(reader, order)
    await loaded(order)
    expect(screen.queryByRole('region', { name: 'Order line' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Download CSV' })).toEqual([exportButton('Records')])
    cleanup()

    const stored = (await plane.store.read(engine.formId, 1)) as { policy: { fields: Record<string, { read: string[] }> } }
    const id = stored.policy.fields['id']
    if (id === undefined) throw new Error('the order form has no id field')
    id.read = []
    expect(await plane.store.publish(engine.formId, 1, stored)).toEqual({ ok: true, version: 2 })
    expect((await definitionOf(engine.formId)).list).toBeNull()
    await workspace(plane.fetch, engine.formId)
    expect(within(gridSection('Records')).queryByRole('button', { name: 'Download CSV' })).toBeNull()
    expect(within(gridSection('Records')).queryByRole('status', { name: 'Download CSV' })).toBeNull()
  })
})
