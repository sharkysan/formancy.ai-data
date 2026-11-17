import { createDataClient } from '@formancy/data-client'
import type { DataClient, PublishedForm } from '@formancy/data-client'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { createSaveSet } from './save-set.js'
import type { TogetherForm } from './save-set.js'
import { createSession } from './session.js'
import { holdingWrites } from './test-network.js'
import type { Holding } from './test-network.js'
import { stamp } from './test-host.js'
import { ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'

/*
 * What a record's rows saved with it (0155) come to when the save that
 * creates the record is answered, through the session and the set alone,
 * against the real server: every row held for the new record is the
 * created one's, whether or not that save carried it.
 *
 * The page cannot reach it with the parity schema's order alone, whose one
 * together child requires a line, so every create carries one: a second
 * child of the set, the same line form under a field of its own and none
 * required, stands for a child the save took nothing of. Its rows are never
 * sent.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ saves: true })
})

afterAll(async () => {
  await plane?.close()
})

async function definition(client: DataClient, formId: string): Promise<PublishedForm> {
  const outcome = await client.form(formId)
  if (!outcome.ok) throw new Error(`the form did not open: ${outcome.message}`)
  return outcome.value
}

/** The order's lines as its menu names them: the child, the line form's entry and its definition. */
async function linesOf(client: DataClient, engine: Engine): Promise<TogetherForm> {
  const menu = await client.forms()
  if (!menu.ok) throw new Error(menu.message)
  const child = menu.value.forms.find((entry) => entry.id === engine.savedOrder)?.children.find((each) => each.form === engine.savedLines)
  const entry = menu.value.forms.find((each) => each.id === engine.savedLines)
  if (child?.together === undefined || entry === undefined) throw new Error('the order names no lines saved with it')
  return { child, menu: entry, definition: await definition(client, engine.savedLines) } as TogetherForm
}

async function writesHeld(holding: Holding, count: number): Promise<void> {
  await vi.waitFor(() => expect(holding.held).toHaveLength(count), { timeout: 15_000 })
}

describe.each(ENGINES)('the rows of a record its save created on $engine (0155)', (engine) => {
  // A row added, while the create was out, to a child that save took
  // nothing of is the created order's once it answers: its next save
  // carries it, and the guard names it with the order's rows, where it
  // would otherwise stay under no record, saved with none and asked about
  // as another pane's (watched failing with only the children the save
  // carried moved: the created order's owners named the lines alone).
  test('every row held for a new record is the created one’s, whether or not its save carried it', async () => {
    const holding = holdingWrites(plane.fetch)
    const client = createDataClient({ token: () => TOKENS.clerk, fetch: holding.fetch })
    const lines = await linesOf(client, engine)
    const other: TogetherForm = { ...lines, child: { ...lines.child, field: 'other', together: { ...lines.child.together, min: 0 } } }
    const saveSet = createSaveSet({ client, formId: engine.savedOrder, parentNoun: 'Order', forms: () => [lines, other] })
    const session = createSession({
      client,
      formId: engine.savedOrder,
      definition: await definition(client, engine.savedOrder),
      renderer: 'react',
      rows: saveSet.rows,
    })
    session.open()
    const held = saveSet.child(lines, 'lines', 'new')
    const others = saveSet.child(other, 'others', 'new')
    await saveSet.list(held)
    await saveSet.list(others)
    const row = saveSet.add(held)
    for (const draft of saveSet.drafts(held, row)) {
      draft.opened().engine.setValue(['line_no'], 1)
      draft.opened().engine.setValue(['quantity'], 2)
    }
    const { engine: order } = session.opened()
    order.setValue(['note'], stamp('created'))
    const saving = session.save({ ok: order.submit().ok, data: order.value() })
    await writesHeld(holding, 1)
    saveSet.add(others)
    expect(saveSet.rows.owners(undefined)).toEqual(['lines', 'others'])
    holding.answer()
    expect((await saving)?.kind).toBe('created')
    const token = session.state().record
    expect(token).toMatch(/^k1:\d+$/)
    expect(saveSet.rows.owners(token)).toEqual(['lines', 'others'])
    expect(saveSet.rows.carries(token)).toBe(true)
    expect(saveSet.rows.owners(undefined)).toEqual([])
  })
})
