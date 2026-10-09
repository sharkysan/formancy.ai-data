import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { computeAccessibleDescription } from 'dom-accessibility-api'
import { createSnapshot } from '@formancy/data-core'
import { audit, discover, generateOrder, goTo, paragraphs, signIn, step, writeOrderPolicy } from './test-studio.js'
import type { CoverageGap } from '@formancy/data-core'
import { CONNECTIONS, OWNER_SNAPSHOT, READER_SNAPSHOT, SQLSERVER_READER_SNAPSHOT, startPlane } from './test-server.js'
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

/** Where a gap is, as the studio writes it: the scope, a schema, or an object (0027). */
function place(gap: CoverageGap): string {
  const subject = gap.subject
  if (subject.kind === 'scope') return 'The whole scope'
  return subject.kind === 'schema' ? `Schema ${subject.schema}` : `${subject.object.schema}.${subject.object.name}`
}

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

  // SQL Server's reader sees sales.order and nothing it points at: its
  // catalog hides the rest, and since 0027 it is the connection that shows
  // gaps. They come before the tables, each named by scope, schema or object,
  // and the foreign keys into what it cannot see say so -- rather than the
  // snapshot reading as a database with one table and no relationships.
  test('shows what a restricted connection could not see, before what it could', async () => {
    const user = await signIn(plane)
    await discover(user, 'fixture-sqlserver-reader')
    const region = seen('fixture-sqlserver-reader')
    const gaps = within(region).getByRole('region', { name: 'What this connection could not see' })
    expect(SQLSERVER_READER_SNAPSHOT.gaps.length).toBeGreaterThan(0)
    expect(items(gaps, 'What this connection could not see')).toEqual(SQLSERVER_READER_SNAPSHOT.gaps.map((gap) => `${place(gap)} ${gap.aspect} ${gap.detail}`))
    expect(paragraphs(gaps).join(' ')).toMatch(/cannot tell, not does not exist/)
    // Prominent: the gaps precede every table in reading order.
    const objects = within(region).getByRole('heading', { name: 'Tables and views' })
    expect(gaps.compareDocumentPosition(objects) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(items(region, 'Foreign keys sales.order')).toContainEqual(expect.stringMatching(/^fk_order_customer \(tenant_id, customer_no\) → .*cannot see/))
    // Whether row security applies could not be told, and the order says so.
    expect(paragraphs(region)).toContain('Cannot tell whether row-level security applies.')
    expect(await audit()).toEqual([])
  })

  // PostgreSQL's catalog answers every role, so its reader describes every
  // table -- including the ones it may not read, which before 0027 vanished
  // behind a gap. Each says, column by column, that this connection may not
  // read it; a studio that showed the table bare would offer what the
  // generator refuses.
  test('shows a table the account may not read as described, with what it may not do, and no gap', async () => {
    const user = await signIn(plane)
    await discover(user, 'fixture-reader')
    const region = seen('fixture-reader')
    expect(READER_SNAPSHOT.gaps).toEqual([])
    const gaps = within(region).getByRole('region', { name: 'What this connection could not see' })
    expect(within(gaps).queryAllByRole('listitem')).toEqual([])
    const customer = READER_SNAPSHOT.objects.find((object) => object.ref.name === 'customer')
    expect(customer).toBeDefined()
    const columns = items(region, 'Columns sales.customer')
    expect(columns).toHaveLength(customer?.columns.length ?? 0)
    expect(columns.filter((line) => line.endsWith('this connection may not read it'))).toEqual(columns)
    expect(paragraphs(region)).toContain('Row-level security applies to this connection.')
  })

  // Whose snapshot this is decides what it says (0027): the header names the
  // principal the database answered for, and the login when it is another.
  test('names the account the connection discovered as', async () => {
    const user = await signIn(plane)
    await discover(user, 'fixture-reader')
    expect(paragraphs(seen('fixture-reader')).join(' ')).toContain(`Discovered as ${READER_SNAPSHOT.account.user}.`)
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

  // Discovering a second connection with the first one's discovery on
  // screen. Until the second answers, nothing may offer to choose a root:
  // Choose would open on the first connection, and when the second answered
  // it would switch under the operator and empty what they had typed -- which
  // is what an operator going down the getting-started guide twice met.
  test('offers no root to choose while another connection is being discovered', async () => {
    const user = await signIn(plane)
    await discover(user, 'fixture')
    const slow = plane.hold(/\/metadata$/)
    const reader = within(step('Connect')).getByRole('group', { name: 'fixture-reader' })
    await user.click(within(reader).getByRole('button', { name: 'Discover fixture-reader' }))
    expect(within(step('Connect')).queryByRole('button', { name: 'Choose a root' })).toBeNull()
    expect(within(step('Connect')).queryByRole('region', { name: 'What fixture can see' })).toBeNull()
    expect(within(screen.getByRole('navigation', { name: 'Steps' })).getByRole('button', { name: '2. Choose' })).toHaveProperty('disabled', true)
    slow.release()
    await screen.findByRole('region', { name: 'What fixture-reader can see' })
    await user.click(within(step('Connect')).getByRole('button', { name: 'Choose a root' }))
    expect(paragraphs(step('Choose')).join(' ')).toContain('One table or view of fixture-reader becomes the form.')
  })

  // A discovery refused leaves nothing of the one before it to choose from:
  // the step shows what it knows, and what it knows is the refusal.
  test('offers no root to choose after a discovery is refused', async () => {
    const user = await signIn(plane)
    await discover(user, 'fixture')
    plane.unreachable.add('fixture-reader')
    const reader = within(step('Connect')).getByRole('group', { name: 'fixture-reader' })
    await user.click(within(reader).getByRole('button', { name: 'Discover fixture-reader' }))
    await within(reader).findByRole('alert')
    expect(within(step('Connect')).queryByRole('button', { name: 'Choose a root' })).toBeNull()
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

  // A target the snapshot does not describe is "cannot see" whenever a gap
  // could hide it -- one about the target, or one about its schema's or the
  // scope's objects (0027). Read only the target's own gaps, and a table hidden
  // by a schema-wide gap is said to be outside the approved schemas: a claim
  // about the scope the connection cannot make.
  test('says a target hidden by a schema-wide gap cannot be seen, not that it is out of scope', async () => {
    const { fingerprint: _, ...contents } = structuredClone(OWNER_SNAPSHOT)
    contents.objects = contents.objects.filter((object) => !(object.ref.schema === 'sales' && object.ref.name === 'customer'))
    contents.gaps.push({ subject: { kind: 'schema', schema: 'sales' }, aspect: 'objects', detail: 'objects of sales this account may not see are left out' })
    plane.databases.set('fixture', createSnapshot(contents))
    const user = await signIn(plane)
    await discover(user, 'fixture')
    const lines = items(seen('fixture'), 'Foreign keys sales.order')
    const line = lines.find((text) => text.startsWith('fk_order_customer '))
    expect(line).toMatch(/which this connection cannot see: objects of sales this account may not see are left out$/)
    expect(line).not.toMatch(/outside the approved schemas/)
  })

  // "No foreign key" and "cannot tell" for one table: SQL Server hides the
  // foreign keys of a table the account has no permission on, and the adapter
  // writes a gap for it (0007). The table must not then read as having none.
  test('tells a table with no foreign key from one whose foreign keys it cannot see', async () => {
    const { fingerprint: _, ...contents } = structuredClone(OWNER_SNAPSHOT)
    contents.gaps.push({ subject: { kind: 'object', object: { schema: 'sales', name: 'country' } }, aspect: 'foreign-keys', detail: 'the account has no VIEW DEFINITION on sales.country' })
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
