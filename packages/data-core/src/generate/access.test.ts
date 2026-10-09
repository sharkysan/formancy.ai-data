import { canonicalize } from '@formancy/spec'
import { describe, expect, test } from 'vitest'
import type { CoverageGap, MetadataSnapshot, ObjectMeta } from '../metadata.js'
import { col, MS, orderForm, PG, restrict, sales, snapshot } from '../records/test-support.js'
import { createSnapshot } from '../snapshot.js'
import { generateForm } from './generate.js'
import type { FieldBinding, GeneratedForm, GenerationRequest } from './types.js'

/*
 * What the generator makes of an account that may not do everything (0027).
 * The snapshot is the planner's restatement of the fixture; each test narrows
 * one privilege the way a grant would, and the full-access cases in
 * generate.test.ts prove the owner's form is unchanged.
 */

const ORDER: GenerationRequest = {
  connection: 'erp',
  root: sales('order'),
  formId: 'sales-order',
  title: 'Order',
  lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
}
const on = (name: string, extra: Partial<GenerationRequest> = {}): GenerationRequest => ({ ...ORDER, root: sales(name), formId: `sales-${name}`, lookups: [], ...extra })

function fieldOf(form: GeneratedForm, key: string): FieldBinding | undefined {
  return form.bindings.fields.find((binding) => binding.field === key)
}

function disabled(form: GeneratedForm): string[] {
  return (form.form.logic?.rules ?? []).filter((rule) => rule.kind === 'disabled').map((rule) => rule.target)
}

/** Every column of one table narrowed alike. */
function restrictAll(objects: ObjectMeta[], table: string, access: Parameters<typeof restrict>[3]): void {
  for (const column of objects.find((object) => object.ref.name === table)?.columns ?? []) restrict(objects, table, column.name, access)
}

/** The same snapshot, edited, with gaps, as an adapter that could not establish something reports it. */
function withGaps(source: MetadataSnapshot, gaps: CoverageGap[], edit: (objects: ObjectMeta[]) => void): MetadataSnapshot {
  const { fingerprint: _fingerprint, ...rest } = JSON.parse(JSON.stringify(source)) as MetadataSnapshot
  edit(rest.objects)
  return createSnapshot({ ...rest, gaps })
}

describe('columns the account may not read or write', () => {
  // A field over a column the account may not SELECT fails at its first read,
  // 42501 on PostgreSQL and 230 on SQL Server, and takes the whole form with it.
  test('an unreadable column gets no field and an excluded note', () => {
    const form = generateForm(snapshot('postgres', (objects) => restrict(objects, 'order', 'notes', { select: false })), ORDER)
    expect(fieldOf(form, 'notes')).toBeUndefined()
    expect(form.form.model.fields.map((field) => field.key)).not.toContain('notes')
    expect(form.notes).toContainEqual({ subject: 'notes', kind: 'excluded', message: "This connection's account may not read it." })
  })

  // formancy has no per-operation mode, so a field disabled in the document is
  // disabled on create too, where a person must fill it. The field stays
  // enabled; the bindings say it is written on create only, and the note says
  // why — and the server refuses a changed value on update (0022).
  test('a column that may be inserted and not updated is written on create, read-only on update with the reason, and not disabled', () => {
    const form = generateForm(
      snapshot('sqlserver', (objects) => {
        restrict(objects, 'order', 'amount', { update: false })
        restrict(objects, 'order', 'notes', { insert: false })
        restrict(objects, 'order', 'tenant_id', { update: false })
      }),
      ORDER,
    )
    expect(fieldOf(form, 'amount')?.writes).toEqual({ create: true, update: false })
    expect(form.form.model.fields.find((field) => field.key === 'amount')).toMatchObject({ required: true })
    expect(form.notes).toContainEqual({ subject: 'amount', kind: 'read-only', message: "Read-only on update: this connection's account may not UPDATE amount." })

    expect(fieldOf(form, 'notes')?.writes).toEqual({ create: false, update: true })
    expect(form.notes).toContainEqual({ subject: 'notes', kind: 'read-only', message: "Not written on create: this connection's account may not INSERT it." })

    // A lookup is written per operation by the same rule, over its columns.
    expect(fieldOf(form, 'customer')?.writes).toEqual({ create: true, update: false })
    expect(form.notes).toContainEqual({ subject: 'customer', kind: 'read-only', message: "Read-only on update: this connection's account may not UPDATE tenant_id." })

    expect(disabled(form)).not.toContain('amount')
    expect(disabled(form)).not.toContain('notes')
    expect(disabled(form)).not.toContain('customer')
    expect(form.bindings.operations).toEqual({ create: true, update: true })
  })

  // Neither write is possible, so the field is shown and never written, like
  // a generated one; a note that said only "read-only" would leave a reviewer
  // looking for a generator that is not there.
  test('a column that may be neither inserted nor updated is a disabled field, and says why', () => {
    const form = generateForm(snapshot('sqlserver', (objects) => restrict(objects, 'order', 'group', { insert: false, update: false })), ORDER)
    expect(fieldOf(form, 'group')?.writes).toEqual({ create: false, update: false })
    expect(disabled(form)).toContain('group')
    expect(form.notes).toContainEqual({ subject: 'group', kind: 'read-only', message: "Read-only: this connection's account may neither INSERT nor UPDATE it." })
  })

  // A read-only reason that is not privilege — a generated column — says so
  // and nothing about privileges, which would mislead the reviewer into a grant
  // that changes nothing.
  test('privilege is noted only when it alone stops a write', () => {
    const form = generateForm(snapshot('sqlserver', (objects) => restrict(objects, 'order', 'id', { insert: false, update: false })), ORDER)
    expect(form.notes.filter((note) => note.subject === 'id' && note.kind === 'read-only').map((note) => note.message)).toEqual([
      'The database numbers this value (identity-always) and refuses one given to it.',
    ])
  })
})

describe('operations the account may not perform', () => {
  // A create the database refuses for privilege fails after a person filled
  // the whole form. Offered only when the account may INSERT, and the note
  // names the privilege so the remedy is a grant.
  test('no INSERT on the root blocks create, and the note names INSERT', () => {
    const form = generateForm(snapshot('sqlserver', (objects) => restrictAll(objects, 'order', { insert: false })), ORDER)
    expect(form.bindings.operations).toEqual({ create: false, update: true })
    expect(form.notes).toContainEqual({ subject: 'order', kind: 'blocked', message: "Create is not offered: this connection's account may INSERT none of the columns of sales.order." })
  })

  // An update that writes nothing the account may UPDATE is refused by the
  // database on every save.
  test('no UPDATE on any column the form would write blocks update, and the note names UPDATE', () => {
    const form = generateForm(snapshot('sqlserver', (objects) => restrictAll(objects, 'order', { update: false })), ORDER)
    expect(form.bindings.operations).toEqual({ create: true, update: false })
    expect(form.notes).toContainEqual({ subject: 'order', kind: 'blocked', message: "Update is not offered: this connection's account may UPDATE none of the columns this form writes." })
  })

  // A form that cannot read its root cannot show a record, so there is no
  // form to generate; saying which table and which privilege is the remedy.
  test('an unreadable root throws, naming it', () => {
    const blind = snapshot('postgres', (objects) => restrictAll(objects, 'customer', { select: false }))
    expect(() => generateForm(blind, on('customer'))).toThrow("sales.customer cannot be read by this connection: its account may SELECT none of its columns.")
  })

  // The tenant column is in the WHERE of every read and update; unreadable,
  // each of them fails with permission-denied. Not insertable, every create
  // the policy writes it on is refused.
  test('an unreadable pinned column throws; a pinned column the account may not insert blocks create', () => {
    const blind = snapshot('postgres', (objects) => restrict(objects, 'employee', 'tenant_id', { select: false }))
    expect(() => generateForm(blind, on('employee', { pinned: ['tenant_id'] }))).toThrow(/tenant_id is pinned by the policy, and this connection's account may not read it/)

    const fixed = generateForm(snapshot('postgres', (objects) => restrict(objects, 'employee', 'tenant_id', { insert: false })), on('employee', { pinned: ['tenant_id'] }))
    expect(fixed.bindings.operations.create).toBe(false)
    expect(fixed.notes).toContainEqual({
      subject: 'employee',
      kind: 'blocked',
      message: "Create is not offered: tenant_id is pinned by the policy and written from the trusted context, and this connection's account may not INSERT it.",
    })
  })
})

describe('identity and concurrency', () => {
  // A key the account may not read cannot be read back into a record token,
  // so it cannot address a record; a readable unique key can.
  test('an unreadable primary key falls back to a readable unique key; with none, create is offered and update is blocked', () => {
    const fallback = snapshot('sqlserver', (objects) => {
      restrict(objects, 'country', 'id', { select: false })
      objects.find((object) => object.ref.name === 'country')?.columns.push(col('row_version', 4, { kind: 'rowversion' }, { generated: 'rowversion' }))
    })
    expect(generateForm(fallback, on('country')).bindings.identity).toEqual(['iso_code'])

    const keyless = snapshot('sqlserver', (objects) => {
      restrict(objects, 'country', 'id', { select: false })
      const country = objects.find((object) => object.ref.name === 'country') as ObjectMeta
      country.uniqueKeys = []
      country.columns.push(col('row_version', 4, { kind: 'rowversion' }, { generated: 'rowversion' }))
    })
    const form = generateForm(keyless, on('country'))
    expect(form.bindings.identity).toBeNull()
    expect(form.bindings.operations).toEqual({ create: true, update: false })
    expect(form.notes).toContainEqual({ subject: 'country', kind: 'blocked', message: "Records cannot be read back or updated: this connection's account may not read key column id." })
  })

  // Every update writes a version column (0015) and reads it back; a
  // confirmed one the account may not UPDATE or read fails every save. A
  // suggestion that could not be confirmed is not made. A rowversion the
  // account cannot read cannot be compared, so update is not offered.
  test('a confirmed version column that is not updatable throws; an unreadable rowversion leaves update blocked with a note', () => {
    const noUpdate = snapshot('postgres', (objects) => restrict(objects, 'order', 'row_version', { update: false }))
    expect(() => generateForm(noUpdate, { ...ORDER, versionColumn: 'row_version' })).toThrow("row_version cannot be a version column: this connection's account may not UPDATE it")
    const noRead = snapshot('postgres', (objects) => restrict(objects, 'order', 'row_version', { select: false }))
    expect(() => generateForm(noRead, { ...ORDER, versionColumn: 'row_version' })).toThrow("row_version cannot be a version column: this connection's account may not read it")
    expect(generateForm(noUpdate, ORDER).bindings.concurrency).toBeNull()

    const hidden = generateForm(snapshot('sqlserver', (objects) => restrict(objects, 'order', 'row_version', { select: false })), ORDER)
    expect(hidden.bindings.concurrency).toBeNull()
    expect(hidden.bindings.operations.update).toBe(false)
    expect(hidden.notes).toContainEqual({
      subject: 'order',
      kind: 'blocked',
      message: "Update is not offered: this connection's account may not read row_version, the rowversion a stale save is detected by.",
    })
  })
})

describe('lookups', () => {
  // A lookup reads its foreign key's columns on the root and the target's key
  // and display columns on every search; one the account cannot read throws
  // on every search, after the form was published.
  test('a lookup over an unreadable foreign-key, target-key or display column throws, naming it', () => {
    const over = (table: string, column: string) => () => generateForm(snapshot('postgres', (objects) => restrict(objects, table, column, { select: false })), ORDER)
    expect(over('order', 'customer_no')).toThrow("fk_order_customer: this connection's account may not read sales.order.customer_no")
    expect(over('customer', 'tenant_id')).toThrow("fk_order_customer: this connection's account may not read sales.customer.tenant_id")
    expect(over('customer', 'name')).toThrow("fk_order_customer: this connection's account may not read sales.customer.name")
  })
})

describe('row security', () => {
  // A form over a policed table shows fewer records than the table holds, and
  // a write the policy refuses is refused. Nothing here says which rows, so the
  // note says what it means for the form instead.
  test('row security that applies to the root or a lookup target gives an access note', () => {
    const policed = snapshot('sqlserver', (objects) => {
      for (const object of objects) if (object.ref.name === 'customer' || object.ref.name === 'order') object.rowSecurity = 'applies'
    })
    const form = generateForm(policed, ORDER)
    const access = form.notes.filter((note) => note.kind === 'access')
    expect(access).toEqual([
      {
        subject: 'order',
        kind: 'access',
        message:
          'Row-level security applies to this connection on sales.order: records outside its policies read as not found, a write its policies refuse is refused, and this module sets no session state a policy may read (0011).',
      },
      {
        subject: 'customer',
        kind: 'access',
        message:
          'Row-level security applies to this connection on sales.customer: records outside its policies read as not found, a write its policies refuse is refused, and this module sets no session state a policy may read (0011).',
      },
    ])
    expect(form.bindings.operations).toEqual({ create: true, update: true })
  })

  // "Cannot tell" is not "none": the reviewer is told which, and why.
  test('row security that cannot be established gives an access note with the gap that says why', () => {
    const unknown = withGaps(MS, [{ subject: { kind: 'scope' }, aspect: 'row-security', detail: 'This account has no VIEW DEFINITION on the database.' }], (objects) => {
      for (const object of objects) if (object.ref.name === 'order') object.rowSecurity = 'unknown'
    })
    expect(generateForm(unknown, ORDER).notes.filter((note) => note.kind === 'access')).toEqual([
      { subject: 'order', kind: 'access', message: 'This connection cannot tell whether row-level security applies to sales.order: This account has no VIEW DEFINITION on the database.' },
    ])
  })

  // A view's own row security says nothing about its rows: SQL Server applies
  // its tables' policies through it, and PostgreSQL does for a
  // security_invoker view (B16). Nor do its own grants say a read succeeds: a
  // PostgreSQL view reads its tables with its owner's privileges, or the
  // reader's when security_invoker, and a read is refused 42501 without them
  // while the view's columns say SELECT (data-postgres's discovery-access
  // suite). Said on every view root, whatever it reports.
  test('a view root always gives an access note', () => {
    const notes = generateForm(PG, on('customer_summary')).notes.filter((note) => note.kind === 'access')
    expect(notes).toEqual([
      {
        subject: 'customer_summary',
        kind: 'access',
        message:
          'This snapshot does not follow sales.customer_summary to the tables behind it: SQL Server applies their row-level security through a view, and PostgreSQL does when the view is security_invoker, so rows they hide read as not found; and a read through it may need privileges on those tables that this snapshot does not describe, and be refused.',
      },
    ])
  })

  // The full-access owner's form gains nothing: no access note, and the
  // bindings the generator made before 0027 except for writes and version.
  test('with no row security and every privilege, no access note is given', () => {
    expect(orderForm(PG).notes.filter((note) => note.kind === 'access')).toEqual([])
    expect(orderForm(MS).notes.filter((note) => note.kind === 'access')).toEqual([])
  })

  // A person reviews the output, and a regeneration must change only what the
  // database changed: restrictions and notes come out in the same order every time.
  test('two runs are byte-identical', () => {
    const narrowed = () =>
      snapshot('sqlserver', (objects) => {
        restrict(objects, 'order', 'amount', { update: false })
        restrict(objects, 'order', 'notes', { select: false })
        for (const object of objects) if (object.ref.name === 'customer') object.rowSecurity = 'applies'
      })
    expect(canonicalize(generateForm(narrowed(), ORDER))).toBe(canonicalize(generateForm(narrowed(), ORDER)))
  })
})
