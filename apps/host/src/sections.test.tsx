import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { audit, focusedName, unnamed } from './test-accessible.js'
import { chooseForm, chooseRenderer, load, loaded, mount, signIn, stamp } from './test-host.js'
import type { User } from './test-host.js'
import { ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'

/*
 * A child form that is a section of its parent's records (0109), through
 * the page, against the real server on both engines: a party's company
 * details, `parity.party_company`, whose key is its foreign key onto the
 * party's, generated as a section of the party shown while its kind is
 * `company`. Under a company party the record's one row of it is its own
 * form, or Add makes it; under a person there is none to show, until a
 * save makes the party a company.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ sections: true })
})

afterAll(async () => {
  await plane?.close()
})

afterEach(cleanup)

const ARRIVES_WITHIN = { timeout: 15_000 }
const SECTION = 'Company details'

/** A party of tenant 1's, made beside the page. */
async function freshParty({ party }: Engine, name: string, kind: 'company' | 'person'): Promise<string> {
  const created = await plane.clerk.create(party, { name, kind })
  if (!created.ok || created.value.record === null) throw new Error(`the party was not created: ${created.ok ? 'no token' : created.message}`)
  return created.value.record
}

/** The page signed in, on the party form, React alone, with `record` loaded. */
async function partyOpen(engine: Engine, record: string): Promise<User> {
  const user = mount(plane.fetch)
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, engine.party)
  await chooseRenderer(user, 'React')
  await load(user, record)
  await loaded(record, 'Party')
  return user
}

/** The section under the record, by its heading; null when it is not shown. */
const section = (): HTMLElement | null => screen.queryByRole('region', { name: SECTION })

/** The section's React paper: named for the row it holds, `New Company details` or `Company details <token>`, as a child row's is. */
const sectionPaper = (): HTMLElement => within(section() as HTMLElement).getByRole('form', { name: /, React$/ })

/** A control of the section's React paper, by its name. */
const sectionControl = (name: string): HTMLInputElement => within(sectionPaper()).getByLabelText(name, { exact: true }) as HTMLInputElement

/** A control of the party's own React paper, by its name. */
const partyControl = (name: string): HTMLInputElement => within(screen.getByRole('form', { name: 'Party, React' })).getByLabelText(name, { exact: true }) as HTMLInputElement

describe.each(ENGINES)('a section on $engine', (engine) => {
  // A company party's details: none yet, so the section says so and offers
  // Add, which opens a new row preset with the party, the keyboard on it; a
  // save creates the row under that party, and the party opened again holds
  // it in the section's own form, with no grid. Watched failing with the
  // section drawn as a child grid: its line never said the party had none.
  test('is the record’s one row in its own form, which Add creates', async () => {
    const name = stamp('company')
    const record = await freshParty(engine, name, 'company')
    const user = await partyOpen(engine, record)

    const shown = await screen.findByRole('region', { name: SECTION }, ARRIVES_WITHIN)
    await waitFor(() => expect(within(shown).getAllByRole('status')[0]?.textContent).toBe(`This Party has no ${SECTION} yet.`), ARRIVES_WITHIN)
    expect(within(shown).queryByRole('grid')).toBeNull()
    await user.click(within(shown).getByRole('button', { name: `Add ${SECTION}` }))
    await within(shown).findByRole('heading', { level: 5, name: `New ${SECTION}` }, ARRIVES_WITHIN)
    await waitFor(() => expect(focusedName()).toBe(`New ${SECTION}`))
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])

    await user.type(sectionControl('Vat no'), 'CHE-109.000.001')
    await user.click(within(sectionPaper()).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(within(shown).getAllByRole('status').map((line) => line.textContent)).toContain(`Created ${record}.`), ARRIVES_WITHIN)
    const rows = await plane.clerk.list(engine.company, { parent: { field: 'party', record } })
    expect(rows.ok && rows.value.rows.map((row) => [row.record, row.answers['vat_no']])).toEqual([[record, 'CHE-109.000.001']])

    cleanup()
    await partyOpen(engine, record)
    const again = await screen.findByRole('region', { name: SECTION }, ARRIVES_WITHIN)
    await within(again).findByRole('heading', { level: 5, name: `${SECTION} ${record}` }, ARRIVES_WITHIN)
    await waitFor(() => expect(sectionControl('Vat no').value).toBe('CHE-109.000.001'), ARRIVES_WITHIN)
    expect(within(again).queryByRole('button', { name: `Add ${SECTION}` })).toBeNull()
  })

  // Shown by the record as stored, never by what is typed: a person party
  // has no company details to show; its kind typed as company changes
  // nothing until the save stores it, and then the section is there.
  // Watched failing with the condition left unread: a person party showed
  // the section; and with the stored answers kept as read after a save:
  // the section never came.
  test('is shown while the record as stored holds the value, and once a save stores it', async () => {
    const record = await freshParty(engine, stamp('person'), 'person')
    const user = await partyOpen(engine, record)
    await waitFor(() => expect(partyControl('Kind').value).toBe('person'), ARRIVES_WITHIN)
    expect(section()).toBeNull()

    await user.clear(partyControl('Kind'))
    await user.type(partyControl('Kind'), 'company')
    expect(section()).toBeNull()
    await user.click(within(screen.getByRole('form', { name: 'Party, React' })).getByRole('button', { name: 'Save' }))
    const shown = await screen.findByRole('region', { name: SECTION }, ARRIVES_WITHIN)
    await waitFor(() => expect(within(shown).getAllByRole('status')[0]?.textContent).toBe(`This Party has no ${SECTION} yet.`), ARRIVES_WITHIN)
  })
})
