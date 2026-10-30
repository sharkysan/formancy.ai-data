import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { createDataClient } from '@formancy/data-client'
import { audit, unnamed } from './test-accessible.js'
import { chooseForm, mount, signIn } from './test-host.js'
import type { User } from './test-host.js'
import { ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'

/*
 * A form that is its own child shown as a tree of its records (0110),
 * through the page, against the real server on both engines: the
 * employees, whose manager is another employee. The roots are those with
 * no manager; a record expanded lists the employees it manages; the arrows
 * walk it as a WAI-ARIA tree, and Enter opens a record as a grid row's
 * does.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ children: true })
})

afterAll(async () => {
  await plane?.close()
})

afterEach(cleanup)

const ARRIVES_WITHIN = { timeout: 15_000 }

/** A new employee's id, unique in this run: employees have no generated key. */
let employees = 900_000 + (Date.now() % 90_000)

/** An employee managed by `manager`, or by nobody, made beside the page: its token. */
async function employee(engine: Engine, name: string, manager: string | null): Promise<string> {
  employees += 1
  const as = createDataClient({ token: () => TOKENS.clerk, fetch: plane.fetch })
  const created = await as.create(engine.employees, { id: String(employees), name, employee: manager })
  if (!created.ok || created.value.record === null) throw new Error(`the employee was not created: ${created.ok ? 'no token' : created.message}`)
  return created.value.record
}

/** The page on the employees, their records shown as a tree. */
async function treeOpen(engine: Engine): Promise<{ user: User; tree: HTMLElement }> {
  const user = mount(plane.fetch)
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, engine.employees)
  await user.click(screen.getByRole('radio', { name: 'Tree' }))
  return { user, tree: await screen.findByRole('tree', { name: 'Records' }, ARRIVES_WITHIN) }
}

/** A tree item by its name. */
const item = (tree: HTMLElement, name: string): HTMLElement => within(tree).getByRole('treeitem', { name })

describe.each(ENGINES)('a tree of records on $engine', (engine) => {
  // The roots are the records with no manager -- Ada, and the one made
  // here -- and not Grace, whom Ada manages. The arrows walk it: Right
  // expands a record and lists those it manages, at the level below; Down
  // goes to the first of them; Left goes back up, and Left again collapses.
  // Enter opens a record in the detail, as a row does. Watched failing with
  // the roots asked for with no parent: every employee was a root, Grace
  // among them.
  test('lists the records with no parent, and those under a record as it is expanded', async () => {
    const boss = `Boss ${String(employees + 1)}`
    const manager = await employee(engine, boss, null)
    const first = await employee(engine, `${boss} first report`, manager)
    await employee(engine, `${boss} second report`, manager)
    const { user, tree } = await treeOpen(engine)

    await waitFor(() => expect(within(tree).queryByRole('treeitem', { name: boss })).not.toBeNull(), ARRIVES_WITHIN)
    const roots = within(tree)
      .getAllByRole('treeitem')
      .map((each) => [each.getAttribute('aria-level'), each.querySelector('.tree-name')?.textContent])
    expect(roots).toContainEqual(['1', 'Ada'])
    expect(roots.map(([, name]) => name)).not.toContain('Grace')
    expect(item(tree, boss).getAttribute('aria-expanded')).toBe('false')
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])

    item(tree, boss).focus()
    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(item(tree, boss).getAttribute('aria-expanded')).toBe('true'), ARRIVES_WITHIN)
    const below = within(item(tree, boss)).getAllByRole('treeitem')
    expect(below.map((each) => [each.getAttribute('aria-level'), each.querySelector('.tree-name')?.textContent])).toEqual([
      ['2', `${boss} first report`],
      ['2', `${boss} second report`],
    ])
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(item(tree, `${boss} first report`))
    await user.keyboard('{Enter}')
    await screen.findByRole('heading', { level: 3, name: `Employee ${first}` }, ARRIVES_WITHIN)

    item(tree, `${boss} first report`).focus()
    await user.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(item(tree, boss))
    await user.keyboard('{ArrowLeft}')
    expect(item(tree, boss).getAttribute('aria-expanded')).toBe('false')
    expect(within(item(tree, boss)).queryAllByRole('treeitem')).toEqual([])
  })

  // A record nobody names as their manager, expanded, has nothing below
  // it: the line says so, and it is a leaf from then on, with nothing to
  // expand. Watched failing with a leaf left expandable: aria-expanded
  // stayed.
  test('says a record manages nobody, and is a leaf from then on', async () => {
    const lone = `Lone ${String(employees + 1)}`
    await employee(engine, lone, null)
    const { user, tree } = await treeOpen(engine)
    await waitFor(() => expect(within(tree).queryByRole('treeitem', { name: lone })).not.toBeNull(), ARRIVES_WITHIN)
    item(tree, lone).focus()
    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(item(tree, lone).hasAttribute('aria-expanded')).toBe(false), ARRIVES_WITHIN)
    expect(within(screen.getByRole('region', { name: 'Records' })).getAllByRole('status').map((line) => line.textContent)).toContain(`No records name ${lone} as their Employee.`)
  })
})
