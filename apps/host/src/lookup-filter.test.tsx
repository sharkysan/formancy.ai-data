import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import type { ListFilterTerm, PublishedForm } from '@formancy/data-client'
import { audit, unnamed } from './test-accessible.js'
import { applyCondition, filterLine, listsApplied, listsSent } from './test-filter.js'
import { chooseForm, dataRows, gridSection, mount, recordKeys, signIn, stamp } from './test-host.js'
import type { User } from './test-host.js'
import { EDGES, ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'

/*
 * A lookup field's filter on the host page (0135), on both engines,
 * against the real server: the staff's Order form, whose Approved by is a
 * lookup over employees, filtered by the record picked in its column's
 * box, by the record's label typed in the filter line, by whether it
 * refers to one, and by `=` on a cell -- each sent as the record's token,
 * said in a chip by its label, and listing exactly the orders the server
 * lists for that filter. Every state is held to axe at WCAG 2.2 AA and to
 * a name on every control. Found by role and accessible name (formancy.ai
 * 0034).
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
const CLEAN = (state: string) => ({ state, axe: [], unnamed: [] })
const floor = async (state: string) => ({ state, axe: await audit(), unnamed: unnamed() })

async function definitionOf(formId: string): Promise<PublishedForm> {
  const definition = await plane.clerk.form(formId)
  if (!definition.ok) throw new Error(definition.message)
  return definition.value
}

/** Two fresh orders of tenant 1's noted `notes`: the first approved by Grace, employee 2, the second by nobody; their ids. */
async function approvedAndNot(engine: Engine, notes: string): Promise<[string, string]> {
  const definition = await definitionOf(engine.formId)
  const source = definition.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await plane.clerk.query(engine.formId, source, { operation: 'create', search: 'Muster' })
  if (!found.ok || found.value.rows[0] === undefined) throw new Error('no customer to order for')
  const ids: string[] = []
  for (const approved of [{ approved_by: '2' }, {}]) {
    const created = await plane.clerk.create(engine.formId, {
      customer: found.value.rows[0].token,
      order_date: EDGES.orderDate,
      status: 'placed',
      amount: '1',
      notes,
      ...approved,
    })
    if (!created.ok || created.value.record === null) throw new Error('the order was not created')
    ids.push(created.value.record.slice('k1:'.length))
  }
  return [ids[0] as string, ids[1] as string]
}

/** The staff's Order form chosen by tenant 1's clerk, narrowed to the orders noted `notes`: the user, and the Approved by field's key. */
async function staffOrders(engine: Engine, notes: string): Promise<{ user: User; field: string }> {
  const definition = await definitionOf(engine.staff)
  const field = definition.form.model.fields.find((entry) => (entry as { label?: unknown }).label === 'Approved by')?.key
  if (field === undefined) throw new Error('the staff form has no Approved by')
  const user = mount(plane.fetch)
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, engine.staff)
  await applyCondition(user, 'Records', { field: 'Notes', condition: 'contains', value: notes })
  return { user, field }
}

/** What the server lists for the staff's orders under `filter`, beside the page: each order's id. */
async function serverLists(engine: Engine, filter: ListFilterTerm[]): Promise<string[]> {
  const page = await plane.clerk.list(engine.staff, { filter })
  if (!page.ok) throw new Error(`the server refused the list: ${page.message}`)
  return page.value.rows.map((row) => String(row.answers['id']))
}

/** The filter the last list request for the staff's form carried. */
const lastFilter = (engine: Engine): ListFilterTerm[] | undefined => listsSent(plane.sent, engine.staff).at(-1)?.body.filter

describe.each(ENGINES)("a lookup field's filter on $engine", (engine) => {
  // The column's box searches the lookup and the record picked is the
  // condition, by its token: the page lists the orders the server lists
  // for it, and the chip says the record by its label (watched failing
  // with a lookup given no box: there was no "Filter Approved by").
  test('filters by the record picked in its column’s box, said by its label', async () => {
    const notes = stamp('picked')
    const [approved] = await approvedAndNot(engine, notes)
    const { user, field } = await staffOrders(engine, notes)
    const box = within(gridSection('Records')).getByRole('combobox', { name: 'Filter Approved by' })
    await user.type(box, 'Gra')
    await waitFor(
      () => expect(within(screen.getByRole('listbox', { name: 'Records of Approved by' })).getAllByRole('option').length).toBeGreaterThan(0),
      ARRIVES,
    )
    expect(await floor('a lookup’s records offered')).toEqual(CLEAN('a lookup’s records offered'))
    await user.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(recordKeys()).toEqual([approved]), ARRIVES)
    const sent = lastFilter(engine)
    expect(sent?.find((term) => term.field === field)).toEqual({ field, op: 'equals', value: 'k1:2' })
    expect(await serverLists(engine, sent ?? [])).toEqual([approved])
    await listsApplied('Records', [`Notes contains “${notes}”`, 'Approved by is “Grace”'])
    expect(box).toHaveProperty('value', 'Grace')
    expect(await floor('a lookup’s record applied')).toEqual(CLEAN('a lookup’s record applied'))
  })

  // The line names the record by the label the page shows for it, and
  // whether the field refers to one in the line's words; a label the page
  // has not shown is the line's refusal and sends nothing (watched failing
  // with the label sent as the value).
  test('filters by a record’s label in the line, or by none, and refuses a label it has not shown', async () => {
    const notes = stamp('lined')
    const [approved, unapproved] = await approvedAndNot(engine, notes)
    const { user, field } = await staffOrders(engine, notes)
    await waitFor(() => expect(recordKeys().sort()).toEqual([approved, unapproved].sort()), ARRIVES)
    const line = filterLine('Records')
    await user.click(line)
    await user.keyboard(`{End} and approved_by = grace{Enter}`)
    await waitFor(() => expect(recordKeys()).toEqual([approved]), ARRIVES)
    expect(lastFilter(engine)?.find((term) => term.field === field)).toEqual({ field, op: 'equals', value: 'k1:2' })
    expect(line.value).toContain('approved_by = Grace')

    await user.clear(line)
    await user.type(line, `notes contains "${notes}" and approved_by is empty{Enter}`)
    await waitFor(() => expect(recordKeys()).toEqual([unapproved]), ARRIVES)
    expect(await serverLists(engine, lastFilter(engine) ?? [])).toEqual([unapproved])

    plane.sent.length = 0
    await user.clear(line)
    await user.type(line, `approved_by = Linus{Enter}`)
    await waitFor(() =>
      expect(within(gridSection('Records')).getByText("No record of Approved by shown here is called Linus: pick one in its column's box.")).toBeTruthy(),
    )
    expect(listsSent(plane.sent, engine.staff)).toEqual([])
    expect(await floor('a lookup’s label refused')).toEqual(CLEAN('a lookup’s label refused'))
  })

  // `=` on a lookup's cell keeps the rows that refer to its record, by the
  // record's token, and the chip says the label the cell showed (watched
  // failing with a lookup's cell offering no example).
  test('filters by the record a cell shows, with =', async () => {
    const notes = stamp('example')
    const [approved] = await approvedAndNot(engine, notes)
    const { user, field } = await staffOrders(engine, notes)
    const grid = within(gridSection('Records')).getByRole('grid', { name: 'Records' })
    const cell = await waitFor(() => {
      const found = dataRows(grid)
        .flatMap((row) => within(row).getAllByRole('gridcell'))
        .find((each) => each.textContent === 'Grace')
      if (found === undefined) throw new Error('no cell shows Grace')
      return found
    }, ARRIVES)
    cell.focus()
    await user.keyboard('=')
    await waitFor(() => expect(recordKeys()).toEqual([approved]), ARRIVES)
    expect(lastFilter(engine)?.find((term) => term.field === field)).toEqual({ field, op: 'equals', value: 'k1:2' })
    await listsApplied('Records', [`Notes contains “${notes}”`, 'Approved by is “Grace”'])
  })
})
