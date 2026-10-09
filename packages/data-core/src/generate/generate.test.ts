import { createFormEngine } from '@formancy/core'
import type { FormSchema } from '@formancy/spec'
import { canonicalize } from '@formancy/spec'
import { validateSchema } from '@formancy/spec/validate'
import { describe, expect, test } from 'vitest'
import type { DatabaseKind } from '../adapter.js'
import type { ColumnMeta, MetadataSnapshot, NormalizedType, ObjectMeta } from '../metadata.js'
import { createSnapshot } from '../snapshot.js'
import { generateForm } from './generate.js'
import type { GenerationRequest } from './types.js'

/*
 * A snapshot shaped like @formancy/data-fixtures' model. data-core cannot
 * depend on that package — it depends on this one — so the shape is restated
 * here, and the end-to-end path (discover a real database, generate, validate)
 * belongs to the adapter suites once both adapters can discover.
 */
const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const INT64: NormalizedType = { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' }

let ordinal = 0
function col(name: string, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta {
  ordinal += 1
  return {
    name,
    ordinal,
    databaseType: type.kind,
    type,
    nullable: false,
    hasDefault: false,
    defaultExpression: null,
    generated: 'none',
    comment: null,
    ...extra,
  }
}

function table(name: string, columns: ColumnMeta[], extra: Partial<ObjectMeta> = {}): ObjectMeta {
  return { ref: { schema: 'sales', name }, kind: 'table', comment: null, columns, primaryKey: null, uniqueKeys: [], foreignKeys: [], checks: [], ...extra }
}

function fixtureLike(kind: DatabaseKind, edit: (objects: ObjectMeta[]) => void = () => {}): MetadataSnapshot {
  ordinal = 0
  const fk = (name: string, columns: string[], target: string, targetColumns: string[]) => ({
    name,
    columns,
    references: { table: { schema: 'sales', name: target }, columns: targetColumns },
    onUpdate: 'no-action' as const,
    onDelete: 'no-action' as const,
    enforced: true,
    validated: true,
  })
  const objects: ObjectMeta[] = [
    table(
      'country',
      [
        col('id', INT32, { generated: 'identity' }),
        col('iso_code', { kind: 'text', maxLength: 2, fixedLength: true }),
        col('name', { kind: 'text', maxLength: 100, fixedLength: false }),
        col('flag', { kind: 'binary', maxLength: null }, { nullable: true }),
        col('shape', { kind: 'unsupported' }, { nullable: true, databaseType: 'point' }),
      ],
      { primaryKey: { name: 'pk_country', columns: ['id'] }, uniqueKeys: [{ name: 'uq_country_iso_code', columns: ['iso_code'] }] },
    ),
    table(
      'customer',
      [
        col('tenant_id', INT32),
        col('customer_no', INT32),
        col('name', { kind: 'text', maxLength: 200, fixedLength: false }),
        col('country_code', { kind: 'text', maxLength: 2, fixedLength: true }, { nullable: true }),
        col('credit_limit', { kind: 'decimal', precision: 14, scale: 2 }, { nullable: true }),
        col('active', { kind: 'boolean' }, { hasDefault: true }),
        col('created_at', { kind: 'timestamp', withTimeZone: true, precision: 6 }, { hasDefault: true }),
      ],
      { primaryKey: { name: 'pk_customer', columns: ['tenant_id', 'customer_no'] }, foreignKeys: [fk('fk_customer_country', ['country_code'], 'country', ['iso_code'])] },
    ),
    table(
      'employee',
      [col('id', INT32), col('name', { kind: 'text', maxLength: 200, fixedLength: false }), col('manager_id', INT32, { nullable: true })],
      { primaryKey: { name: 'pk_employee', columns: ['id'] }, foreignKeys: [fk('fk_employee_manager', ['manager_id'], 'employee', ['id'])] },
    ),
    table(
      'order',
      [
        col('id', INT64, { generated: 'identity' }),
        col('tenant_id', INT32),
        col('customer_no', INT32),
        col('order_date', { kind: 'date' }),
        col('status', { kind: 'text', maxLength: 20, fixedLength: false }, { hasDefault: true }),
        col('amount', { kind: 'decimal', precision: 18, scale: 4 }),
        col('notes', { kind: 'text', maxLength: null, fixedLength: false }, { nullable: true }),
        col('group', { kind: 'text', maxLength: 50, fixedLength: false }, { nullable: true }),
        col('created_by', INT32, { nullable: true }),
        col('approved_by', INT32, { nullable: true }),
        kind === 'sqlserver'
          ? col('row_version', { kind: 'rowversion' }, { generated: 'rowversion' })
          : col('row_version', INT64, { hasDefault: true }),
      ],
      {
        primaryKey: { name: 'pk_order', columns: ['id'] },
        foreignKeys: [
          fk('fk_order_customer', ['tenant_id', 'customer_no'], 'customer', ['tenant_id', 'customer_no']),
          fk('fk_order_created_by', ['created_by'], 'employee', ['id']),
          fk('fk_order_approved_by', ['approved_by'], 'employee', ['id']),
        ],
      },
    ),
    table('customer_summary', [col('tenant_id', INT32), col('customer_no', INT32), col('order_count', INT64)], { kind: 'view' }),
  ]
  edit(objects)
  return createSnapshot({ kind, serverVersion: 'x', scope: { schemas: ['sales'] }, objects, gaps: [] })
}

const ORDER: GenerationRequest = {
  connection: 'erp',
  root: { schema: 'sales', name: 'order' },
  formId: 'sales-order',
  title: 'Order',
  lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
}

/**
 * What the released engine says about one set of answers, in server mode —
 * the mode formancy's submission endpoint replays in. @formancy/core 0.3.0 has
 * no scenario runner yet, so the engine is driven directly.
 */
function serverErrors(form: FormSchema, answers: Record<string, unknown>): Record<string, string[]> {
  // A fixed clock: the engine never reads an ambient one, so a replay is identical.
  const capabilities = { now: () => 1_791_417_600_000, today: () => '2026-10-08', random: () => 0.5 }
  const engine = createFormEngine({ schema: form, mode: 'server', capabilities })
  for (const [key, value] of Object.entries(answers)) engine.setValue([key], value)
  const report = engine.validate()
  return Object.fromEntries(Object.entries(report.errors).filter(([, codes]) => codes.length > 0))
}

function valid(result: ReturnType<typeof generateForm>): void {
  const checked = validateSchema(result.form)
  expect(checked.valid ? [] : checked.errors).toEqual([])
}

describe('generateForm', () => {
  // A generated document that formancy's own validator refuses would fail at
  // publish, after a person had reviewed it. Every root in the fixture, on both
  // engines, must produce a document the released validator accepts.
  test('every fixture object, on both engines, produces a document formancy accepts', () => {
    for (const kind of ['postgres', 'sqlserver'] as const) {
      const snapshot = fixtureLike(kind)
      for (const object of snapshot.objects) {
        valid(generateForm(snapshot, { connection: 'erp', root: object.ref, formId: `f-${object.ref.name}`, title: object.ref.name, lookups: [] }))
      }
      valid(generateForm(snapshot, ORDER))
    }
  })

  // A person reviews the output and a regeneration must change only what the
  // database changed. Anything non-deterministic would show as a diff nobody made.
  test('is deterministic', () => {
    const first = generateForm(fixtureLike('postgres'), ORDER)
    const second = generateForm(fixtureLike('postgres'), ORDER)
    expect(canonicalize(second)).toBe(canonicalize(first))
  })

  // The composite foreign key is ONE choice, not two numbers somebody has to
  // keep consistent by hand. Its columns are not separate fields.
  test('a composite foreign key becomes one lookup field in place of its columns', () => {
    const { form, bindings } = generateForm(fixtureLike('postgres'), ORDER)
    const keys = form.model.fields.map((field) => field.key)
    expect(keys).not.toContain('tenant_id')
    expect(keys).not.toContain('customer_no')
    expect(keys.indexOf('customer')).toBe(1)
    expect(form.model.fields[1]).toMatchObject({ key: 'customer', type: 'select', optionsSource: 'erp-sales-order-fk-order-customer', required: true })
    expect(bindings.fields.find((binding) => binding.field === 'customer')).toMatchObject({
      kind: 'lookup',
      columns: ['tenant_id', 'customer_no'],
      target: { table: { schema: 'sales', name: 'customer' }, columns: ['tenant_id', 'customer_no'] },
      display: ['name'],
    })
  })

  // An exact decimal through a JavaScript number loses digits past the
  // fifteenth. numeric(18,4) has eighteen, so it travels as text with a
  // pattern the engine checks identically on both sides.
  test('exact decimals are text with an exact pattern, checked the same way by the engine in server mode', () => {
    const { form } = generateForm(fixtureLike('postgres'), ORDER)
    const amount = form.model.fields.find((field) => field.key === 'amount')
    expect(amount).toMatchObject({ type: 'text', pattern: '^-?[0-9]{1,14}(\\.[0-9]{1,4})?$', required: true })

    const base = { customer: 'k', order_date: '2026-10-08', status: 'placed', amount: '99999999999999.9999' }
    expect(serverErrors(form, base)).toEqual({})
    expect(serverErrors(form, { ...base, amount: '1.23456' })).toEqual({ amount: ['pattern'] })
    expect(serverErrors(form, { ...base, amount: '100000000000000' })).toEqual({ amount: ['pattern'] })
    expect(serverErrors(form, { ...base, amount: '1e3' })).toEqual({ amount: ['pattern'] })
    expect(serverErrors(form, { ...base, status: 'x'.repeat(21) })).toEqual({ status: ['maxLength'] })
  })

  // An integer past 2^53 cannot be a number field: the browser would round it
  // before anybody saw it.
  test('an integer wider than JavaScript can hold is text; one that fits is a bounded number', () => {
    const { form } = generateForm(fixtureLike('postgres', (objects) => {
      const order = objects.find((object) => object.ref.name === 'order')
      const id = order?.columns[0]
      if (id !== undefined) id.generated = 'none'
    }), { ...ORDER, lookups: [] })
    expect(form.model.fields.find((field) => field.key === 'id')).toMatchObject({ type: 'text', pattern: '^-?[0-9]{1,19}$' })
    expect(form.model.fields.find((field) => field.key === 'created_by')).toMatchObject({ type: 'number', min: -2147483648, max: 2147483647 })
  })

  // SQL Server's rowversion is generated by the database, so it is a proven
  // concurrency token and never a field. PostgreSQL's version column only
  // LOOKS like one; trusting a name is how a lost update happens.
  test('rowversion is a confirmed token; a version-looking column is a suggestion until confirmed', () => {
    const sqlServer = generateForm(fixtureLike('sqlserver'), ORDER)
    expect(sqlServer.bindings.concurrency).toEqual({ kind: 'rowversion', column: 'row_version', confirmed: true })
    expect(sqlServer.bindings.operations).toEqual({ create: true, update: true })
    expect(sqlServer.form.model.fields.map((field) => field.key)).not.toContain('row_version')

    const inferred = generateForm(fixtureLike('postgres'), ORDER)
    expect(inferred.bindings.concurrency).toEqual({ kind: 'version-column', column: 'row_version', confirmed: false })
    expect(inferred.bindings.operations.update).toBe(false)
    expect(inferred.notes).toContainEqual(expect.objectContaining({ kind: 'blocked', message: expect.stringMatching(/until row_version is confirmed/) }))

    const confirmed = generateForm(fixtureLike('postgres'), { ...ORDER, versionColumn: 'row_version' })
    expect(confirmed.bindings.concurrency).toEqual({ kind: 'version-column', column: 'row_version', confirmed: true })
    expect(confirmed.bindings.operations.update).toBe(true)
    expect(() => generateForm(fixtureLike('postgres'), { ...ORDER, versionColumn: 'notes' })).toThrow(/cannot be a version column/)
  })

  // Every update increments a version column (0015), so confirming one moves
  // whatever else it is. The key: every save would change the record's
  // address. A lookup's column: the lookup would be dropped without a word,
  // and a tenant in it would move with each save. These are the planner's
  // refusals too, made here so a confirmed column is never one the planner
  // turns away; the plan tests prove the planner's half.
  test('refuses to confirm a version column that is the key or a lookup’s column', () => {
    const employee = { ...ORDER, root: { schema: 'sales', name: 'employee' }, lookups: [] }
    expect(() => generateForm(fixtureLike('postgres'), { ...employee, versionColumn: 'id' })).toThrow(/id cannot be a version column: it is part of the record's key/)
    expect(() => generateForm(fixtureLike('postgres'), { ...employee, versionColumn: 'gone' })).toThrow(/gone cannot be a version column: employee has no such column/)
    expect(() => generateForm(fixtureLike('postgres'), { ...ORDER, versionColumn: 'tenant_id' })).toThrow(/tenant_id cannot be a version column: a field is bound to it/)
    // The same column with no lookup over it is neither, and can be confirmed.
    expect(generateForm(fixtureLike('postgres'), { ...ORDER, lookups: [], versionColumn: 'tenant_id' }).bindings.concurrency).toEqual({
      kind: 'version-column',
      column: 'tenant_id',
      confirmed: true,
    })
  })

  // A versioned-document table keys each revision by (id, version). The name
  // says version column; the key says otherwise. Suggested, it would be taken
  // out of the form and could never be confirmed; it stays a field instead.
  test('does not suggest a key column as a version column, however it is named', () => {
    const revisions = fixtureLike('postgres', (objects) => {
      objects.push(table('document', [col('id', INT32), col('version', INT32), col('body', { kind: 'text', maxLength: null, fixedLength: false })], {
        primaryKey: { name: 'pk_document', columns: ['id', 'version'] },
      }))
    })
    const { bindings } = generateForm(revisions, { ...ORDER, root: { schema: 'sales', name: 'document' }, lookups: [] })
    expect(bindings.concurrency).toBeNull()
    expect(bindings.fields.map((binding) => binding.field)).toEqual(['id', 'version', 'body'])
    expect(bindings.operations).toEqual({ create: true, update: false })
  })

  // With no way to detect a stale save, an update could overwrite somebody
  // else's change silently. The form is then create-only, and says why.
  test('without a concurrency token, update is not offered and the reason is written down', () => {
    const { bindings, notes } = generateForm(fixtureLike('postgres'), { ...ORDER, root: { schema: 'sales', name: 'employee' }, lookups: [] })
    expect(bindings.concurrency).toBeNull()
    expect(bindings.operations).toEqual({ create: true, update: false })
    expect(notes).toContainEqual(expect.objectContaining({ kind: 'blocked', message: expect.stringMatching(/stale save could not be detected/) }))
  })

  // Generated values are shown, never written, and grouped apart so a person
  // does not try to edit them.
  test('identity and computed columns are read-only, in their own section', () => {
    const { form, bindings } = generateForm(fixtureLike('sqlserver'), ORDER)
    expect(bindings.fields.find((binding) => binding.field === 'id')).toMatchObject({ writable: false })
    expect(form.logic?.rules).toContainEqual({ target: 'id', kind: 'disabled', cel: 'true' })
    const sections = form.layouts?.[0]?.nodes.map((node) => ('label' in node ? node.label : undefined))
    expect(sections).toEqual(['Order', 'Record'])
  })

  // A type with no codec is reported, never silently dropped; and a NOT NULL
  // column nobody can fill makes create impossible, which is said out loud.
  test('excluded columns are noted, and create is refused when a required column cannot be filled', () => {
    const { notes } = generateForm(fixtureLike('postgres'), { ...ORDER, root: { schema: 'sales', name: 'country' }, lookups: [] })
    expect(notes).toContainEqual({ subject: 'shape', kind: 'excluded', message: 'point: no tested codec exists for this type.' })
    expect(notes).toContainEqual(expect.objectContaining({ subject: 'flag', kind: 'excluded' }))

    const blocked = generateForm(
      fixtureLike('postgres', (objects) => {
        const country = objects.find((object) => object.ref.name === 'country')
        const shape = country?.columns.find((column) => column.name === 'shape')
        if (shape !== undefined) shape.nullable = false
      }),
      { ...ORDER, root: { schema: 'sales', name: 'country' }, lookups: [] },
    )
    expect(blocked.bindings.operations.create).toBe(false)
    expect(blocked.notes).toContainEqual(expect.objectContaining({ kind: 'blocked', message: expect.stringMatching(/shape must be given a value/) }))
  })

  // A nullable boolean has three answers. A checkbox would turn "unknown" into false.
  test('a nullable boolean gets three states, a NOT NULL one a checkbox', () => {
    const { form } = generateForm(
      fixtureLike('postgres', (objects) => {
        const customer = objects.find((object) => object.ref.name === 'customer')
        customer?.columns.push(col('vip', { kind: 'boolean' }, { nullable: true }))
      }),
      { ...ORDER, root: { schema: 'sales', name: 'customer' }, lookups: [] },
    )
    expect(form.model.fields.find((field) => field.key === 'active')?.type).toBe('checkbox')
    expect(form.model.fields.find((field) => field.key === 'vip')).toMatchObject({ type: 'radio', options: [{ value: 'true' }, { value: 'false' }] })
  })

  // formancy's datetime is a UTC instant; a zoned timestamp maps onto it. A
  // zoneless one would have to guess a zone to be written, so it is shown only.
  test('a zoned timestamp is a datetime; a zoneless one is read-only with the reason', () => {
    const { form, notes } = generateForm(
      fixtureLike('sqlserver', (objects) => {
        const customer = objects.find((object) => object.ref.name === 'customer')
        customer?.columns.push(col('visited', { kind: 'timestamp', withTimeZone: false, precision: 7 }, { nullable: true }))
      }),
      { ...ORDER, root: { schema: 'sales', name: 'customer' }, lookups: [] },
    )
    expect(form.model.fields.find((field) => field.key === 'created_at')?.type).toBe('datetime')
    expect(notes).toContainEqual(expect.objectContaining({ subject: 'visited', kind: 'read-only', message: expect.stringMatching(/guess a zone/) }))
  })

  // Without a key, "this record" means nothing: an update would have to name
  // a row by its values, and two identical rows would both change. A unique
  // key is an identity when there is no primary key.
  test('identity comes from the primary key, else a unique key, else update is refused', () => {
    const keyless = fixtureLike('sqlserver', (objects) => {
      objects.push(table('log', [col('message', { kind: 'text', maxLength: 100, fixedLength: false }), col('row_version', { kind: 'rowversion' }, { generated: 'rowversion' })]))
      objects.push(
        table('code', [col('code', { kind: 'text', maxLength: 10, fixedLength: false }), col('row_version', { kind: 'rowversion' }, { generated: 'rowversion' })], {
          uniqueKeys: [{ name: 'uq_code', columns: ['code'] }],
        }),
      )
    })
    const log = generateForm(keyless, { ...ORDER, root: { schema: 'sales', name: 'log' }, lookups: [] })
    expect(log.bindings.identity).toBeNull()
    expect(log.bindings.operations).toEqual({ create: true, update: false })
    expect(log.notes).toContainEqual(expect.objectContaining({ kind: 'blocked', message: expect.stringMatching(/no primary or unique key/) }))
    expect(generateForm(keyless, { ...ORDER, root: { schema: 'sales', name: 'code' }, lookups: [] }).bindings.identity).toEqual(['code'])
  })

  // A view has no write path in the first release.
  test('a view generates a read-only form', () => {
    const { bindings, form } = generateForm(fixtureLike('postgres'), { ...ORDER, root: { schema: 'sales', name: 'customer_summary' }, lookups: [] })
    expect(bindings.operations).toEqual({ create: false, update: false })
    expect(bindings.fields.every((binding) => !binding.writable)).toBe(true)
    expect(form.logic?.rules).toHaveLength(form.model.fields.length)
  })

  // Each of these is a request the generator cannot honour. Generating anyway
  // would hand a person a form that silently lacks what they asked for.
  test('refuses what it cannot honour, naming why', () => {
    const snapshot = fixtureLike('postgres')
    expect(() => generateForm(snapshot, { ...ORDER, root: { schema: 'sales', name: 'nope' } })).toThrow(/not in the snapshot/)
    expect(() => generateForm(snapshot, { ...ORDER, formId: 'has space' })).toThrow(/not one formancy accepts/)
    expect(() => generateForm(snapshot, { ...ORDER, lookups: [{ foreignKey: 'fk_nope', display: ['name'] }] })).toThrow(/no foreign key fk_nope/)
    expect(() => generateForm(snapshot, { ...ORDER, lookups: [{ foreignKey: 'fk_order_customer', display: ['nope'] }] })).toThrow(/no column nope/)
    expect(() => generateForm(snapshot, { ...ORDER, lookups: [{ foreignKey: 'fk_order_customer', display: [] }] })).toThrow(/at least one display column/)

    const hidden = fixtureLike('postgres', (objects) => {
      const order = objects.find((object) => object.ref.name === 'order')
      const customer = order?.foreignKeys.find((foreignKey) => foreignKey.name === 'fk_order_customer')
      if (customer !== undefined) customer.references = null
    })
    expect(() => generateForm(hidden, ORDER)).toThrow(/not visible to this connection/)

    const outside = fixtureLike('postgres', (objects) => {
      objects.splice(objects.findIndex((object) => object.ref.name === 'customer'), 1)
    })
    expect(() => generateForm(outside, ORDER)).toThrow(/outside the discovered scope/)
  })

  // Two lookups sharing a column would each try to set it on save.
  test('refuses two lookups that share a column', () => {
    const shared = fixtureLike('postgres', (objects) => {
      const order = objects.find((object) => object.ref.name === 'order')
      order?.foreignKeys.push({
        name: 'fk_order_tenant',
        columns: ['tenant_id'],
        references: { table: { schema: 'sales', name: 'customer' }, columns: ['tenant_id'] },
        onUpdate: 'no-action',
        onDelete: 'no-action',
        enforced: true,
        validated: true,
      })
    })
    expect(() =>
      generateForm(shared, { ...ORDER, lookups: [...ORDER.lookups, { foreignKey: 'fk_order_tenant', display: ['name'] }] }),
    ).toThrow(/tenant_id belongs to both fk_order_customer and fk_order_tenant/)
  })
})

describe('pinned columns', () => {
  // A column the policy pins comes from trusted context. As a writable,
  // required field it would demand an answer the policy then refuses as
  // over-posting, so it is shown and never written — and create still works,
  // because its value is never one nobody can fill.
  test('a pinned column is read-only, not required, and does not block create', () => {
    const { form, bindings, notes } = generateForm(fixtureLike('postgres'), {
      ...ORDER,
      root: { schema: 'sales', name: 'employee' },
      lookups: [],
      pinned: ['name'],
    })
    expect(form.model.fields.find((field) => field.key === 'name')).not.toHaveProperty('required')
    expect(bindings.fields.find((binding) => binding.field === 'name')).toMatchObject({ writable: false })
    expect(form.logic?.rules).toContainEqual({ target: 'name', kind: 'disabled', cel: 'true' })
    expect(notes).toContainEqual(expect.objectContaining({ subject: 'name', kind: 'read-only', message: expect.stringMatching(/Pinned by the policy/) }))
    expect(bindings.operations.create).toBe(true)
  })

  // A pin on a column the table does not have is a policy written for another
  // table; generating anyway would silently pin nothing.
  test('refuses to pin a column the root does not have, and a pinned column as the version column', () => {
    expect(() => generateForm(fixtureLike('postgres'), { ...ORDER, pinned: ['nope'] })).toThrow(/has no column nope to pin/)
    expect(() => generateForm(fixtureLike('postgres'), { ...ORDER, pinned: ['row_version'], versionColumn: 'row_version' })).toThrow(/cannot be a version column/)
  })
})
