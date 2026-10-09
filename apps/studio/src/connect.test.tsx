import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { computeAccessibleDescription } from 'dom-accessibility-api'
import { createSnapshot } from '@formancy/data-core'
import { audit, discover, generateOrder, goTo, paragraphs, signIn, step, writeOrderPolicy } from './test-studio.js'
import { CONNECTIONS, OWNER_SNAPSHOT, READER_SNAPSHOT, startPlane } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * Step 2, connecting: the server's allowlist, a test of each connection, and
 * what one can see -- with what it cannot see first, because "no
 * relationship" and "cannot tell" are different answers (0004).
 */
let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane()
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

function seen(connection: string): HTMLElement {
  return screen.getByRole('region', { name: `What ${connection} can see` })
}

/** The items of the list named `name` inside `container`, as text. */
function items(container: HTMLElement, name: string): string[] {
  return within(within(container).getByRole('list', { name }))
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '')
}

describe('connecting', () => {
  // The list is the server's allowlist, in its order. A studio with its own
  // idea of which databases exist would offer one the server refuses.
  test('lists exactly the connections the server allows, and tests one', async () => {
    const user = await signIn(plane)
    const connect = step('Connect')
    expect(within(connect).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([...CONNECTIONS])
    const fixture = within(connect).getByRole('group', { name: 'fixture' })
    await user.click(within(fixture).getByRole('button', { name: 'Test fixture' }))
    expect((await within(fixture).findByRole('status')).textContent).toBe(`PostgreSQL ${OWNER_SNAPSHOT.serverVersion} answered.`)
    expect(await audit()).toEqual([])
  })

  // A database that does not answer says so, and never in the driver's words:
  // they name hosts and ports, which are the operator's and stay in the log.
  test('says a connection did not answer without saying where it is', async () => {
    plane.unreachable.add('fixture')
    const user = await signIn(plane)
    const fixture = within(step('Connect')).getByRole('group', { name: 'fixture' })
    await user.click(within(fixture).getByRole('button', { name: 'Test fixture' }))
    const alert = await within(fixture).findByRole('alert')
    expect(alert.textContent).toBe('Connection fixture cannot be reached.')
    await user.click(within(fixture).getByRole('button', { name: 'Discover fixture' }))
    expect(within(fixture).getAllByRole('alert').map((element) => element.textContent)).toEqual(['Connection fixture cannot be reached.', 'Connection fixture cannot be reached.'])
    expect(document.body.textContent).not.toContain('10.0.0.5')
  })

  // The restricted reader sees sales.order and nothing it points at. Its gaps
  // come before the tables, each named, and the foreign keys into what it
  // cannot see say so -- rather than the snapshot reading as a database with
  // one table and no relationships.
  test('shows what a restricted connection could not see, before what it could', async () => {
    const user = await signIn(plane)
    await discover(user, 'fixture-reader')
    const region = seen('fixture-reader')
    const gaps = within(region).getByRole('region', { name: 'What this connection could not see' })
    expect(items(gaps, 'What this connection could not see')).toEqual(
      READER_SNAPSHOT.gaps.map((gap) => `${gap.object === null ? 'The whole scope' : `${gap.object.schema}.${gap.object.name}`} ${gap.aspect} ${gap.detail}`),
    )
    expect(paragraphs(gaps).join(' ')).toMatch(/cannot tell, not does not exist/)
    // Prominent: the gaps precede every table in reading order.
    const objects = within(region).getByRole('heading', { name: 'Tables and views' })
    expect(gaps.compareDocumentPosition(objects) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(items(region, 'Foreign keys')).toContain(
      'fk_order_customer (tenant_id, customer_no) → sales.customer (tenant_id, customer_no), which this connection cannot see: this account holds no privilege on it that a form could read or write with',
    )
    expect(await audit()).toEqual([])
  })

  // The owner sees everything, and that is said as the adapter's finding --
  // an empty gap list is not a missing section.
  test('says when a connection reported no gap', async () => {
    const user = await signIn(plane)
    await discover(user, 'fixture')
    const gaps = within(seen('fixture')).getByRole('region', { name: 'What this connection could not see' })
    expect(paragraphs(gaps)).toEqual(['No gap was reported: everything in the approved schemas was visible to this connection.'])
    expect(within(step('Connect')).getByRole('button', { name: 'Choose a root' })).toBeTruthy()
  })

  // While a discovery is on its way the buttons stay enabled -- a disabled
  // one would drop the keyboard's focus -- and a second press sends nothing.
  test('keeps the focus while it waits, and asks once', async () => {
    const user = await signIn(plane)
    const fixture = within(step('Connect')).getByRole('group', { name: 'fixture' })
    const button = within(fixture).getByRole('button', { name: 'Discover fixture' })
    const slow = plane.hold(/\/metadata$/)
    button.focus()
    await user.keyboard('{Enter}')
    await user.keyboard('{Enter}')
    expect(document.activeElement).toBe(button)
    slow.release()
    await screen.findByRole('region', { name: 'What fixture can see' })
    expect(plane.requests.filter((request) => request.path.endsWith('/metadata'))).toHaveLength(1)
  })

  // Discovering reads like looking, and the step invites comparing what each
  // connection can see. Looking at another one after a form is generated
  // must not throw the form, its presentation and its policy away: they stay
  // until a root is chosen on the other connection, and the Choose step says
  // so on that choice before it is made.
  test('keeps the generated form and its policy while another connection is looked at', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    await writeOrderPolicy(user)
    await goTo(user, 'Connect')
    await discover(user, 'fixture-reader')
    const steps = screen.getByRole('navigation', { name: 'Steps' })
    expect(within(steps).getByRole('button', { name: '4. Policy' })).toHaveProperty('disabled', false)
    const policy = await goTo(user, 'Policy')
    expect((within(policy).getByLabelText('Roles that may read') as HTMLInputElement).value).toBe('clerk')
    expect(paragraphs(await goTo(user, 'Publish')).join(' ')).toContain('its bindings to sales.order on fixture,')

    // The other connection's Choose step starts empty, and the root says what choosing one replaces.
    const choose = await goTo(user, 'Choose')
    const root = within(choose).getByLabelText('Root table or view')
    expect((root as HTMLSelectElement).value).toBe('')
    expect(computeAccessibleDescription(root)).toBe('Choosing a root on fixture-reader replaces the form generated from sales.order on fixture, and its policy.')
    expect(await audit()).toEqual([])

    // Back on the first connection, its choice is as it was left.
    await goTo(user, 'Connect')
    await discover(user, 'fixture')
    const again = await goTo(user, 'Choose')
    expect(within(again).getByRole('checkbox', { name: 'Pin tenant_id' })).toHaveProperty('checked', true)

    // Choosing on the other connection is what starts afresh.
    await goTo(user, 'Connect')
    await discover(user, 'fixture-reader')
    await user.selectOptions(within(await goTo(user, 'Choose')).getByLabelText('Root table or view'), 'sales.order')
    expect(within(steps).getByRole('button', { name: '4. Policy' })).toHaveProperty('disabled', true)
  })

  // "No foreign key" and "cannot tell" for one table: SQL Server hides the
  // foreign keys of a table the account has no permission on, and the adapter
  // writes a gap for it (0007). The table must not then read as having none.
  test('tells a table with no foreign key from one whose foreign keys it cannot see', async () => {
    const { fingerprint: _, ...contents } = structuredClone(OWNER_SNAPSHOT)
    contents.gaps.push({ object: { schema: 'sales', name: 'country' }, aspect: 'foreign-keys', detail: 'the account has no VIEW DEFINITION on sales.country' })
    plane.databases.set('fixture', createSnapshot(contents))
    const user = await signIn(plane)
    await discover(user, 'fixture')
    const region = seen('fixture')
    const said = paragraphs(region)
    expect(said).toContain('Cannot tell whether there are more: the account has no VIEW DEFINITION on sales.country')
    // customer_summary is a view with no foreign key and no gap: that one has none.
    expect(said.filter((sentence) => sentence === 'No foreign key.')).toHaveLength(
      OWNER_SNAPSHOT.objects.filter((object) => object.foreignKeys.length === 0 && object.ref.name !== 'country').length,
    )
  })
})
