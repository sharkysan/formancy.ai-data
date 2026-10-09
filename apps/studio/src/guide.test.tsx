import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import journey from '../../../scripts/getting-started/journey.json'
import { STUDIO, stepTitle, studioWalk } from '../../../scripts/getting-started/walk.mjs'
import type { Journey, WalkRow } from '../../../scripts/getting-started/walk.mjs'
import { mount, servedDocument } from './test-studio.js'
import type { User } from './test-studio.js'
import { TOKENS, startPlane } from './test-server.js'
import type { TestPlane } from './test-server.js'

/*
 * docs/getting-started.md's section 4, done in the studio by the names the
 * guide gives the controls (0032). The guide's table is written from the same
 * rows (scripts/getting-started/walk.mjs), and steps.test.mjs holds the
 * guide's prose to the same names, so a control renamed here -- its own tests
 * renamed with it -- fails this file until the guide says the new name too.
 *
 * Against the real server behind the studio's test plane, as the journey test
 * is. The plane's connections stand in for the composed stack's: PostgreSQL
 * as the order form's own account, which is how `pg` connects, and SQL
 * Server's fixture with its rowversion, which is what `ms` offers. The gate
 * (scripts/getting-started.mjs) proves the composed stack answers the same
 * requests over HTTP; this proves the studio has the controls the guide
 * sends the operator to.
 */

const GUIDE = journey as Journey

/** The plane's connection for each of the guide's. */
const ON_PLANE: Readonly<Record<string, string>> = { pg: 'fixture-writer', ms: 'fixture-sqlserver' }

let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane()
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

/** The step on screen: the one main landmark. */
const here = (): HTMLElement => screen.getByRole('main')

/** The step a row starts on, through the Steps list unless it is on screen already -- after Choose a root, say. */
async function open(user: User, step: string): Promise<void> {
  if (screen.queryByRole('main', { name: stepTitle(step) }) !== null) return
  await user.click(within(screen.getByRole('navigation', { name: STUDIO.steps })).getByRole('button', { name: step }))
  screen.getByRole('main', { name: stepTitle(step) })
}

/** The rule pairs a group of row-filter rules holds, as the studio shows them. */
function rulesIn(group: HTMLElement): Array<{ column: string; attribute: string }> {
  const columns = within(group).getAllByRole('combobox', { name: /^Column/ }) as HTMLSelectElement[]
  const attributes = within(group).getAllByRole('textbox', { name: /^Trusted attribute/ }) as HTMLInputElement[]
  return columns.map((column, index) => ({ column: column.value, attribute: attributes[index]?.value ?? '' }))
}

/** One row of the guide's table, done as the guide says. */
async function perform(user: User, { step, control, action }: WalkRow): Promise<void> {
  if (step !== undefined) await open(user, step)
  switch (action.kind) {
    case 'discover': {
      await user.click(within(within(here()).getByRole('group', { name: action.group })).getByRole('button', { name: action.button }))
      await within(here()).findByRole('region', { name: action.seen })
      return
    }
    case 'press': {
      // Found, not got: the Publish step names its button only once it has read which version is published.
      await user.click(await within(here()).findByRole('button', { name: control }))
      if (action.opens !== undefined) {
        const opened = await screen.findByRole('main', { name: stepTitle(action.opens) })
        if (action.shows !== undefined) within(opened).getByRole('region', { name: action.shows })
      }
      if (action.says !== undefined) await within(here()).findByText(action.says)
      return
    }
    case 'select':
      await user.selectOptions(within(here()).getByLabelText(control), action.value)
      return
    case 'type': {
      const box = within(here()).getByLabelText(control)
      await user.clear(box)
      await user.type(box, action.value)
      return
    }
    case 'tick': {
      const box = within(here()).getByRole('checkbox', { name: control }) as HTMLInputElement
      if (!box.checked) await user.click(box)
      expect(box.checked).toBe(true)
      if (action.keep !== undefined) {
        const group = within(here()).getByRole('group', { name: action.keep.group })
        for (const name of action.keep.ticked) expect((within(group).getByRole('checkbox', { name }) as HTMLInputElement).checked, `${name} under ${action.keep.group}`).toBe(true)
      }
      if (action.holds !== undefined) expect((within(here()).getByLabelText(action.holds.name) as HTMLInputElement).value).toBe(action.holds.value)
      return
    }
    case 'none':
      expect(within(here()).queryByLabelText(control)).toBeNull()
      expect(here().textContent).toContain(action.reads)
      return
    case 'rules':
      expect(rulesIn(within(here()).getByRole('group', { name: control }))).toEqual(action.rules)
      return
    case 'says': {
      const region = within(here()).getByRole('region', { name: control })
      await waitFor(() => expect(within(region).getByRole('status').textContent).toBe(action.text))
      return
    }
  }
}

describe("the guide's section 4", () => {
  // The whole table, PostgreSQL's column and then SQL Server's in one
  // session, as the guide has the operator go down it twice -- so going back
  // to Connect for the second connection is part of what is proved.
  test('is every control the studio has, by the name the guide gives it, on both engines', async () => {
    servedDocument()
    const user = userEvent.setup()
    mount(plane.fetch)
    await user.type(screen.getByLabelText(STUDIO.token), TOKENS.admin)
    await user.click(screen.getByRole('button', { name: STUDIO.signIn }))
    await screen.findByRole('navigation', { name: STUDIO.steps })
    for (const form of GUIDE.forms) {
      const connection = ON_PLANE[form.connection]
      expect(connection, `the plane's connection for ${form.connection}`).toBeDefined()
      for (const row of studioWalk(GUIDE, { ...form, connection: connection ?? form.connection })) {
        try {
          await perform(user, row)
        } catch (error) {
          throw new Error(`${form.connection}: the guide's row "${row.control}" (${row.action.kind}): ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`, { cause: error })
        }
      }
    }
    // Not vacuous: both forms reached the server, published.
    expect(plane.requests.filter((request) => request.method === 'POST' && /^\/v1\/forms\/[^/]+\/versions$/.test(request.path)).map((request) => request.path)).toEqual(
      GUIDE.forms.map((form) => `/v1/forms/${form.formId}/versions`),
    )
  })
})
