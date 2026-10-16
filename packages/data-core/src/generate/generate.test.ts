import { createFormEngine, runScenarios } from '@formancy/core'
import type { FormSchema } from '@formancy/spec'
import { canonicalize } from '@formancy/spec'
import { validateSchema } from '@formancy/spec/validate'
import { describe, expect, test } from 'vitest'
import type { DatabaseKind } from '../adapter.js'
import { buildLookupConfig } from '../lookup/config.js'
import type { ColumnMeta, MetadataSnapshot, NormalizedType, ObjectMeta } from '../metadata.js'
import { createSnapshot, findObject } from '../snapshot.js'
import { generateForm } from './generate.js'
import type { GenerationRequest } from './types.js'

/*
 * A snapshot shaped like @formancy/data-fixtures' model. data-core cannot
 * depend on that package — it depends on this one — so the shape is restated
 * here, and the end-to-end path (discover a real database, generate, validate)
 * belongs to the adapter suites once both adapters can discover.
 *
 * Every text is counted in UTF-16 code units: these suites test planning, not
 * units, which codec.test.ts and controls.test.ts cover (0026).
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
    access: { select: true, insert: true, update: true },
    ...extra,
  }
}

function table(name: string, columns: ColumnMeta[], extra: Partial<ObjectMeta> = {}): ObjectMeta {
  return { ref: { schema: 'sales', name }, kind: 'table', comment: null, columns, primaryKey: null, uniqueKeys: [], foreignKeys: [], checks: [], rowSecurity: 'none', ...extra }
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
        col('id', INT32, { generated: 'identity-always' }),
        col('iso_code', { kind: 'text', maxLength: 2, lengthUnit: 'utf16-code-units', fixedLength: true }),
        col('name', { kind: 'text', maxLength: 100, lengthUnit: 'utf16-code-units', fixedLength: false }),
        col('flag', { kind: 'binary', maxLength: null, fixedLength: false }, { nullable: true }),
        col('shape', { kind: 'unsupported' }, { nullable: true, databaseType: 'point' }),
      ],
      { primaryKey: { name: 'pk_country', columns: ['id'] }, uniqueKeys: [{ name: 'uq_country_iso_code', columns: ['iso_code'] }] },
    ),
    table(
      'customer',
      [
        col('tenant_id', INT32),
        col('customer_no', INT32),
        col('name', { kind: 'text', maxLength: 200, lengthUnit: 'utf16-code-units', fixedLength: false }),
        col('country_code', { kind: 'text', maxLength: 2, lengthUnit: 'utf16-code-units', fixedLength: true }, { nullable: true }),
        col('credit_limit', { kind: 'decimal', precision: 14, scale: 2 }, { nullable: true }),
        col('active', { kind: 'boolean' }, { hasDefault: true }),
        col('created_at', { kind: 'timestamp', withTimeZone: true, precision: 6 }, { hasDefault: true }),
      ],
      { primaryKey: { name: 'pk_customer', columns: ['tenant_id', 'customer_no'] }, foreignKeys: [fk('fk_customer_country', ['country_code'], 'country', ['iso_code'])] },
    ),
    table(
      'employee',
      [col('id', INT32), col('name', { kind: 'text', maxLength: 200, lengthUnit: 'utf16-code-units', fixedLength: false }), col('manager_id', INT32, { nullable: true })],
      { primaryKey: { name: 'pk_employee', columns: ['id'] }, foreignKeys: [fk('fk_employee_manager', ['manager_id'], 'employee', ['id'])] },
    ),
    table(
      'order',
      [
        col('id', INT64, { generated: 'identity-always' }),
        col('tenant_id', INT32),
        col('customer_no', INT32),
        col('order_date', { kind: 'date' }),
        col('status', { kind: 'text', maxLength: 20, lengthUnit: 'utf16-code-units', fixedLength: false }, { hasDefault: true }),
        col('amount', { kind: 'decimal', precision: 18, scale: 4 }),
        col('notes', { kind: 'text', maxLength: null, lengthUnit: 'utf16-code-units', fixedLength: false }, { nullable: true }),
        col('group', { kind: 'text', maxLength: 50, lengthUnit: 'utf16-code-units', fixedLength: false }, { nullable: true }),
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
  return createSnapshot({ kind, serverVersion: 'x', account: { user: 'owner', login: 'owner' }, scope: { schemas: ['sales'] }, objects, gaps: [] })
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
 * the mode formancy's submission endpoint replays in. Driven directly rather
 * than through core's `runScenarios`, because these cases assert the codes
 * in the order the engine gives them, as one `toEqual` whose diff names
 * them; `runScenarios` compares them sorted and reports a sentence per
 * failure.
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
  //
  // And one that says spec 3 (0042): a host's renderer pinned at @formancy/*
  // 0.3.0 refuses a spec 4 document outright, so a generator that moved to 4
  // would break every such page at its next publish. The version is what
  // fails here -- validity does not, since the validator accepts spec 4 from
  // 0.4.0 on -- and the validator refusing a spec 4 construct in a spec 3
  // document is what keeps a valid one free of them. Watched failing with the
  // generator's version set to "4": this case, and no other in this file.
  test('every fixture object, on both engines, produces a spec 3 document formancy accepts', () => {
    for (const kind of ['postgres', 'sqlserver'] as const) {
      const snapshot = fixtureLike(kind)
      const requests = [...snapshot.objects.map((object) => ({ connection: 'erp', root: object.ref, formId: `f-${object.ref.name}`, title: object.ref.name, lookups: [] })), ORDER]
      for (const request of requests) {
        const result = generateForm(snapshot, request)
        expect(result.form.specVersion).toBe('3')
        valid(result)
      }
    }
  })

  // A person reviews the output and a regeneration must change only what the
  // database changed. Anything non-deterministic would show as a diff nobody made.
  test('is deterministic', () => {
    const first = generateForm(fixtureLike('postgres'), ORDER)
    const second = generateForm(fixtureLike('postgres'), ORDER)
    expect(canonicalize(second)).toBe(canonicalize(first))
  })

  // Bindings say per operation what a field writes since 0027, which is
  // version 2. For an account that may do everything, both operations are
  // what the one flag used to say: capabilities change nothing the owner gets.
  test('bindings are version 2, and with every privilege each field writes on both operations or on neither', () => {
    const { bindings } = generateForm(fixtureLike('sqlserver'), ORDER)
    expect(bindings.version).toBe(2)
    expect(bindings.fields.map((binding) => [binding.field, binding.writes])).toEqual([
      ['id', { create: false, update: false }],
      ['customer', { create: true, update: true }],
      ['order_date', { create: true, update: true }],
      ['status', { create: true, update: true }],
      ['amount', { create: true, update: true }],
      ['notes', { create: true, update: true }],
      ['group', { create: true, update: true }],
      ['created_by', { create: true, update: true }],
      ['approved_by', { create: true, update: true }],
    ])
  })

  // The composite foreign key is ONE choice, not two numbers somebody has to
  // keep consistent by hand. Its columns are not separate fields.
  test('a composite foreign key becomes one lookup field in place of its columns', () => {
    const { form, bindings } = generateForm(fixtureLike('postgres'), ORDER)
    const keys = form.model.fields.map((field) => field.key)
    expect(keys).not.toContain('tenant_id')
    expect(keys).not.toContain('customer_no')
    expect(keys.indexOf('customer')).toBe(1)
    expect(form.model.fields[1]).toMatchObject({ key: 'customer', type: 'select', optionsSource: 'erp-sales-order-fk-order-customer', widget: 'typeahead', required: true })
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

  // The one rule checked on one side only (0009, 0042): a whole-number field
  // is a bounded number with no `step`, which spec 3 does not have, so the
  // engine takes 1.5 in the browser and in the server's replay alike, and
  // only the server's codec refuses it (codec.test.ts, "refuses fractions").
  // A limitation the release report prints as held by this file, so it is
  // shown here rather than inferred from the absence of a property. Watched
  // failing with the generator writing `step: 1` at spec 4.
  test('a whole-number field takes a fraction in the engine, browser and server alike', () => {
    const { form } = generateForm(fixtureLike('postgres'), ORDER)
    const created = form.model.fields.find((field) => field.key === 'created_by')
    expect(created).toMatchObject({ type: 'number', min: -2147483648, max: 2147483647 })
    expect(created).not.toHaveProperty('step')
    const changes = { customer: 'k', order_date: '2026-10-08', status: 'placed', amount: '1.5', created_by: 1.5 }
    for (const mode of ['client', 'server'] as const) {
      expect(runScenarios(form, [{ name: 'a fraction', changes, valid: true }], { mode }), mode).toEqual([{ name: 'a fraction', passed: true, failures: [] }])
    }
  })

  // SQL Server's rowversion is generated by the database, so it is a proven
  // concurrency token and never a field. PostgreSQL's version column only
  // LOOKS like one; trusting a name is how a lost update happens.
  test('rowversion is a confirmed token; a version-looking column is a suggestion until confirmed', () => {
    const sqlServer = generateForm(fixtureLike('sqlserver'), ORDER)
    expect(sqlServer.bindings.concurrency).toEqual({ kind: 'rowversion', column: 'row_version', confirmed: true })
    expect(sqlServer.bindings.operations).toEqual({ create: true, update: true, delete: false })
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
      objects.push(table('document', [col('id', INT32), col('version', INT32), col('body', { kind: 'text', maxLength: null, lengthUnit: 'utf16-code-units', fixedLength: false })], {
        primaryKey: { name: 'pk_document', columns: ['id', 'version'] },
      }))
    })
    const { bindings } = generateForm(revisions, { ...ORDER, root: { schema: 'sales', name: 'document' }, lookups: [] })
    expect(bindings.concurrency).toBeNull()
    expect(bindings.fields.map((binding) => binding.field)).toEqual(['id', 'version', 'body'])
    expect(bindings.operations).toEqual({ create: true, update: false, delete: false })
  })

  // With no way to detect a stale save, an update could overwrite somebody
  // else's change silently. The form is then create-only, and says why.
  test('without a concurrency token, update is not offered and the reason is written down', () => {
    const { bindings, notes } = generateForm(fixtureLike('postgres'), { ...ORDER, root: { schema: 'sales', name: 'employee' }, lookups: [] })
    expect(bindings.concurrency).toBeNull()
    expect(bindings.operations).toEqual({ create: true, update: false, delete: false })
    expect(notes).toContainEqual(expect.objectContaining({ kind: 'blocked', message: expect.stringMatching(/stale save could not be detected/) }))
  })

  // Generated values are shown, never written, and grouped apart so a person
  // does not try to edit them.
  test('identity and computed columns are read-only, in their own section', () => {
    const { form, bindings } = generateForm(fixtureLike('sqlserver'), ORDER)
    expect(bindings.fields.find((binding) => binding.field === 'id')).toMatchObject({ writes: { create: false, update: false } })
    expect(form.logic?.rules).toContainEqual({ target: 'id', kind: 'disabled', cel: 'true' })
    const sections = form.layouts?.[0]?.nodes.map((node) => ('label' in node ? node.label : undefined))
    expect(sections).toEqual(['Order', 'Record'])
  })

  // A by-default identity would accept a number, and one chosen by hand is a
  // number the identity later hands out again: a create collides. So the form
  // never writes it, never requires it, and create stays offered because the
  // database fills it.
  test('a by-default identity is read-only, never required, and create is still offered', () => {
    const byDefault = fixtureLike('postgres', (objects) => {
      const id = objects.find((object) => object.ref.name === 'country')?.columns.find((column) => column.name === 'id')
      if (id !== undefined) id.generated = 'identity-by-default'
    })
    const { form, bindings, notes } = generateForm(byDefault, { ...ORDER, root: { schema: 'sales', name: 'country' }, lookups: [] })
    expect(form.model.fields.find((field) => field.key === 'id')).not.toHaveProperty('required')
    expect(bindings.fields.find((binding) => binding.field === 'id')).toMatchObject({ writes: { create: false, update: false } })
    expect(bindings.operations.create).toBe(true)
    expect(notes).toContainEqual({
      subject: 'id',
      kind: 'read-only',
      message:
        'The database numbers this value when a create leaves it out (identity-by-default). It would accept one, and the form never gives it: a number chosen by hand is one its sequence would later hand out again.',
    })
    const always = generateForm(fixtureLike('postgres'), { ...ORDER, root: { schema: 'sales', name: 'country' }, lookups: [] })
    expect(always.notes).toContainEqual({ subject: 'id', kind: 'read-only', message: 'The database numbers this value (identity-always) and refuses one given to it.' })
    // A computed column is not numbered, and a note saying so would mislead the reviewer.
    const computed = fixtureLike('postgres', (objects) => {
      const name = objects.find((object) => object.ref.name === 'country')?.columns.find((column) => column.name === 'name')
      if (name !== undefined) name.generated = 'computed'
    })
    const derived = generateForm(computed, { ...ORDER, root: { schema: 'sales', name: 'country' }, lookups: [] })
    expect(derived.notes).toContainEqual({ subject: 'name', kind: 'read-only', message: 'The database computes this value (computed).' })
  })

  // A key of one column whose default the database fills -- a uuid from
  // gen_random_uuid() or newsequentialid() -- is not generated by the
  // catalog's lights: the column would take a value. Offered as an optional
  // field, a create would write whatever a person typed as the record's
  // address. So the form shows it in the Record section and never writes it,
  // as it does an identity (0056), and create stays offered because the
  // database fills it. A composite key keeps every part a person gives: a
  // default on a line number is a first line, not an address.
  test("a one-column key the database fills by default is read-only, never required, and create is still offered", () => {
    const delivery = fixtureLike('postgres', (objects) => {
      objects.push(
        table(
          'delivery',
          [
            col('id', { kind: 'uuid' }, { hasDefault: true, defaultExpression: 'gen_random_uuid()' }),
            col('carrier', { kind: 'text', maxLength: 40, lengthUnit: 'utf16-code-units', fixedLength: false }),
            col('row_version', INT64, { hasDefault: true }),
          ],
          { primaryKey: { name: 'pk_delivery', columns: ['id'] } },
        ),
        table(
          'line',
          [col('order_id', INT64), col('line_no', INT32, { hasDefault: true, defaultExpression: '1' }), col('quantity', INT32)],
          { primaryKey: { name: 'pk_line', columns: ['order_id', 'line_no'] } },
        ),
      )
    })
    const { form, bindings, notes } = generateForm(delivery, { ...ORDER, root: { schema: 'sales', name: 'delivery' }, lookups: [], versionColumn: 'row_version' })
    expect(form.model.fields.find((field) => field.key === 'id')).not.toHaveProperty('required')
    expect(bindings.fields.find((binding) => binding.field === 'id')).toMatchObject({ writes: { create: false, update: false } })
    expect(bindings.identity).toEqual(['id'])
    // No delete: this snapshot does not say whether its account may (0050).
    expect(bindings.operations).toEqual({ create: true, update: true, delete: false })
    expect(form.logic?.rules).toContainEqual({ target: 'id', kind: 'disabled', cel: 'true' })
    expect(form.layouts?.[0]?.nodes.map((node) => ('label' in node ? node.label : undefined))).toEqual(['Delivery', 'Record'])
    expect(notes).toContainEqual({
      subject: 'id',
      kind: 'read-only',
      message: "The database fills this key by its default when a create leaves it out, and the form never gives it: a record's address is the database's to choose, as an identity's is.",
    })
    const line = generateForm(delivery, { ...ORDER, root: { schema: 'sales', name: 'line' }, lookups: [] })
    expect(line.bindings.fields.find((binding) => binding.field === 'line_no')).toMatchObject({ writes: { create: true, update: true } })
  })

  // The usual multi-tenant shape keys a row by its tenant and a uuid the
  // database fills: PRIMARY KEY (tenant_id, id). With the tenant pinned, the
  // context gives one part and the database the other, so nothing of the key
  // is the person's; a rule that asked for a key of one column offered the
  // uuid as an optional create field and an editable update field, and a
  // person could pick the record's address or move it (0056). What the pins
  // leave is the key the rule asks about. Without the pin the tenant is the
  // person's to give, so the key is theirs in part and the uuid is written,
  // as line_no is; and a pin that leaves two parts leaves the person's key.
  test('a key the pins leave at one column the database fills is never written; one the pins leave wider still is', () => {
    const delivery = fixtureLike('postgres', (objects) => {
      objects.push(
        table(
          'delivery',
          [
            col('tenant_id', INT32),
            col('id', { kind: 'uuid' }, { hasDefault: true, defaultExpression: 'gen_random_uuid()' }),
            col('carrier', { kind: 'text', maxLength: 40, lengthUnit: 'utf16-code-units', fixedLength: false }),
            col('row_version', INT64, { hasDefault: true }),
          ],
          { primaryKey: { name: 'pk_delivery', columns: ['tenant_id', 'id'] } },
        ),
        table(
          'leg',
          [col('tenant_id', INT32), col('route', INT32), col('id', { kind: 'uuid' }, { hasDefault: true, defaultExpression: 'gen_random_uuid()' }), col('stop', INT32)],
          { primaryKey: { name: 'pk_leg', columns: ['tenant_id', 'route', 'id'] } },
        ),
      )
    })
    const request = { ...ORDER, root: { schema: 'sales', name: 'delivery' }, lookups: [], versionColumn: 'row_version' }
    const writesOf = (generated: ReturnType<typeof generateForm>, field: string) => generated.bindings.fields.find((binding) => binding.field === field)?.writes
    const pinned = generateForm(delivery, { ...request, pinned: ['tenant_id'] })
    expect(pinned.bindings.identity).toEqual(['tenant_id', 'id'])
    expect(writesOf(pinned, 'id')).toEqual({ create: false, update: false })
    expect(pinned.form.model.fields.find((field) => field.key === 'id')).not.toHaveProperty('required')
    expect(pinned.bindings.operations).toEqual({ create: true, update: true, delete: false })
    expect(pinned.notes).toContainEqual(expect.objectContaining({ subject: 'id', kind: 'read-only', message: expect.stringMatching(/^The database fills this key/) }))
    expect(writesOf(generateForm(delivery, request), 'id')).toEqual({ create: true, update: true })
    const leg = generateForm(delivery, { ...ORDER, root: { schema: 'sales', name: 'leg' }, lookups: [], pinned: ['tenant_id'] })
    expect(writesOf(leg, 'id')).toMatchObject({ create: true })
  })

  // A sentence run through `labelFor` reads "java script" and "utc" in the
  // studio and on the examples page and loses its commas; the generator's own
  // wording must arrive as written, with only its first letter raised. The
  // database types are spelled as PostgreSQL's catalog spells them in the
  // captured fixture, so the note reads as a reviewer would see it.
  test("an inferred note is the generator's own sentence, with only its first letter raised", () => {
    const snapshot = fixtureLike('postgres', (objects) => {
      const spell = (table: string, column: string, databaseType: string): void => {
        const found = objects.find((object) => object.ref.name === table)?.columns.find((candidate) => candidate.name === column)
        if (found !== undefined) found.databaseType = databaseType
      }
      spell('order', 'id', 'bigint')
      spell('order', 'amount', 'numeric(18,4)')
      spell('customer', 'created_at', 'timestamp with time zone')
    })
    const inferred = (notes: ReturnType<typeof generateForm>['notes'], subject: string): string[] =>
      notes.filter((note) => note.subject === subject && note.kind === 'inferred').map((note) => note.message)

    const order = generateForm(snapshot, ORDER).notes
    expect(inferred(order, 'id')).toEqual(['A whole number held as text, because it can exceed what JavaScript represents exactly from bigint; label from the column name.'])
    expect(inferred(order, 'amount')).toEqual([expect.stringContaining('never as a floating-point number')])
    const customer = generateForm(snapshot, { ...ORDER, root: { schema: 'sales', name: 'customer' }, lookups: [] }).notes
    expect(inferred(customer, 'created_at')).toEqual([expect.stringContaining('in UTC')])
  })

  // The browser's maxLength is the column's rule for nvarchar only. For a UTF-8
  // varchar a reviewer must read that the server alone checks the bytes, or a
  // form that passes the browser and fails the save looks like a bug.
  test('a bounded text field says what its maxLength counts against the column', () => {
    const utf8 = fixtureLike('sqlserver', (objects) => {
      const name = objects.find((object) => object.ref.name === 'employee')?.columns.find((column) => column.name === 'name')
      if (name !== undefined) name.type = { kind: 'text', maxLength: 200, lengthUnit: 'utf8-bytes', fixedLength: false }
    })
    const { notes } = generateForm(utf8, { ...ORDER, root: { schema: 'sales', name: 'employee' }, lookups: [] })
    const said = notes.filter((note) => note.subject === 'name').map((note) => note.message)
    expect(said).toEqual([
      'Text from text; label from the column name.',
      expect.stringMatching(/^The column holds 200 bytes of UTF-8 .*Checked on the server only\.$/),
    ])
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
      objects.push(table('log', [col('message', { kind: 'text', maxLength: 100, lengthUnit: 'utf16-code-units', fixedLength: false }), col('row_version', { kind: 'rowversion' }, { generated: 'rowversion' })]))
      objects.push(
        table('code', [col('code', { kind: 'text', maxLength: 10, lengthUnit: 'utf16-code-units', fixedLength: false }), col('row_version', { kind: 'rowversion' }, { generated: 'rowversion' })], {
          uniqueKeys: [{ name: 'uq_code', columns: ['code'] }],
        }),
      )
    })
    const log = generateForm(keyless, { ...ORDER, root: { schema: 'sales', name: 'log' }, lookups: [] })
    expect(log.bindings.identity).toBeNull()
    expect(log.bindings.operations).toEqual({ create: true, update: false, delete: false })
    expect(log.notes).toContainEqual(expect.objectContaining({ kind: 'blocked', message: expect.stringMatching(/no primary or unique key/) }))
    expect(generateForm(keyless, { ...ORDER, root: { schema: 'sales', name: 'code' }, lookups: [] }).bindings.identity).toEqual(['code'])
  })

  // A view has no write path in the first release.
  test('a view generates a read-only form', () => {
    const { bindings, form } = generateForm(fixtureLike('postgres'), { ...ORDER, root: { schema: 'sales', name: 'customer_summary' }, lookups: [] })
    expect(bindings.operations).toEqual({ create: false, update: false, delete: false })
    expect(bindings.fields.every((binding) => !binding.writes.create && !binding.writes.update)).toBe(true)
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

/**
 * The fixture-like snapshot as discovery has taken one since 0049: the
 * order's lines beside it, whose key people type and which cascade from the
 * order, and on every object whether the account may delete from it and
 * every key that refers to it, derived from the foreign keys as the
 * fixture's comparators derive them.
 */
function withDeleteFacts(kind: DatabaseKind, edit: (objects: ObjectMeta[]) => void = () => {}, mayDelete: (object: ObjectMeta) => boolean = () => true): MetadataSnapshot {
  return fixtureLike(kind, (objects) => {
    objects.push(
      table(
        'order_line',
        [
          col('order_id', INT64),
          col('line_no', INT32),
          col('quantity', INT32),
          kind === 'sqlserver' ? col('row_version', { kind: 'rowversion' }, { generated: 'rowversion' }) : col('row_version', INT64, { hasDefault: true }),
        ],
        {
          primaryKey: { name: 'pk_order_line', columns: ['order_id', 'line_no'] },
          foreignKeys: [
            {
              name: 'fk_order_line_order',
              columns: ['order_id'],
              references: { table: { schema: 'sales', name: 'order' }, columns: ['id'] },
              onUpdate: 'no-action',
              onDelete: 'cascade',
              enforced: true,
              validated: true,
            },
          ],
        },
      ),
    )
    edit(objects)
    for (const object of objects) {
      object.access = { delete: object.kind === 'table' && mayDelete(object) }
      object.referencedBy = objects
        .flatMap((other) => other.foreignKeys.map((key) => ({ other, key })))
        .filter(({ key }) => key.references?.table.schema === object.ref.schema && key.references.table.name === object.ref.name)
        .map(({ other, key }) => ({
          table: { ...other.ref },
          name: key.name,
          columns: [...key.columns],
          referencedColumns: [...(key.references?.columns ?? [])],
          onDelete: key.onDelete,
          onUpdate: key.onUpdate,
          enforced: key.enforced,
        }))
        .sort((left, right) => (left.table.name < right.table.name ? -1 : left.table.name > right.table.name ? 1 : left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    }
  })
}

const LINE: GenerationRequest = {
  connection: 'erp',
  root: { schema: 'sales', name: 'order_line' },
  formId: 'sales-order-line',
  title: 'Order line',
  lookups: [{ foreignKey: 'fk_order_line_order', display: ['order_date'] }],
}

/** The generator's blocked notes that name delete. */
function deleteNotes(notes: ReturnType<typeof generateForm>['notes']): string[] {
  return notes.filter((note) => note.kind === 'blocked' && /delete/i.test(note.message)).map((note) => note.message)
}

/**
 * A delivery keyed by a uuid its default fills (0056), the default spelled
 * `expression` as the catalog would spell it -- `null` where the account may
 * not read the definition -- guarded by a version column or a rowversion;
 * `composite` puts a tenant before the uuid in the key.
 */
function deliveries(kind: DatabaseKind, expression: string | null, token: 'version-column' | 'rowversion' = 'version-column', composite = false): MetadataSnapshot {
  return withDeleteFacts(kind, (objects) => {
    objects.push(
      table(
        'delivery',
        [
          ...(composite ? [col('tenant_id', INT32)] : []),
          col('id', { kind: 'uuid' }, { hasDefault: true, defaultExpression: expression }),
          col('carrier', { kind: 'text', maxLength: 40, lengthUnit: 'utf16-code-units', fixedLength: false }),
          token === 'rowversion' ? col('row_version', { kind: 'rowversion' }, { generated: 'rowversion' }) : col('row_version', INT64, { hasDefault: true }),
        ],
        { primaryKey: { name: 'pk_delivery', columns: composite ? ['tenant_id', 'id'] : ['id'] } },
      ),
    )
  })
}

const DELIVERY: GenerationRequest = { ...ORDER, root: { schema: 'sales', name: 'delivery' }, lookups: [] }

describe('delete (0050)', () => {
  // A delete can be made against the order: a table, a key the database
  // numbers, a token that proves the record -- a rowversion, or a confirmed
  // version column -- and an account that may DELETE. What the delete also
  // does to order_line, whose key cascades from it, is the policy's to
  // accept (deleteProblems): the generator never reads referencedBy, so the
  // order form offers delete whatever refers to it, and one function decides
  // the reach (watched failing with delete offered only where update is and
  // nothing refers to the table).
  test('offers delete of an order on both engines, though order_line cascades from it', () => {
    const sqlServer = generateForm(withDeleteFacts('sqlserver'), ORDER)
    expect(sqlServer.bindings.operations).toEqual({ create: true, update: true, delete: true })
    expect(deleteNotes(sqlServer.notes)).toEqual([])
    const postgres = generateForm(withDeleteFacts('postgres'), { ...ORDER, versionColumn: 'row_version' })
    expect(postgres.bindings.operations).toEqual({ create: true, update: true, delete: true })
    expect(withDeleteFacts('postgres').objects.find((object) => object.ref.name === 'order')?.referencedBy).toEqual([
      expect.objectContaining({ name: 'fk_order_line_order', onDelete: 'cascade' }),
    ])
  })

  // A version column starts at its default on every insert, so a line
  // deleted at version 1 and created again under its typed key (order_id,
  // line_no) is at version 1 too, and a stale delete -- or one sent again
  // after a lost answer -- would land on the new line. SQL Server's
  // rowversion never repeats, so its lines may be deleted; PostgreSQL's may
  // not, and the note says why. A key the database numbers never comes back
  // from a form (0026): by-default counts, or `serial` would not (watched
  // failing with the version rule removed: PostgreSQL's lines offered delete).
  test('offers delete of a line where its version cannot restart: on SQL Server, not on PostgreSQL', () => {
    expect(generateForm(withDeleteFacts('sqlserver'), LINE).bindings.operations.delete).toBe(true)
    const postgres = generateForm(withDeleteFacts('postgres'), { ...LINE, versionColumn: 'row_version' })
    expect(postgres.bindings.operations).toEqual({ create: true, update: true, delete: false })
    expect(deleteNotes(postgres.notes)).toEqual([
      "Delete is not offered: a record of sales.order_line created again with a deleted record's key starts its row_version where the deleted one did, so a version cannot tell the two apart. A key with an identity column, a key of one column that gen_random_uuid() fills and no foreign key includes, or SQL Server's rowversion, can.",
    ])
    const serial = withDeleteFacts('postgres', (objects) => {
      objects.push(table('ticket', [col('id', INT32, { generated: 'identity-by-default', hasDefault: true }), col('note', { kind: 'text', maxLength: 50, lengthUnit: 'utf16-code-units', fixedLength: false }), col('row_version', INT64, { hasDefault: true })], {
        primaryKey: { name: 'pk_ticket', columns: ['id'] },
      }))
    })
    expect(generateForm(serial, { ...LINE, root: { schema: 'sales', name: 'ticket' }, lookups: [], versionColumn: 'row_version' }).bindings.operations.delete).toBe(true)
  })

  // A key the database fills by its default (0056) is never written by a
  // form, as a numbered one is not. Where it is the whole key, and the
  // default is the engine's own that never hands out one value twice --
  // gen_random_uuid() on PostgreSQL, newsequentialid() on SQL Server, as
  // each catalog spells it -- a record deleted is never created again under
  // its key, and a version column proves a record as it does over an
  // identity (0057). So a delivery guarded by a version column offers delete
  // on either engine, and one guarded by SQL Server's rowversion does
  // whatever its key. What the delete also does to its parcels is the
  // policy's (watched failing before the rule: PostgreSQL's delivery offered
  // no delete).
  test('offers delete where a version column guards a key of one column that the engine\'s never-repeating default fills', () => {
    const postgres = generateForm(deliveries('postgres', 'gen_random_uuid()'), { ...DELIVERY, versionColumn: 'row_version' })
    expect(postgres.bindings.fields.find((binding) => binding.field === 'id')?.writes).toEqual({ create: false, update: false })
    expect(postgres.bindings.operations).toEqual({ create: true, update: true, delete: true })
    expect(deleteNotes(postgres.notes)).toEqual([])
    const sqlServer = generateForm(deliveries('sqlserver', '(newsequentialid())'), { ...DELIVERY, versionColumn: 'row_version' })
    expect(sqlServer.bindings.operations).toEqual({ create: true, update: true, delete: true })
    expect(deleteNotes(sqlServer.notes)).toEqual([])
    const rowversion = generateForm(deliveries('sqlserver', '(newsequentialid())', 'rowversion'), DELIVERY)
    expect(rowversion.bindings.operations).toEqual({ create: true, update: true, delete: true })
  })

  // Any other default may hand out one value twice, or is not known not to:
  // a constant fills one record and then the same key again after a delete;
  // another function -- uuid_generate_v4(), newid() -- is not one this
  // release has named; a function of the database's own named like the
  // engine's, in another schema, is spelled with its schema and is a
  // different function; the other engine's spelling is not this engine's
  // default; a definition the account may not read says nothing; and a key
  // of two columns is one a form without the pin writes. Each is compared
  // as the catalog spells it, whole, never by a part of a name somebody can
  // choose (watched failing with every default on a one-column key counted:
  // all ten of one column offered delete, the hidden definition and the
  // other engine's spellings among them; with the expression matched by the
  // function's name inside it: the three lookalikes offered delete; and with
  // the one-column rule removed: both keys of two columns offered delete).
  test('offers no delete where the key\'s default is a constant, another function, a lookalike, hidden, or on a key of two columns', () => {
    const note = (kind: DatabaseKind) =>
      `Delete is not offered: a record of sales.delivery created again with a deleted record's key starts its row_version where the deleted one did, so a version cannot tell the two apart. A key with an identity column, a key of one column that ${kind === 'postgres' ? 'gen_random_uuid()' : 'newsequentialid()'} fills and no foreign key includes, or SQL Server's rowversion, can.`
    const cases: Array<[DatabaseKind, string | null, string?]> = [
      ['postgres', "'2b7e1516-28ae-4d2a-a6f7-15880945cf4f'::uuid"],
      ['postgres', 'uuid_generate_v4()'],
      ['postgres', 'minted.gen_random_uuid()'],
      ['postgres', 'public.gen_random_uuid()'],
      ['postgres', '(newsequentialid())'],
      ['sqlserver', "('2b7e1516-28ae-4d2a-a6f7-15880945cf4f')"],
      ['sqlserver', '(newid())'],
      ['sqlserver', '([minted].[newsequentialid]())'],
      ['sqlserver', 'gen_random_uuid()'],
      ['sqlserver', null],
      ['postgres', 'gen_random_uuid()', 'composite'],
      ['sqlserver', '(newsequentialid())', 'composite'],
    ]
    const generated = cases.map(([kind, expression, shape]) => {
      const { bindings, notes } = generateForm(deliveries(kind, expression, 'version-column', shape === 'composite'), {
        ...DELIVERY,
        versionColumn: 'row_version',
        ...(shape === 'composite' ? { pinned: ['tenant_id'] } : {}),
      })
      return { kind, expression, shape, operations: bindings.operations, notes: deleteNotes(notes) }
    })
    expect(generated).toEqual(cases.map(([kind, expression, shape]) => ({ kind, expression, shape, operations: { create: true, update: true, delete: false }, notes: [note(kind)] })))
  })

  // A key that is also a foreign key is one a form writes, whatever fills
  // it: a lookup over that key gives it the key of the record a person
  // chooses, so a note deleted at version 1 is created again under its key
  // the next time its delivery is chosen, at version 1 too, and a stale
  // delete lands on it. Any form over the table may offer that lookup, so
  // the default counts only where no foreign key of the table includes the
  // key column, whether this form looks up through it or not (watched
  // failing with the foreign key not asked: both forms offered delete on
  // both engines, and the lookup wrote the key on create).
  test('offers no delete where the key a never-repeating default fills is also a foreign key, looked up through or not', () => {
    const spelled = (kind: DatabaseKind) => (kind === 'postgres' ? 'gen_random_uuid()' : '(newsequentialid())')
    const noted = (kind: DatabaseKind): MetadataSnapshot =>
      withDeleteFacts(kind, (objects) => {
        const uuid = (name: string) => col(name, { kind: 'uuid' }, { hasDefault: true, defaultExpression: spelled(kind) })
        const text = (name: string) => col(name, { kind: 'text', maxLength: 40, lengthUnit: 'utf16-code-units', fixedLength: false })
        objects.push(
          table('delivery', [uuid('id'), text('carrier'), col('row_version', INT64, { hasDefault: true })], { primaryKey: { name: 'pk_delivery', columns: ['id'] } }),
          table('delivery_note', [uuid('id'), text('note'), col('row_version', INT64, { hasDefault: true })], {
            primaryKey: { name: 'pk_delivery_note', columns: ['id'] },
            foreignKeys: [
              {
                name: 'fk_delivery_note_delivery',
                columns: ['id'],
                references: { table: { schema: 'sales', name: 'delivery' }, columns: ['id'] },
                onUpdate: 'no-action',
                onDelete: 'no-action',
                enforced: true,
                validated: true,
              },
            ],
          }),
        )
      })
    const NOTE: GenerationRequest = { ...DELIVERY, root: { schema: 'sales', name: 'delivery_note' }, versionColumn: 'row_version' }
    const generated = (['postgres', 'sqlserver'] as const).flatMap((kind) =>
      [NOTE, { ...NOTE, lookups: [{ foreignKey: 'fk_delivery_note_delivery', display: ['carrier'] }] }].map((request) => {
        const { bindings, notes } = generateForm(noted(kind), request)
        const key = bindings.fields.find((binding) => binding.kind === 'lookup' || binding.field === 'id')
        return { kind, lookup: request.lookups.length > 0, keyCreated: key?.writes.create, delete: bindings.operations.delete, notes: deleteNotes(notes) }
      }),
    )
    const note = (kind: DatabaseKind) =>
      `Delete is not offered: a record of sales.delivery_note created again with a deleted record's key starts its row_version where the deleted one did, so a version cannot tell the two apart. A key with an identity column, a key of one column that ${kind === 'postgres' ? 'gen_random_uuid()' : 'newsequentialid()'} fills and no foreign key includes, or SQL Server's rowversion, can.`
    expect(generated).toEqual(
      (['postgres', 'sqlserver'] as const).flatMap((kind) => [
        { kind, lookup: false, keyCreated: false, delete: false, notes: [note(kind)] },
        { kind, lookup: true, keyCreated: true, delete: false, notes: [note(kind)] },
      ]),
    )
    // The table it refers to, whose key no foreign key includes, still offers delete.
    expect(generateForm(noted('postgres'), { ...DELIVERY, versionColumn: 'row_version' }).bindings.operations.delete).toBe(true)
  })

  // A form does not offer what its account cannot do (0027). The reader may
  // not DELETE; a snapshot taken before 0049 does not say, and is read as
  // "not offered" with a way out, never as "may". Each says why, once.
  test('offers no delete where the account may not DELETE, or the snapshot does not say whether it may', () => {
    const reader = generateForm(withDeleteFacts('sqlserver', () => {}, () => false), ORDER)
    expect(reader.bindings.operations.delete).toBe(false)
    expect(deleteNotes(reader.notes)).toEqual(["Delete is not offered: this connection's account may not DELETE from sales.order."])
    const before = generateForm(fixtureLike('sqlserver'), ORDER)
    expect(before.bindings.operations.delete).toBe(false)
    expect(deleteNotes(before.notes)).toEqual(['Delete is not offered: this snapshot was taken before it recorded whether its account may delete. Discover again.'])
  })

  // A delete names its record by the key and the version the person read,
  // as an update does, so what stops update for want of either stops delete
  // too, and the one note says both. A view has no write path at all.
  test('offers no delete without a key or a confirmed token, or on a view, saying so with update', () => {
    const facts = withDeleteFacts('postgres')
    const employee = generateForm(facts, { ...ORDER, root: { schema: 'sales', name: 'employee' }, lookups: [] })
    expect(employee.bindings.operations.delete).toBe(false)
    expect(deleteNotes(employee.notes)).toEqual(['Update and delete are not offered: no rowversion and no confirmed version column, so a stale save could not be detected.'])
    const inferred = generateForm(facts, ORDER)
    expect(deleteNotes(inferred.notes)).toEqual(['Update and delete are not offered until row_version is confirmed as a version column.'])
    const keyless = withDeleteFacts('sqlserver', (objects) => {
      objects.push(table('log', [col('message', { kind: 'text', maxLength: 100, lengthUnit: 'utf16-code-units', fixedLength: false }), col('row_version', { kind: 'rowversion' }, { generated: 'rowversion' })]))
    })
    const log = generateForm(keyless, { ...ORDER, root: { schema: 'sales', name: 'log' }, lookups: [] })
    expect(log.bindings.operations).toEqual({ create: true, update: false, delete: false })
    expect(deleteNotes(log.notes)).toEqual(['Update and delete are not offered: no primary or unique key identifies a record.'])
    const view = generateForm(facts, { ...ORDER, root: { schema: 'sales', name: 'customer_summary' }, lookups: [] })
    expect(view.bindings.operations).toEqual({ create: false, update: false, delete: false })
    expect(deleteNotes(view.notes)).toEqual([])
  })
})

describe('lookup controls (0066)', () => {
  /** The one lookup a generated form holds: its field, its binding and the note that says what it is. */
  function lookupOf(generated: ReturnType<typeof generateForm>) {
    const binding = generated.bindings.fields.find((candidate) => candidate.kind === 'lookup')
    if (binding === undefined) throw new Error('the form holds no lookup')
    const field = generated.form.model.fields.find((candidate) => candidate.key === binding.field)
    const notes = generated.notes.filter((note) => note.subject === binding.field && note.kind === 'inferred').map((note) => note.message)
    return { binding, field, notes }
  }

  // A plain select with a source asks once, with "", and lists one page: a
  // customer past it could never be chosen, though the server would search
  // its name. So a lookup showing a text or whole-number column is written
  // as a typeahead, and the note the reviewer reads before publishing says
  // which control and what a person's typing searches (watched failing on
  // main, which wrote no widget and named no control).
  test("a lookup a person can search is a typeahead, and its note says what typing searches", () => {
    for (const kind of ['postgres', 'sqlserver'] as const) {
      const { field, notes } = lookupOf(generateForm(fixtureLike(kind), ORDER))
      expect(field, kind).toEqual({ key: 'customer', type: 'select', label: 'Customer', optionsSource: 'erp-sales-order-fk-order-customer', widget: 'typeahead', required: true })
      expect(notes, kind).toEqual(['A lookup over fk_order_customer (tenant_id, customer_no), showing name of customer, drawn as a typeahead searching name; label from the table name.'])
      const both = lookupOf(generateForm(fixtureLike(kind), { ...ORDER, lookups: [{ foreignKey: 'fk_order_customer', display: ['customer_no', 'name'] }] }))
      expect(both.notes, kind).toEqual(['A lookup over fk_order_customer (tenant_id, customer_no), showing customer_no, name of customer, drawn as a typeahead searching customer_no, name; label from the table name.'])
    }
  })

  // A lookup showing only a date has nothing a search matches, and the
  // server refuses every typed search over it, 400 not-searchable
  // (`lookup/query.ts`). A typeahead there is a box whose every search
  // fails; a plain select at least lists the first page, and the note says
  // that a row past it cannot be chosen and what the administrator changes
  // to make it searchable (watched failing with the widget written for
  // every lookup).
  test('a lookup showing nothing a search matches is a plain select, and its note says what to show instead', () => {
    for (const kind of ['postgres', 'sqlserver'] as const) {
      const { field, notes } = lookupOf(generateForm(withDeleteFacts(kind), LINE))
      expect(field, kind).not.toHaveProperty('widget')
      expect(field, kind).toMatchObject({ key: 'order', type: 'select', optionsSource: 'erp-sales-order-line-fk-order-line-order' })
      expect(notes, kind).toEqual([
        'A lookup over fk_order_line_order (order_id), showing order_date of order, as a plain list of its first page: a search matches only text and whole-number columns and it shows neither, so a row past that page cannot be chosen; show a text or whole-number column to make it searchable; label from the table name.',
      ])
    }
  })

  // A label is its display columns' text, and a column with no text form --
  // bytes, a type with no codec, SQL Server's rowversion -- has none. The
  // config refuses a lookup that shows one, so a form published with it
  // answered every request for that list with an error, while its note
  // named a control: "a plain list of its first page" for flag alone, "a
  // typeahead searching name" beside name. The generator refuses it before
  // anything is published, in the words the config refuses it with, read
  // here from the config itself (watched failing with the generator
  // accepting such a display: both forms were generated).
  test('refuses a lookup that shows a column with no text form, in the words the config refuses it with', () => {
    for (const kind of ['postgres', 'sqlserver'] as const) {
      const snapshot = fixtureLike(kind)
      const customer: GenerationRequest = { connection: 'erp', root: { schema: 'sales', name: 'customer' }, formId: 'sales-customer', title: 'Customer', lookups: [{ foreignKey: 'fk_customer_country', display: ['name'] }] }
      const shown = generateForm(snapshot, customer)
      const { binding } = lookupOf(shown)
      const country = findObject(snapshot, { schema: 'sales', name: 'country' }) as ObjectMeta
      for (const column of country.columns.filter((candidate) => candidate.name === 'flag' || candidate.name === 'shape')) {
        const words = `display column ${column.name} is ${column.databaseType}, which has no text form for a label`
        for (const display of [[column.name], ['name', column.name]]) {
          const edited = { ...shown.bindings, fields: shown.bindings.fields.map((entry) => (entry === binding ? { ...binding, display } : entry)) }
          expect(() => buildLookupConfig(edited, binding.field, { snapshot }), `${kind} ${display.join(', ')}`).toThrow(`fk_customer_country (sales.country): ${words}`)
          expect(() => generateForm(snapshot, { ...customer, lookups: [{ foreignKey: 'fk_customer_country', display }] }), `${kind} ${display.join(', ')}`).toThrow(`fk_customer_country: ${words}`)
        }
      }
    }
  })

  // The generator decides the control and `buildLookupConfig` the search, and
  // a host draws the one and the server answers with the other: a typeahead
  // over a lookup the config does not search is a box whose every search is
  // refused, a select over one it does is a list that stops at a page, and a
  // lookup the config refuses is a control over a list that never comes. So
  // for every foreign key of the restated objects and every column of its
  // target shown alone, the config refuses no lookup the generator writes --
  // the generator refuses a column with no text form for a label: flag,
  // shape and SQL Server's row_version -- and the field is a typeahead
  // exactly when the config's default search is not empty. Both outcomes
  // are counted on each engine, and the refusals named, so a loop in which
  // every lookup threw, or none was generated, fails rather than passing
  // over nothing (watched failing with the generator drawing a typeahead for
  // text alone: customer_no is an integer, which the config searches; and
  // with the generator accepting a display with no text form: the config
  // refused flag, shape and row_version).
  //
  // It cannot catch a rule both share and get wrong: searchable.test.ts and
  // display.test.ts decide those. And it needs no version against a real
  // database on each engine: both sides read the same normalized kinds,
  // which the discovery conformance suites hold (0005).
  test('a lookup the generator writes is one the config builds, and a typeahead exactly when that config searches something', () => {
    for (const kind of ['postgres', 'sqlserver'] as const) {
      const snapshot = withDeleteFacts(kind)
      const typeahead: string[] = []
      const plain: string[] = []
      const notGenerated: string[] = []
      const notBuilt: string[] = []
      for (const root of snapshot.objects) {
        for (const foreignKey of root.foreignKeys) {
          const target = foreignKey.references === null ? undefined : findObject(snapshot, foreignKey.references.table)
          if (target === undefined) throw new Error(`${foreignKey.name} reaches no restated table`)
          for (const column of target.columns) {
            const shown = `${foreignKey.name}: ${column.name}`
            let generated: ReturnType<typeof generateForm>
            try {
              generated = generateForm(snapshot, { connection: 'erp', root: root.ref, formId: `f-${root.ref.name}`, title: root.ref.name, lookups: [{ foreignKey: foreignKey.name, display: [column.name] }] })
            } catch {
              notGenerated.push(shown)
              continue
            }
            const { binding, field } = lookupOf(generated)
            let searched: number
            try {
              searched = buildLookupConfig(generated.bindings, binding.field, { snapshot }).search.length
            } catch {
              notBuilt.push(shown)
              continue
            }
            expect(field?.widget === 'typeahead', `${kind} ${shown}`).toBe(searched > 0)
            ;(searched > 0 ? typeahead : plain).push(column.name)
          }
        }
      }
      expect(notBuilt, kind).toEqual([])
      expect(notGenerated, kind).toEqual([
        'fk_customer_country: flag',
        'fk_customer_country: shape',
        ...(kind === 'sqlserver' ? ['fk_order_line_order: row_version'] : []),
      ])
      expect(typeahead, kind).toEqual(expect.arrayContaining(['name', 'customer_no', 'iso_code']))
      expect(plain, kind).toEqual(expect.arrayContaining(['order_date', 'amount', 'credit_limit', 'active', 'created_at']))
    }
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
    expect(bindings.fields.find((binding) => binding.field === 'name')).toMatchObject({ writes: { create: false, update: false } })
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
