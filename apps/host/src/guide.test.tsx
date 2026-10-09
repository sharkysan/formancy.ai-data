import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import journey from '../../../scripts/getting-started/journey.json'
import { HOST } from '../../../scripts/getting-started/walk.mjs'
import type { Journey } from '../../../scripts/getting-started/walk.mjs'
import { answer, mount, paper, rendered, said, shows } from './test-host.js'
import type { RendererName, User } from './test-host.js'
import { ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * docs/getting-started.md's section 5, done on the host page by the names the
 * guide gives the controls and the messages (0032): HOST in
 * scripts/getting-started/walk.mjs, and the fields, values and customer of
 * journey.json -- the same names the guide's table is written from and
 * steps.test.mjs holds its prose to. A control or a message renamed on the
 * page, its own tests renamed with it, fails this file until the guide says
 * the new name too.
 *
 * Against the real server on both engines, as the journey test is. One
 * renderer per engine, React on one and Angular on the other: the guide says
 * "use either", so both must have every name, and the journey test already
 * runs each renderer on each engine. What the plane cannot show is the
 * composed stack's row-level security, which hides tenant 2's customers from
 * the order form's own account; the gate holds that over HTTP.
 */

const GUIDE = journey as Journey

let plane: Plane

beforeAll(async () => {
  plane = await startPlane()
})

afterAll(async () => {
  await plane?.close()
})

afterEach(cleanup)

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The guide's sign-in: a token, a form id, and Open the form. */
async function open(user: User, token: string, formId: string): Promise<void> {
  await user.type(screen.getByLabelText(HOST.token), token)
  await user.type(screen.getByLabelText(HOST.formId), formId)
  await user.click(screen.getByRole('button', { name: HOST.open }))
  await rendered()
}

async function save(user: User, renderer: RendererName): Promise<void> {
  await user.click(within(paper(renderer)).getByRole('button', { name: HOST.save }))
}

const PAIRS: ReadonlyArray<{ engine: (typeof ENGINES)[number]; renderer: RendererName }> = [
  { engine: ENGINES[0], renderer: 'React' },
  { engine: ENGINES[1], renderer: 'Angular' },
]

describe("the guide's section 5", () => {
  // The guide sends an operator to these controls by these names, and tells
  // them which message means it worked. A page that renamed one would leave
  // the guide pointing at a button that is not there, or promising a message
  // the page never says; and the order tenant 2's clerk cannot load is the
  // guide's proof that the row filter holds.
  test.each(PAIRS)("is every control and message the host page has, by the guide's names: $engine.formId in $renderer", async ({ engine, renderer }) => {
    const form = GUIDE.forms.find((candidate) => candidate.connection === engine.connection)
    expect(form?.formId, `journey.json's form on ${engine.connection}`).toBe(engine.formId)
    const user = mount(plane.fetch)
    await open(user, TOKENS.clerk, engine.formId)
    await user.click(screen.getByRole('button', { name: HOST.newRecord }))

    const { customer, create, update } = GUIDE.order
    const box = within(paper(renderer)).getByRole('combobox', { name: customer.label })
    await user.type(box, customer.search)
    await user.click(await within(paper(renderer)).findByRole('option', { name: customer.choose }, { timeout: 15_000 }))
    for (const entry of create) await answer(user, renderer, entry.label, entry.value)
    await save(user, renderer)
    const created = await said(renderer, new RegExp(`^${escape(HOST.created)} (\\S+)\\.$`))
    const record = created.slice(HOST.created.length + 1, -1)
    for (const entry of create) if (entry.stored !== undefined) await shows(renderer, entry.label, entry.stored)

    await answer(user, renderer, update.label, update.value)
    await save(user, renderer)
    await said(renderer, new RegExp(`^${escape(HOST.saved)}$`))

    // Another tenant's clerk, as the guide has otto do it.
    await user.click(screen.getByRole('button', { name: HOST.signOut }))
    await open(user, TOKENS.otherClerk, engine.formId)
    await user.type(screen.getByRole('textbox', { name: HOST.record }), record)
    await user.click(screen.getByRole('button', { name: HOST.load }))
    expect((await screen.findByRole('alert')).textContent).toBe(HOST.notFound)
  })
})
