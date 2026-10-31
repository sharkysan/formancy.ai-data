import { useState } from 'react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { computeAccessibleName } from 'dom-accessibility-api'
import { createBuilderSession } from '@formancy/builder-core'
import { deleteProblems, validatePolicy } from '@formancy/data-core'
import type { CascadeRule, FormPolicy } from '@formancy/data-core'
import { createAdminClient } from './api.js'
import type { Proposal, ProposalRequest } from './api.js'
import { PolicyStep } from './policy.js'
import {
  audit,
  discover,
  focusedName,
  generateOrder,
  goTo,
  paragraphs,
  pressEnter,
  servedDocument,
  signIn,
  step,
  unnamed,
  writeOrderPolicy,
} from './test-studio.js'
import type { User } from './test-studio.js'
import {
  OWNER_SNAPSHOT,
  SQLSERVER_READER_SNAPSHOT,
  SQLSERVER_SNAPSHOT,
  startPlane,
  TOKENS,
  withColumn,
  withDelete,
  withForeignKey,
  withGap,
  withoutDelete,
} from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * The Policy step's delete (0052): who may delete, and what a delete of one
 * of the form's records also does, asked one foreign key at a time before
 * anybody may delete -- against the real server, whose publish check is
 * `deleteProblems`, the function the step's own check runs.
 */
let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane()
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

const REACH = 'What deleting a record of sales.order also does'

/** What the step says of what the list covers, after the sentence of how much of the reach it is. */
const TRIGGERS = 'Triggers and rules that run on a delete are not listed, and do what the database defines.'

/** The three keys a delete of an order acts through on the fixture (0051, 0056), as the step names their boxes. */
const ORDER_KEYS = [
  'Also deletes the rows of sales.delivery that refer to it (fk_delivery_order, ON DELETE CASCADE)',
  'Also deletes the rows of sales.order_line that refer to it (fk_order_line_order, ON DELETE CASCADE)',
  'Also deletes the rows of sales.parcel that refer to a deleted row of sales.delivery (fk_parcel_delivery, ON DELETE CASCADE)',
]

/** What the three boxes accept, in the order the step lists them. */
const ORDER_CASCADES: CascadeRule[] = [
  { table: { schema: 'sales', name: 'delivery' }, foreignKey: 'fk_delivery_order', onDelete: 'cascade' },
  { table: { schema: 'sales', name: 'order_line' }, foreignKey: 'fk_order_line_order', onDelete: 'cascade' },
  { table: { schema: 'sales', name: 'parcel' }, foreignKey: 'fk_parcel_delivery', onDelete: 'cascade' },
]

const ORDER_REQUEST: ProposalRequest = {
  connection: 'fixture',
  root: { schema: 'sales', name: 'order' },
  formId: 'sales-order',
  title: 'Order',
  lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
  pinned: ['tenant_id'],
  versionColumn: 'row_version',
}

function check(policy: HTMLElement): { summary: string; problems: string[] } {
  const region = within(policy).getByRole('region', { name: 'Policy check' })
  const list = within(region).queryByRole('list', { name: 'Policy check' })
  return {
    summary: within(region).getByRole('status').textContent ?? '',
    problems:
      list === null
        ? []
        : within(list)
            .getAllByRole('listitem')
            .map((item) => item.textContent ?? ''),
  }
}

function items(container: HTMLElement, name: string): string[] {
  return within(within(container).getByRole('list', { name }))
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '')
}

function boxes(reach: HTMLElement): Array<[string, boolean]> {
  return within(reach)
    .getAllByRole('checkbox')
    .map((box) => [computeAccessibleName(box), (box as HTMLInputElement).checked])
}

async function proposalOf(request: ProposalRequest = ORDER_REQUEST): Promise<Proposal> {
  const outcome = await createAdminClient({ token: TOKENS.admin, fetch: plane.fetch }).propose(request)
  if (!outcome.ok) throw new Error(outcome.message)
  return outcome.value
}

/** The order form's policy, as `writeOrderPolicy` leaves it, with delete granted to `roles`. */
async function grantDelete(user: User, policy: HTMLElement, roles = 'clerk'): Promise<void> {
  await user.type(within(policy).getByLabelText('Roles that may delete'), roles)
}

/** The order form generated from `connection` as it is now, and its policy written, on the Policy step. */
async function orderPolicyOn(user: User, connection = 'fixture'): Promise<HTMLElement> {
  if (connection !== 'fixture') {
    await discover(user, connection)
    await user.click(screen.getByRole('button', { name: 'Choose a root' }))
    const choose = step('Choose')
    await user.selectOptions(within(choose).getByLabelText('Root table or view'), 'sales.order')
    await user.click(within(choose).getByRole('checkbox', { name: 'Offer fk_order_customer as a lookup' }))
    await user.click(within(choose).getByRole('checkbox', { name: 'Pin tenant_id' }))
    const version = within(choose).queryByLabelText('Version column')
    if (version !== null) await user.selectOptions(version, 'row_version')
    await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
    await screen.findByRole('main', { name: 'Generate' })
  } else {
    await generateOrder(user)
  }
  return writeOrderPolicy(user)
}

/**
 * The policy step alone, over `proposal`'s bindings and snapshot, holding
 * the policy it is given and every change it makes: a policy no journey
 * through the studio produces -- an acceptance of a key the delete does not
 * act through -- is then edited as one would be.
 */
function PolicyOf({ proposal, initial }: { proposal: Proposal; initial: FormPolicy }): ReactElement {
  const [policy, setPolicy] = useState(initial)
  const [session] = useState(() => createBuilderSession(proposal.form))
  return (
    <main aria-label="Policy">
      <PolicyStep
        bindings={proposal.bindings}
        snapshot={proposal.snapshot}
        session={session}
        policy={policy}
        onPolicy={setPolicy}
        stale={false}
        onRegenerate={() => Promise.resolve(null)}
      />
    </main>
  )
}

const FITTING: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'], delete: ['clerk'] },
  fields: {},
  rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
  lookups: { customer: [{ column: 'tenant_id', attribute: 'tenant' }] },
}

describe('who may delete', () => {
  // The roles typed are `operations.delete`, and a role that may delete and
  // not read is named by the check in validatePolicy's words: a delete names
  // the version its person read (0050). Left out when it names nobody, as
  // absent means nobody, so a policy that grants no delete stays one a
  // server older than 0050 still reads (watched failing with `delete: []`
  // published).
  test('delete roles are operations.delete, and a deleting role that may not read is named by the check', async () => {
    const user = await signIn(plane)
    const policy = await orderPolicyOn(user)
    expect(within(policy).getByText(/^This form offers create: yes; update: yes; delete: yes\./).textContent).toBe(
      'This form offers create: yes; update: yes; delete: yes. A role granted an operation the form does not offer is refused. A role that may delete must also be able to read, so its delete names the version it read.',
    )
    await grantDelete(user, policy, 'manager')
    const said = validatePolicy({ ...FITTING, operations: { ...FITTING.operations, delete: ['manager'] } }, (await proposalOf()).bindings)
    const unread =
      'operations.delete grants manager, who may not read with this form: a delete names the version its person read, so grant read to every role that may delete'
    expect(said.ok ? [] : said.problems).toEqual([unread])
    expect(check(policy).problems).toContain(unread)
    expect([...(await audit()), ...unnamed()]).toEqual([])

    await user.clear(within(policy).getByLabelText('Roles that may delete'))
    expect(check(policy)).toEqual({ summary: 'The policy fits this form.', problems: [] })
    // A box ticked while nobody may delete says what no delete does: the
    // check refuses it until it is unticked, and nothing unticks it for the
    // person.
    const reach = within(policy).getByRole('group', { name: REACH })
    await user.click(within(reach).getByRole('checkbox', { name: ORDER_KEYS[1] as string }))
    expect(check(policy).problems).toEqual(['cascades accepts what a delete does, and nobody may delete with this form'])
    await user.click(within(reach).getByRole('checkbox', { name: ORDER_KEYS[1] as string }))
    expect(check(policy)).toEqual({ summary: 'The policy fits this form.', problems: [] })
    const publish = await goTo(user, 'Publish')
    await user.click(await within(publish).findByRole('button', { name: 'Publish version 1' }))
    await within(publish).findByText('Published version 1 of sales-order.')
    const latest = await createAdminClient({ token: TOKENS.admin, fetch: plane.fetch }).latest('sales-order')
    expect(latest.ok && Object.hasOwn(latest.value.bundle.policy.operations, 'delete')).toBe(false)
  })
})

describe('what a delete also does', () => {
  // One box per key that acts on a delete, the ones past the order
  // included, none ticked to begin with, and nothing that accepts them all
  // at once: a key nobody read is not accepted (0051). The coverage
  // sentence says triggers and rules are not listed (watched failing with an
  // "Accept every key" button in the fieldset).
  test("the order's reach: one box per key that acts, and nothing that accepts them all", async () => {
    const user = await signIn(plane)
    const policy = await orderPolicyOn(user)
    const reach = within(policy).getByRole('group', { name: REACH })
    expect(boxes(reach)).toEqual(ORDER_KEYS.map((name) => [name, false]))
    expect(within(reach).queryAllByRole('button')).toEqual([])
    expect(within(reach).getByText(/^This is every foreign key/).textContent).toBe(
      `This is every foreign key the catalog shows onto sales.order and onto each table a delete of it removes rows from. ${TRIGGERS}`,
    )
    // No key onto the order or past it only refuses: nothing is listed for one.
    expect(within(reach).queryByRole('list', { name: 'The database refuses a delete' })).toBeNull()
    expect([...(await audit()), ...unnamed()]).toEqual([])
  })

  // Granted and unaccepted, the check says what each key does in
  // deleteProblems' words, the function the server refuses the bundle by;
  // each box ticked takes its problem away, and what the step publishes is
  // `operations.delete` and `cascades`, one entry per box, which the server
  // accepts (watched failing with the check's problems from validatePolicy
  // alone: the policy fitted and the server refused it).
  test('ticking every key publishes cascades the server accepts', async () => {
    const user = await signIn(plane)
    const policy = await orderPolicyOn(user)
    await grantDelete(user, policy)
    const proposal = await proposalOf()
    const granted = { ...FITTING, cascades: [] }
    expect(deleteProblems(proposal.snapshot, proposal.bindings, granted)).toHaveLength(3)
    for (const problem of deleteProblems(proposal.snapshot, proposal.bindings, granted)) expect(check(policy).problems).toContain(problem)
    expect([...(await audit()), ...unnamed()]).toEqual([])
    // The Publish step waits on the same check, as the server would refuse.
    expect(within(await goTo(user, 'Publish')).getByRole('note').textContent).toContain('The policy has 3 problems')
    await goTo(user, 'Policy')

    const reach = within(step('Policy')).getByRole('group', { name: REACH })
    for (const [index, name] of ORDER_KEYS.entries()) {
      await user.click(within(reach).getByRole('checkbox', { name }))
      expect(deleteProblems(proposal.snapshot, proposal.bindings, { ...granted, cascades: ORDER_CASCADES.slice(0, index + 1) })).toHaveLength(2 - index)
    }
    await waitFor(() => expect(check(step('Policy'))).toEqual({ summary: 'The policy fits this form.', problems: [] }))
    expect(boxes(reach)).toEqual(ORDER_KEYS.map((name) => [name, true]))

    const publish = await goTo(user, 'Publish')
    await user.click(await within(publish).findByRole('button', { name: 'Publish version 1' }))
    await within(publish).findByText('Published version 1 of sales-order.')
    const latest = await createAdminClient({ token: TOKENS.admin, fetch: plane.fetch }).latest('sales-order')
    expect(latest.ok && latest.value.bundle.policy.operations.delete).toEqual(['clerk'])
    expect(latest.ok && latest.value.bundle.policy.cascades).toEqual(ORDER_CASCADES)
  })

  // A key that only refuses is the database's to enforce: nothing is
  // accepted for it, and the person is told before they meet the refusal.
  // Listed, and nothing more -- no box. The database after the lines' key
  // was made NO ACTION.
  test('keys that only refuse are listed, with no box', async () => {
    plane.databases.set(
      'fixture',
      withForeignKey(OWNER_SNAPSHOT, {
        from: 'order_line',
        name: 'fk_order_line_order',
        columns: ['order_id'],
        onto: 'order',
        referencedColumns: ['id'],
        onDelete: 'no-action',
      }),
    )
    const user = await signIn(plane)
    const policy = await orderPolicyOn(user)
    const reach = within(policy).getByRole('group', { name: REACH })
    expect(boxes(reach).map(([name]) => name)).toEqual([ORDER_KEYS[0], ORDER_KEYS[2]])
    expect(items(reach, 'The database refuses a delete')).toEqual(['While rows of sales.order_line refer to it (fk_order_line_order, ON DELETE NO ACTION)'])
    expect([...(await audit()), ...unnamed()]).toEqual([])
  })

  // A key that sets NULL keeps the rows it reaches and changes them: its box
  // says which columns, and the walk stops there, so the parcels are no
  // longer reached. A key that refers to a column it clears refuses the
  // change, by its ON UPDATE, and is listed as one that refuses. The
  // parcels' key onto a delivery's id, which no delete of an order changes
  // now, is not listed, and the coverage sentence says so rather than
  // claiming every key onto the deliveries (watched failing with "onto
  // each table a delete of it reaches"). The database after the
  // deliveries' key was made ON DELETE SET NULL, and a parcel's order
  // reference added onto the delivery's.
  test('a key that clears a reference says which columns, and one that refuses the change is listed', async () => {
    const id = OWNER_SNAPSHOT.objects.find((object) => object.ref.name === 'order')?.columns.find((column) => column.name === 'id')
    if (id === undefined) throw new Error('the snapshot has no order id')
    const cleared = withForeignKey(OWNER_SNAPSHOT, {
      from: 'delivery',
      name: 'fk_delivery_order',
      columns: ['order_id'],
      onto: 'order',
      referencedColumns: ['id'],
      onDelete: 'set-null',
    })
    const referred = withColumn(cleared, 'parcel', { ...structuredClone(id), name: 'order_id', ordinal: 99, nullable: true, generated: 'none' })
    plane.databases.set(
      'fixture',
      withForeignKey(referred, {
        from: 'parcel',
        name: 'fk_parcel_order',
        columns: ['order_id'],
        onto: 'delivery',
        referencedColumns: ['order_id'],
        onDelete: 'no-action',
      }),
    )
    const user = await signIn(plane)
    const policy = await orderPolicyOn(user)
    const reach = within(policy).getByRole('group', { name: REACH })
    expect(boxes(reach)).toEqual([
      ['Sets order_id to NULL in the rows of sales.delivery that refer to it (fk_delivery_order, ON DELETE SET NULL)', false],
      [ORDER_KEYS[1], false],
    ])
    expect(items(reach, 'The database refuses a delete')).toEqual([
      'While rows of sales.parcel refer to the reference it would clear in sales.delivery (fk_parcel_order, ON UPDATE NO ACTION)',
    ])
    expect(within(reach).getByText(/^This is every foreign key/).textContent).toBe(
      `This is every foreign key the catalog shows onto sales.order and onto each table a delete of it removes rows from, and every one onto a column it clears: a key onto another column of a row it keeps is not affected, and is not listed. ${TRIGGERS}`,
    )
    expect(reach.textContent).not.toContain('fk_parcel_delivery')
    expect([...(await audit()), ...unnamed()]).toEqual([])
  })

  // A key that sets a default is said to set a default, never NULL, in the
  // number of its columns: the box is what a person accepts, so a SET
  // DEFAULT said as a SET NULL would accept what no delete does. The
  // database after the deliveries' key was made ON DELETE SET DEFAULT, of
  // its order alone and then of its tenant and order (watched failing with
  // every key that does not cascade said to set NULL).
  test('a key that sets a default says so, of one column and of several', async () => {
    servedDocument()
    const reachOf = async (columns: string[], referencedColumns: string[]) => {
      plane.databases.set(
        'fixture',
        withForeignKey(OWNER_SNAPSHOT, { from: 'delivery', name: 'fk_delivery_order', columns, onto: 'order', referencedColumns, onDelete: 'set-default' }),
      )
      const shown = render(<PolicyOf proposal={await proposalOf()} initial={FITTING} />)
      const reach = within(screen.getByRole('main', { name: 'Policy' })).getByRole('group', { name: REACH })
      const said = boxes(reach).map(([name]) => name)
      expect([...(await audit()), ...unnamed()]).toEqual([])
      shown.unmount()
      return said
    }
    expect(await reachOf(['order_id'], ['id'])).toEqual([
      'Sets order_id to its default in the rows of sales.delivery that refer to it (fk_delivery_order, ON DELETE SET DEFAULT)',
      ORDER_KEYS[1],
    ])
    expect((await reachOf(['tenant_id', 'order_id'], ['tenant_id', 'id']))[0]).toBe(
      'Sets tenant_id, order_id to their defaults in the rows of sales.delivery that refer to it (fk_delivery_order, ON DELETE SET DEFAULT)',
    )
  })

  // What no box can make grantable is said, in deleteProblems' words, in the
  // fieldset as well as in the check: a table past the order the account
  // may not DELETE from -- the database after `revoke delete on
  // sales.parcel`. Ticking every box leaves exactly that in the check.
  test('a refusal no box can fix is said in the publish check’s words', async () => {
    plane.databases.set('fixture', withoutDelete(OWNER_SNAPSHOT, 'parcel'))
    const user = await signIn(plane)
    const policy = await orderPolicyOn(user)
    const reach = within(policy).getByRole('group', { name: REACH })
    const refusal =
      "deleting a record of sales.order reaches sales.parcel, which this connection's account may not DELETE from: a delete is held to the account's DELETE on every table it reaches"
    expect(items(reach, 'Delete cannot be granted on this form, whatever is ticked')).toEqual([refusal])
    await grantDelete(user, policy)
    for (const name of ORDER_KEYS) await user.click(within(reach).getByRole('checkbox', { name }))
    expect(check(policy).problems).toEqual([`operations.delete grants roles, and ${refusal}`])
    expect([...(await audit()), ...unnamed()]).toEqual([])
  })

  // Behind a `referenced-by` gap, the list is not every key, and the
  // sentence that would say so says what it cannot see instead; the gap is
  // a refusal no box can fix. SQL Server's owner, with the gap a reader
  // without VIEW DEFINITION has.
  test('behind a gap, the coverage sentence says the list is not every key, and the gap refuses', async () => {
    const detail =
      'this account lacks VIEW DEFINITION on the database, which is what lists every foreign key on a table in any schema, so a key on a table it cannot see may refer to any table in scope'
    plane.databases.set('fixture-sqlserver', withGap(SQLSERVER_SNAPSHOT, { subject: { kind: 'scope' }, aspect: 'referenced-by', detail }))
    const user = await signIn(plane)
    const policy = await orderPolicyOn(user, 'fixture-sqlserver')
    const reach = within(policy).getByRole('group', { name: REACH })
    expect(within(reach).queryByText(/^This is every foreign key/)).toBeNull()
    expect(within(reach).getByText(/^This is not every foreign key/).textContent).toBe(
      `This is not every foreign key a delete of sales.order may act through: what the snapshot cannot see is said below. ${TRIGGERS}`,
    )
    expect(items(reach, 'Delete cannot be granted on this form, whatever is ticked')).toEqual([
      `this snapshot cannot show everything that refers to sales.order: ${detail}`,
    ])
    expect([...(await audit()), ...unnamed()]).toEqual([])
  })

  // That no key acts is said only where the snapshot can show every key.
  // Nothing refers to SQL Server's order lines, which offer delete there,
  // and the owner sees every key: the step says so. SQL Server's reader,
  // granted DELETE on the order, sees no key onto it either, behind its
  // scope gap, while in the database the lines' and the deliveries' keys
  // cascade: "No foreign key deletes or changes other rows" there would
  // report no relationships where the snapshot cannot establish any (fail
  // closed; watched failing with the sentence a complete snapshot gets,
  // shown beside the gap, and with the reader's sentence shown for both).
  test('says that no key acts only where the snapshot can show every key', async () => {
    servedDocument()
    const lines = await proposalOf({
      connection: 'fixture-sqlserver',
      root: { schema: 'sales', name: 'order_line' },
      formId: 'sales-order_line',
      title: 'Order line',
      lookups: [],
      pinned: [],
    })
    expect(lines.bindings.operations.delete).toBe(true)
    const shown = render(
      <PolicyOf
        proposal={lines}
        initial={{ version: 1, operations: { read: ['clerk'], create: [], update: [], delete: ['clerk'] }, fields: {}, rowFilters: [], lookups: {} }}
      />,
    )
    const linesReach = within(screen.getByRole('main', { name: 'Policy' })).getByRole('group', { name: 'What deleting a record of sales.order_line also does' })
    expect(within(linesReach).queryAllByRole('checkbox')).toEqual([])
    expect(paragraphs(linesReach)).toEqual([
      `This is every foreign key the catalog shows onto sales.order_line and onto each table a delete of it removes rows from. ${TRIGGERS}`,
      'No foreign key deletes or changes other rows when a record of sales.order_line is deleted.',
    ])
    expect([...(await audit()), ...unnamed()]).toEqual([])
    shown.unmount()

    plane.databases.set('fixture-sqlserver-reader', withDelete(SQLSERVER_READER_SNAPSHOT, 'order'))
    const proposal = await proposalOf({
      connection: 'fixture-sqlserver-reader',
      root: { schema: 'sales', name: 'order' },
      formId: 'sales-order',
      title: 'Order',
      lookups: [],
      pinned: [],
    })
    expect(proposal.bindings.operations.delete).toBe(true)
    const order = proposal.snapshot.objects.find((object) => object.ref.name === 'order')
    expect(order?.referencedBy).toEqual([])
    const gap = proposal.snapshot.gaps.find((candidate) => candidate.subject.kind === 'scope' && candidate.aspect === 'referenced-by')
    if (gap === undefined) throw new Error("the reader's snapshot has no scope gap over what refers to a table")
    render(
      <PolicyOf
        proposal={proposal}
        initial={{ version: 1, operations: { read: ['clerk'], create: [], update: [], delete: ['clerk'] }, fields: {}, rowFilters: [], lookups: {} }}
      />,
    )
    const reach = within(screen.getByRole('main', { name: 'Policy' })).getByRole('group', { name: REACH })
    expect(within(reach).queryAllByRole('checkbox')).toEqual([])
    expect(paragraphs(reach).filter((paragraph) => /^No foreign key/.test(paragraph))).toEqual([])
    expect(within(reach).getByText(/^The snapshot shows no foreign key/).textContent).toBe(
      'The snapshot shows no foreign key that deletes or changes other rows when a record of sales.order is deleted, and cannot show every one.',
    )
    expect(within(reach).getByText(/^This is not every foreign key/).textContent).toBe(
      `This is not every foreign key a delete of sales.order may act through: what the snapshot cannot see is said below. ${TRIGGERS}`,
    )
    expect(items(reach, 'Delete cannot be granted on this form, whatever is ticked')).toEqual([
      `this snapshot cannot show everything that refers to sales.order: ${gap.detail}`,
    ])
    expect([...(await audit()), ...unnamed()]).toEqual([])
  })

  // A form that offers no delete has no reach to show: without a confirmed
  // version column the order offers none (watched failing with the
  // fieldset shown whatever the form offers).
  test('a form that offers no delete shows no reach', async () => {
    const user = await signIn(plane)
    await discover(user)
    await user.click(screen.getByRole('button', { name: 'Choose a root' }))
    const choose = step('Choose')
    await user.selectOptions(within(choose).getByLabelText('Root table or view'), 'sales.order')
    await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
    await screen.findByRole('main', { name: 'Generate' })
    const policy = await goTo(user, 'Policy')
    expect(within(policy).getByText(/^This form offers create: yes; update: no; delete: no\./)).toBeTruthy()
    expect(within(policy).queryByRole('group', { name: REACH })).toBeNull()
    expect([...(await audit()), ...unnamed()]).toEqual([])
  })
})

describe('an acceptance that names nothing a delete does', () => {
  // An acceptance of a key the delete does not act through, or with another
  // action than it has, is refused by the publish check as untrue (0051);
  // the step names each with a way to remove it, as it names a stray
  // lookup filter. Removing one takes its button: the keyboard goes to the
  // next one's Remove, which has moved up a place, else the one before's,
  // and when the note closes to the policy check (watched failing with the
  // keyboard left on the page, with the next one's Remove sought at the
  // place it had, and with nothing sought before the last).
  test('each is named and removed, and the keyboard goes to its neighbour, then the check', async () => {
    servedDocument()
    const proposal = await proposalOf()
    const user = userEvent.setup()
    const initial: FormPolicy = {
      ...FITTING,
      cascades: [
        ...ORDER_CASCADES.slice(0, 2),
        { table: { schema: 'sales', name: 'customer' }, foreignKey: 'fk_customer_country', onDelete: 'cascade' },
        { table: { schema: 'sales', name: 'parcel' }, foreignKey: 'fk_parcel_delivery', onDelete: 'set-null' },
        { table: { schema: 'sales', name: 'employee' }, foreignKey: 'fk_employee_manager', onDelete: 'set-null' },
      ],
    }
    render(<PolicyOf proposal={proposal} initial={initial} />)
    const policy = screen.getByRole('main', { name: 'Policy' })
    const named = 'The policy accepts what a delete of sales.order does not do'
    const note = within(policy).getByRole('note', { name: named })
    expect(items(note, named).map((item) => item.replace(/\s*Remove.*$/, ''))).toEqual([
      'fk_customer_country of sales.customer, as ON DELETE CASCADE',
      'fk_parcel_delivery of sales.parcel, as ON DELETE SET NULL',
      'fk_employee_manager of sales.employee, as ON DELETE SET NULL',
    ])
    const fitted = validatePolicy(initial, proposal.bindings)
    expect(check(policy).problems).toEqual([...(fitted.ok ? [] : fitted.problems), ...deleteProblems(proposal.snapshot, proposal.bindings, initial)])
    expect(check(policy).problems).toHaveLength(4)
    expect([...(await audit()), ...unnamed()]).toEqual([])

    await pressEnter(user, within(note).getByRole('button', { name: 'Remove the acceptance of fk_parcel_delivery of sales.parcel' }))
    expect(focusedName()).toBe('Remove the acceptance of fk_employee_manager of sales.employee')
    await pressEnter(user, within(policy).getByRole('button', { name: 'Remove the acceptance of fk_employee_manager of sales.employee' }))
    expect(focusedName()).toBe('Remove the acceptance of fk_customer_country of sales.customer')
    await pressEnter(user, within(policy).getByRole('button', { name: 'Remove the acceptance of fk_customer_country of sales.customer' }))
    expect(document.activeElement).toBe(within(policy).getByRole('region', { name: 'Policy check' }))
    expect(within(policy).queryByRole('note', { name: named })).toBeNull()
    // What is left is the key nobody accepted with its action, which its box accepts.
    expect(check(policy).problems).toEqual([
      'operations.delete grants roles, and deleting a record of sales.order also deletes rows of sales.parcel (fk_parcel_delivery, ON DELETE CASCADE), which cascades does not accept',
    ])
    const reach = within(policy).getByRole('group', { name: REACH })
    expect(boxes(reach)).toEqual(ORDER_KEYS.map((name, index) => [name, index < 2]))
    await user.click(within(reach).getByRole('checkbox', { name: ORDER_KEYS[2] as string }))
    expect(check(policy)).toEqual({ summary: 'The policy fits this form.', problems: [] })
  })

  // A form generated again without delete -- here without the version
  // column -- keeps the policy, cascades and all; with no reach to untick,
  // every acceptance is listed with its Remove, or the policy could never
  // be published again from the studio.
  test('on a form that offers no delete, every acceptance is listed with its Remove', async () => {
    servedDocument()
    const { versionColumn: _, ...unversioned } = ORDER_REQUEST
    const proposal = await proposalOf(unversioned)
    const user = userEvent.setup()
    const initial: FormPolicy = { ...FITTING, operations: { ...FITTING.operations, update: [] }, cascades: [ORDER_CASCADES[1] as CascadeRule] }
    const { delete: _granted, ...operations } = initial.operations
    render(<PolicyOf proposal={proposal} initial={{ ...initial, operations }} />)
    const policy = screen.getByRole('main', { name: 'Policy' })
    expect(check(policy).problems).toEqual(['cascades accepts what a delete does, and nobody may delete with this form'])
    const note = within(policy).getByRole('note', { name: 'The policy accepts what a delete does, and this form offers no delete' })
    expect([...(await audit()), ...unnamed()]).toEqual([])
    await pressEnter(user, within(note).getByRole('button', { name: 'Remove the acceptance of fk_order_line_order of sales.order_line' }))
    expect(document.activeElement).toBe(within(policy).getByRole('region', { name: 'Policy check' }))
    expect(check(policy)).toEqual({ summary: 'The policy fits this form.', problems: [] })
  })
})
