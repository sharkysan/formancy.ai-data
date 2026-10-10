import { createSnapshot, EMPTY_PRESENTATION, generateForm } from '@formancy/data-core'
import type { ColumnMeta, FormPolicy, GenerationRequest, MetadataSnapshot, NormalizedType } from '@formancy/data-core'
import type { FormSchema } from '@formancy/spec'
import { schemaHash } from '@formancy/spec'
import { describe, expect, test } from 'vitest'
import type { BundleV1, BundleV2, PublishedBundle } from './bundle.js'
import { policyProblems, validateBundle } from './bundle.js'
import { generatedProblems } from './bundle-format2.js'

const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }

/**
 * A pattern for "begins with exactly this text". The text holds a generated
 * source name and dots, and in a template literal `\.` is a bare `.`, which
 * matches any character: the anchor checked less than it said. CodeQL found it.
 */
function startsWith(text: string): RegExp {
  return new RegExp(`^${text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
}

function column(name: string, ordinal: number, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta {
  return { name, ordinal, databaseType: type.kind, type, nullable: false, hasDefault: false, defaultExpression: null, generated: 'none', comment: null, access: { select: true, insert: true, update: true }, ...extra }
}

/** The employee table as discovered; `edit` narrows it as a revoked grant would. */
function snapshot(edit: (columns: ColumnMeta[]) => void = () => {}): MetadataSnapshot {
  const columns = [
    column('id', 1, INT32),
    column('tenant_id', 2, INT32),
    column('name', 3, { kind: 'text', maxLength: 200, lengthUnit: 'utf16-code-units', fixedLength: false }),
    column('row_version', 4, { kind: 'rowversion' }, { generated: 'rowversion' }),
  ]
  edit(columns)
  return createSnapshot({
    kind: 'sqlserver',
    serverVersion: '16.0',
    account: { user: 'dbo', login: 'sa' },
    scope: { schemas: ['sales'] },
    gaps: [],
    objects: [
      {
        ref: { schema: 'sales', name: 'employee' },
        kind: 'table',
        comment: null,
        columns,
        primaryKey: { name: 'pk_employee', columns: ['id'] },
        uniqueKeys: [],
        foreignKeys: [],
        checks: [],
        rowSecurity: 'none',
      },
    ],
  })
}

/** The request the employee form is generated from, as the proposal route normalises it. */
const REQUEST: GenerationRequest = { connection: 'erp', root: { schema: 'sales', name: 'employee' }, formId: 'employee', title: 'Employee', lookups: [], pinned: [] }

/** A bundle that is right in every way; each test breaks one thing. */
function good(taken: MetadataSnapshot = snapshot()): BundleV2 {
  const { form, bindings } = generateForm(taken, REQUEST)
  const policy: FormPolicy = {
    version: 1,
    operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
    fields: { id: { read: ['clerk'], write: ['clerk'] }, name: { read: ['clerk'], write: ['clerk'] }, tenant_id: { read: ['clerk'], write: [] } },
    rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
    lookups: {},
  }
  return { format: 2, connection: 'erp', generation: REQUEST, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot: taken }
}

/** The same bundle as published before 0030: no request, no base, no presentation. */
function before0030(): BundleV1 {
  const { generation: _generation, base: _base, presentation: _presentation, ...parts } = good()
  return { ...parts, format: 1 }
}

const copy = <T extends PublishedBundle>(bundle: T): T => JSON.parse(JSON.stringify(bundle)) as T

describe('validateBundle', () => {
  // The baseline: a generated form, its bindings, a fitting policy and the
  // snapshot they came from are publishable. A validator that refused this
  // would refuse every real publish.
  test('accepts a bundle generated and published as intended', () => {
    expect(validateBundle(good())).toEqual({ ok: true, bundle: good() })
  })

  // The store is files on a volume. An edited column type would reach the
  // planner, which trusts the snapshot it reads types from. Recomputing the
  // fingerprint is what notices.
  test('refuses a snapshot edited after it was taken', () => {
    const edited = copy(good())
    const name = edited.snapshot.objects[0]?.columns.find((entry) => entry.name === 'name')
    if (name !== undefined) name.type = { kind: 'text', maxLength: 4000, lengthUnit: 'utf16-code-units', fixedLength: false }
    const outcome = validateBundle(edited)
    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? [] : outcome.problems).toContainEqual(expect.stringMatching(/does not hash to its own fingerprint/))
  })

  // A bundle published before contract v2 (0026) holds text with no length
  // unit, and its fingerprint is its own, so the hash check passes. Served, it
  // would hand the planner a codec that counts in no unit.
  test('a bundle whose snapshot predates contract v2 is refused, not served', () => {
    const old = copy(good())
    const name = old.snapshot.objects[0]?.columns.find((entry) => entry.name === 'name')
    if (name?.type.kind === 'text') delete (name.type as { lengthUnit?: unknown }).lengthUnit
    const { fingerprint: _stale, ...rest } = old.snapshot
    // Rehashed as the contract hashes it, so only the shape is wrong.
    old.snapshot.fingerprint = schemaHash({ kind: rest.kind, account: rest.account.user, objects: rest.objects, gaps: rest.gaps })
    old.bindings.snapshotFingerprint = old.snapshot.fingerprint
    expect(validateBundle(old)).toEqual({
      ok: false,
      problems: ['the snapshot is not one a catalog could produce: sales.employee: column name has no text length unit'],
    })
  })

  // A bundle published before 0027 has version-1 bindings, whose one
  // `writable` flag cannot say which operation a field is written on, and a
  // snapshot with no account and no privileges. Its own fingerprint still
  // matches, so only the shape gives it away. Served, the runtime would read
  // `writes` that are not there; refused, with what the operator does about it.
  test('a bundle published before 0027 is refused with "republish", and its policy is not read against bindings it cannot fit', () => {
    const old = copy(good()) as unknown as {
      bindings: { version: number; fields: Array<Record<string, unknown>>; snapshotFingerprint: string }
      snapshot: { account?: unknown; fingerprint: string; objects: Array<{ rowSecurity?: unknown; columns: Array<{ access?: unknown }> }>; kind: string; gaps: unknown[] }
    }
    old.bindings.version = 1
    for (const field of old.bindings.fields) {
      field['writable'] = (field['writes'] as { create: boolean }).create
      delete field['writes']
    }
    delete old.snapshot.account
    for (const object of old.snapshot.objects) {
      delete object.rowSecurity
      for (const entry of object.columns) delete entry.access
    }
    old.snapshot.fingerprint = schemaHash({ kind: old.snapshot.kind, objects: old.snapshot.objects, gaps: old.snapshot.gaps })
    old.bindings.snapshotFingerprint = old.snapshot.fingerprint
    expect(validateBundle(old)).toEqual({
      ok: false,
      problems: [
        'the snapshot is not one a catalog could produce: sales.employee: column id has no access; it was taken before 0027',
        'bindings version 1 were published before 0027 (per-operation writes); republish the form',
      ],
    })
    // Bindings alone, from a current snapshot: the same remedy.
    const versionOne = copy(good())
    ;(versionOne.bindings as { version: number }).version = 1
    expect(validateBundle(versionOne)).toEqual({ ok: false, problems: ['bindings version 1 were published before 0027 (per-operation writes); republish the form'] })
  })

  // A tenant filter on a column the account may not read turns every request
  // into permission-denied once published; refused at publish, where the
  // administrator can still change the policy or the grant (0027). The same
  // for a lookup's filter on its target.
  test('a row filter on a column the account may not read is refused at publish', () => {
    const blind = good(
      snapshot((columns) => {
        const tenant = columns.find((entry) => entry.name === 'tenant_id')
        if (tenant !== undefined) tenant.access = { select: false, insert: true, update: true }
      }),
    )
    const outcome = validateBundle(blind)
    expect(outcome.ok ? [] : outcome.problems).toContainEqual("policy: rowFilters tenant_id is a column this connection's account may not read")
  })

  // The root's row filter is written from the trusted context on every
  // create (the planner's pinned values), so a filter on a column the account
  // may read and not INSERT turns every create into permission-denied. The
  // generator blocks create for a pin it was told of; a bundle posted
  // directly names its policy only here. A form that offers no create is
  // unaffected.
  test('a row filter on a column the account may not insert is refused while the form offers create', () => {
    const uninsertable = snapshot((columns) => {
      const tenant = columns.find((entry) => entry.name === 'tenant_id')
      // A default keeps create offered by the generator, which was not told the column is pinned.
      if (tenant !== undefined) Object.assign(tenant, { hasDefault: true, defaultExpression: '1', access: { select: true, insert: false, update: true } })
    })
    const offered = good(uninsertable)
    expect(offered.bindings.operations.create).toBe(true)
    const outcome = validateBundle(offered)
    expect(outcome.ok ? [] : outcome.problems).toEqual(["policy: rowFilters tenant_id is a column this connection's account may not insert, and every create writes it"])

    const readOnly = copy(offered)
    readOnly.bindings.operations.create = false
    readOnly.policy.operations.create = []
    expect(validateBundle(readOnly)).toMatchObject({ ok: true })
  })

  // A filter compares a column's canonical value exactly (0028), so one on a
  // boolean, a timestamp or a column the target lacks cannot be applied: the
  // planner refuses every request it scopes, and the form would be published
  // with a lookup that is 500 on every search. Refused at publish, by the
  // same rowFilterColumnProblem the planner and the studio ask.
  test('a lookup or root filter on a column a filter cannot compare is refused at publish, naming it', () => {
    const text = { kind: 'text', maxLength: 200, lengthUnit: 'utf16-code-units', fixedLength: false } as const
    const taken = createSnapshot({
      kind: 'sqlserver', serverVersion: '16.0', account: { user: 'dbo', login: 'sa' }, scope: { schemas: ['sales'] }, gaps: [],
      objects: [
        {
          ref: { schema: 'sales', name: 'customer' }, kind: 'table', comment: null,
          columns: [column('id', 1, INT32), column('name', 2, text), column('active', 3, { kind: 'boolean' }, { databaseType: 'bit' })],
          primaryKey: { name: 'pk_customer', columns: ['id'] }, uniqueKeys: [], foreignKeys: [], checks: [], rowSecurity: 'none',
        },
        {
          ref: { schema: 'sales', name: 'order' }, kind: 'table', comment: null,
          columns: [
            column('id', 1, INT32),
            column('customer_id', 2, INT32),
            column('placed_at', 3, { kind: 'timestamp', withTimeZone: true, precision: 7 }, { databaseType: 'datetimeoffset' }),
            column('row_version', 4, { kind: 'rowversion' }, { generated: 'rowversion' }),
          ],
          primaryKey: { name: 'pk_order', columns: ['id'] }, uniqueKeys: [],
          foreignKeys: [{ name: 'fk_order_customer', columns: ['customer_id'], references: { table: { schema: 'sales', name: 'customer' }, columns: ['id'] }, onUpdate: 'no-action', onDelete: 'no-action', enforced: true, validated: true }],
          checks: [], rowSecurity: 'none',
        },
      ],
    })
    const { form, bindings } = generateForm(taken, { connection: 'erp', root: { schema: 'sales', name: 'order' }, formId: 'order', title: 'Order', lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }] })
    const lookup = bindings.fields.find((binding) => binding.kind === 'lookup')?.field ?? ''
    const fields = Object.fromEntries(bindings.fields.map((binding) => [binding.field, { read: ['clerk'], write: ['clerk'] }]))
    const policy = (rowFilters: FormPolicy['rowFilters'], rules: FormPolicy['rowFilters']): FormPolicy => ({
      version: 1, operations: { read: ['clerk'], create: [], update: [] }, fields, rowFilters, lookups: { [lookup]: rules },
    })
    const bundle = (chosen: FormPolicy): BundleV1 => ({ format: 1, connection: 'erp', form, bindings, policy: chosen, snapshot: taken })

    expect(validateBundle(bundle(policy([], [{ column: 'id', attribute: 'tenant' }])))).toMatchObject({ ok: true })
    const flagged = validateBundle(bundle(policy([], [{ column: 'active', attribute: 'tenant' }, { column: 'region', attribute: 'tenant' }])))
    expect(flagged.ok ? [] : flagged.problems).toEqual([
      expect.stringMatching(startsWith(`policy: lookups.${lookup} active is bit, which a row filter cannot compare`)),
      `policy: lookups.${lookup} customer has no column region`,
    ])
    const stamped = validateBundle(bundle(policy([{ column: 'placed_at', attribute: 'tenant' }], [])))
    expect(stamped.ok ? [] : stamped.problems).toContainEqual(expect.stringMatching(/^policy: rowFilters placed_at is datetimeoffset, which a row filter cannot compare/))
  })

  // Bindings from one snapshot over another describe columns that may not exist.
  test('refuses bindings generated from another snapshot', () => {
    const mixed = copy(good())
    mixed.bindings.snapshotFingerprint = '0'.repeat(64)
    expect(validateBundle(mixed)).toMatchObject({ ok: false, problems: [expect.stringMatching(/not generated from this snapshot/)] })
  })

  // A rule nobody enforces is worse than no rule, because somebody believes it.
  test('refuses a policy that does not fit the bindings', () => {
    const loose = copy(good())
    loose.policy.fields['ghost'] = { read: ['clerk'], write: [] }
    expect(validateBundle(loose)).toMatchObject({ ok: false, problems: [expect.stringMatching(/^policy: .*ghost/)] })
  })

  // A form formancy cannot render, and bindings naming a field the form lacks.
  test('refuses a form formancy rejects, and a binding to a field the form does not have', () => {
    const broken = copy(good())
    const binding = broken.bindings.fields.find((entry) => entry.field === 'name')
    if (binding !== undefined) binding.field = 'ghost'
    const missing = validateBundle(broken)
    expect(missing.ok ? [] : missing.problems).toContainEqual(expect.stringMatching(/bindings name ghost, which the form does not have/))
    const invalid = copy(before0030()) as unknown as { form: { specVersion: string } }
    invalid.form.specVersion = '99'
    expect(validateBundle(invalid)).toMatchObject({ ok: false, problems: [expect.stringMatching(/^form: /)] })
  })

  // A stored version is held to the spec version the generator writes, on
  // every read as at publish (0042). @formancy/spec 0.4.0's validator accepts
  // a spec 4 document, and a host page whose renderer is at 0.3.0 refuses one
  // outright, so a version edited on the volume to spec 4 -- its base and form
  // alike, which every other read check compares -- would be served to it;
  // at 0.3.0 it was refused as corrupt. A spec 4 construct in a spec 3
  // document is refused with this server's reason, not upstream's advice to
  // change the document to "4", which this server would then refuse.
  // Watched failing before the check: the first edit validated, the second
  // was refused only as a form that is not its base, and the last two
  // carried upstream's advice.
  test('a form or base in a spec version other than the one the generator writes is refused', () => {
    const only = 'and this server publishes and serves only spec "3", the version it generates (0042)'
    const stepped = (form: FormSchema) => {
      const id = form.model.fields.find((field) => field.key === 'id')
      if (id !== undefined) id.step = 1
    }
    const four = copy(good())
    for (const form of [four.base, four.form]) {
      form.specVersion = '4'
      stepped(form)
    }
    expect(validateBundle(four)).toEqual({ ok: false, problems: [`form: is spec "4", ${only}`] })
    const base = copy(good())
    base.base.specVersion = '4'
    expect(validateBundle(base)).toEqual({ ok: false, problems: [`base: is spec "4", ${only}`] })
    const construct = copy(good())
    for (const form of [construct.base, construct.form]) stepped(form)
    expect(validateBundle(construct)).toEqual({ ok: false, problems: [`form: /model/fields/0/step needs spec "4", ${only}`] })
    const masked = copy(good())
    const name = masked.base.model.fields.find((field) => field.key === 'name')
    if (name !== undefined) name.mask = 'aaa'
    expect(validateBundle(masked)).toEqual({ ok: false, problems: [`base: /model/fields/2/mask needs spec "4", ${only}`] })
    // Every other refusal is still the validator's own sentence, and a form
    // that is not an object, or says no version, is the validator's to name.
    const misspelt = copy(good()) as unknown as { form: Record<string, unknown> }
    misspelt.form['colour'] = 'red'
    expect(validateBundle(misspelt)).toEqual({ ok: false, problems: ['form: Unknown property "colour". Check the spelling, or remove it.'] })
    const unversioned = copy(good()) as unknown as { base: Record<string, unknown> }
    delete unversioned.base['specVersion']
    expect(validateBundle(unversioned)).toEqual({ ok: false, problems: ['base: Missing required property "specVersion".'] })
    const absent = copy(good()) as unknown as { form: unknown }
    absent.form = null
    expect(validateBundle(absent)).toMatchObject({ ok: false, problems: [expect.stringMatching(/^form: /)] })
  })

  // Shapes a hand edit or a bad client could produce, each refused with a reason.
  test('refuses what is not a bundle at all', () => {
    expect(validateBundle(null)).toEqual({ ok: false, problems: ['a bundle is an object'] })
    expect(validateBundle([])).toEqual({ ok: false, problems: ['a bundle is an object'] })
    const partial = { ...copy(good()), format: 3, connection: '', policy: undefined }
    const outcome = validateBundle(partial)
    expect(outcome.ok ? [] : outcome.problems).toEqual(
      expect.arrayContaining(['format must be 1 or 2', 'connection must name a connection', 'snapshot, bindings and policy must all be present']),
    )
    const impossible = copy(good())
    impossible.snapshot.objects.push(copy(good()).snapshot.objects[0] as never)
    expect(validateBundle(impossible)).toMatchObject({ ok: false, problems: [expect.stringMatching(/not one a catalog could produce/)] })
  })
})

describe('a format-2 bundle (0030)', () => {
  // Every format-1 version already published is still served: refusing them
  // on read would take forms down on upgrade that nothing about the database
  // changed for. Format 1 cannot be regenerated, which the routes say.
  test('format 1 still validates', () => {
    expect(validateBundle(before0030())).toEqual({ ok: true, bundle: before0030() })
  })

  // The served form must be the base with its presentation applied. An edit
  // to any of the three on the volume would serve a form nobody published,
  // or carry to the next regeneration a patch over a base that never was.
  test('an edited form, base or presentation is refused on read', () => {
    const mismatch = 'form: is not the base with its presentation applied; the form, the base or the presentation was edited'
    const form = copy(good())
    form.form.title = 'Staff'
    expect(validateBundle(form)).toEqual({ ok: false, problems: [mismatch] })
    const base = copy(good())
    const named = base.base.model.fields.find((field) => field.key === 'name')
    if (named !== undefined) named.label = 'Full name'
    expect(validateBundle(base)).toEqual({ ok: false, problems: [mismatch] })
    const presentation = copy(good())
    presentation.presentation = { version: 1, fields: [{ field: 'name', anchor: { kind: 'column', column: 'name' }, label: 'Full name' }], sections: [] }
    expect(validateBundle(presentation)).toEqual({ ok: false, problems: [mismatch] })
    const anchored = copy(presentation)
    anchored.form = JSON.parse(JSON.stringify(anchored.form).replace('"Name"', '"Full name"')) as BundleV2['form']
    expect(validateBundle(anchored)).toMatchObject({ ok: true })
    const misanchored = copy(anchored)
    misanchored.presentation.fields[0] = { field: 'name', anchor: { kind: 'column', column: 'tenant_id' }, label: 'Full name' }
    expect(validateBundle(misanchored)).toEqual({ ok: false, problems: ['presentation: /fields/0/anchor: name stands for column name, not column tenant_id'] })
    // A base formancy rejects is named as the base's problem, and nothing is applied to it.
    const unrenderable = copy(good()) as unknown as { base: { specVersion: string } }
    unrenderable.base.specVersion = '99'
    const refused = validateBundle(unrenderable)
    expect(refused.ok ? [] : refused.problems).toEqual([expect.stringMatching(/^base: /)])
    const unread = copy(good()) as unknown as { presentation: { version: number } }
    unread.presentation.version = 2
    expect(validateBundle(unread)).toEqual({ ok: false, problems: ['presentation: version must be 1'] })
  })

  // A request for another connection would regenerate the form from another
  // database; one in a spelling the proposal route never produces says the
  // file was written by something other than this server.
  test('a generation request for another connection or form, or not in its normalised form, is refused', () => {
    const elsewhere = copy(good())
    elsewhere.generation.connection = 'crm'
    expect(validateBundle(elsewhere)).toEqual({ ok: false, problems: ['generation: names connection crm, and the bundle is bound to erp'] })
    const another = copy(good())
    another.generation.formId = 'staff'
    expect(validateBundle(another)).toEqual({ ok: false, problems: ['generation: names form staff, and the base is employee'] })
    const loose = copy(good()) as unknown as { generation: Record<string, unknown> }
    delete loose.generation['pinned']
    expect(validateBundle(loose)).toEqual({ ok: false, problems: ['generation: is not in its normalised form (lookups and pinned as lists, versionColumn only when given, nothing else)'] })
    const extra = copy(good()) as unknown as { generation: Record<string, unknown> }
    extra.generation['note'] = 'hello'
    expect(validateBundle(extra)).toMatchObject({ ok: false })
    const malformed = copy(good()) as unknown as { generation: Record<string, unknown> }
    Object.assign(malformed.generation, { connection: 1, root: 'sales.employee', title: 7, versionColumn: 1 })
    expect(validateBundle(malformed)).toEqual({
      ok: false,
      problems: ['generation: connection must name a connection', 'generation: root must be { schema, name }', 'generation: title must be text', 'generation: versionColumn must name a column'],
    })
    const missing = copy(good()) as unknown as Record<string, unknown>
    delete missing['generation']
    expect(validateBundle(missing)).toEqual({ ok: false, problems: ['generation: a generation request is an object'] })
  })

  // The stored request is what a regeneration generates from, and the
  // regenerated draft is checked at publish against that same request, so a
  // request edited by hand would reach the next version with nobody told.
  // Nothing here asks the generator: each property is one the request alone
  // decides, so a later release cannot make a stored version fail it.
  describe('a generation request that does not say what its base and bindings say is refused', () => {
    const ORDER_REQUEST: GenerationRequest = { connection: 'erp', root: { schema: 'sales', name: 'order' }, formId: 'order', title: 'Order', lookups: [{ foreignKey: 'fk_order_employee', display: ['name'] }], pinned: [], versionColumn: 'revision' }
    /** An order table with a lookup to employee and an application-maintained version column. */
    function ordered(request: GenerationRequest = ORDER_REQUEST): BundleV2 {
      const { fingerprint: _fingerprint, ...employee } = snapshot()
      const taken = createSnapshot({
        ...employee,
        objects: [
          ...employee.objects,
          {
            ref: { schema: 'sales', name: 'order' },
            kind: 'table',
            comment: null,
            columns: [column('id', 1, INT32), column('employee_id', 2, INT32), column('tenant_id', 3, INT32), column('revision', 4, INT32)],
            primaryKey: { name: 'pk_order', columns: ['id'] },
            uniqueKeys: [],
            foreignKeys: [{ name: 'fk_order_employee', columns: ['employee_id'], references: { table: { schema: 'sales', name: 'employee' }, columns: ['id'] }, onUpdate: 'no-action', onDelete: 'no-action', enforced: true, validated: true }],
            checks: [],
            rowSecurity: 'none',
          },
        ],
      })
      const { form, bindings } = generateForm(taken, request)
      const policy: FormPolicy = { version: 1, operations: { read: ['clerk'], create: [], update: [] }, fields: {}, rowFilters: [], lookups: { employee: [] } }
      return copy({ format: 2, connection: 'erp', generation: request, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot: taken })
    }
    const refused = (bundle: BundleV2) => {
      const result = validateBundle(bundle)
      return result.ok ? [] : result.problems
    }

    // The baseline the cases below break one property of.
    test('accepts the request its base and bindings were generated from', () => {
      expect(refused(ordered())).toEqual([])
    })

    // A retitled request would retitle the next version, unasked.
    test('a title the base does not have', () => {
      const bundle = ordered()
      bundle.generation.title = 'Payroll'
      expect(refused(bundle)).toEqual(['generation: is titled "Payroll", and the base "Order"'])
    })

    // A request over another table would regenerate the form over it, while
    // drift kept comparing the table the bindings name.
    test('a root the bindings do not name', () => {
      const bundle = ordered()
      bundle.generation.root = { schema: 'sales', name: 'employee' }
      expect(refused(bundle)).toEqual(['generation: names root sales.employee, and the bindings sales.order'])
    })

    // A confirmed version column is an administrator's word that every
    // writer increments it; one added or taken away by hand would give the
    // next version a concurrency strategy nobody confirmed, or take one away.
    test('a version column the bindings do not confirm, or one they confirm that the request does not give', () => {
      const other = ordered()
      other.generation.versionColumn = 'tenant_id'
      expect(refused(other)).toEqual(['generation: confirms version column tenant_id, and the bindings use revision'])
      const unconfirmed = ordered()
      delete unconfirmed.generation.versionColumn
      expect(refused(unconfirmed)).toEqual(['generation: confirms no version column, and the bindings use revision as a confirmed one'])
      // Confirmed by hand where the bindings use none: the next version would update with a strategy nobody confirmed.
      const { versionColumn: _confirmed, ...unasked } = ORDER_REQUEST
      const inferred = ordered(unasked)
      expect(inferred.bindings.concurrency).toBeNull()
      inferred.generation.versionColumn = 'revision'
      expect(refused(inferred)).toEqual(['generation: confirms version column revision, and the bindings use none'])
      // A rowversion is used whatever the request confirms, so a request that confirms a column beside one is what the generator was given.
      const beside = good()
      beside.generation = { ...beside.generation, versionColumn: 'tenant_id' }
      expect(refused(beside)).toEqual([])
      // An unreadable rowversion leaves none, and still sets the request's column aside.
      const unreadable = good(snapshot((columns) => { (columns[3] as ColumnMeta).access = { select: false, insert: false, update: false } }))
      unreadable.generation = { ...unreadable.generation, versionColumn: 'tenant_id' }
      unreadable.policy.operations.update = []
      expect(unreadable.bindings.concurrency).toBeNull()
      expect(refused(unreadable)).toEqual([])
    })

    // A pin says the column is written from the trusted context and never
    // from the form; a pin added by hand over a field the form writes would
    // turn that field read-only at the next regeneration, unasked.
    test('a pinned column whose field the form writes', () => {
      const bundle = ordered()
      bundle.generation.pinned = ['tenant_id']
      expect(refused(bundle)).toEqual(['generation: pins tenant_id, and its field tenant_id is written by the form'])
    })

    // Lookups are the request's own choice: one added, dropped or shown by
    // other columns by hand would change the next version's fields.
    test('a lookup the bindings do not have, or one they have that the request does not choose', () => {
      const shown = ordered()
      shown.generation.lookups = [{ foreignKey: 'fk_order_employee', display: ['tenant_id'] }]
      expect(refused(shown)).toEqual([
        'generation: chooses a lookup over fk_order_employee showing tenant_id, which the bindings do not have',
        'generation: the bindings have a lookup over fk_order_employee showing name, which it does not choose',
      ])
      const dropped = ordered()
      dropped.generation.lookups = []
      expect(refused(dropped)).toEqual(['generation: the bindings have a lookup over fk_order_employee showing name, which it does not choose'])
    })
  })

  // A bundle whose base the generator would not write could carry anything
  // a person typed into it, such as a relaxed maxLength, as if the database
  // had said so. Checked at publish, against this server's generator; never
  // on read, where a later generator would make every stored version
  // "corrupt".
  test("generatedProblems names a base or bindings that are not the generator's", () => {
    expect(generatedProblems(good())).toEqual([])
    const forged = copy(good())
    for (const form of [forged.base, forged.form]) {
      const named = form.model.fields.find((field) => field.key === 'name')
      if (named !== undefined) named.maxLength = 4000
    }
    expect(validateBundle(forged)).toMatchObject({ ok: true })
    expect(generatedProblems(forged)).toEqual(['base: is not what this server generates from the stored snapshot and generation request'])
    const bound = copy(good())
    const binding = bound.bindings.fields.find((entry) => entry.field === 'name')
    if (binding !== undefined) binding.nullable = true
    expect(generatedProblems(bound)).toEqual(['bindings: are not what this server generates from the stored snapshot and generation request'])
    const unknown = copy(good())
    unknown.generation.root = { schema: 'sales', name: 'nope' }
    expect(generatedProblems(unknown)).toEqual(['generation: sales.nope is not in the snapshot'])
  })

  // The regeneration route reports policy problems against the new bindings
  // with this function, and the publish check uses it too, so a policy the
  // one reports clean the other can never refuse.
  test('policyProblems is what validateBundle reports about a policy', () => {
    const loose = copy(good())
    loose.policy.fields['ghost'] = { read: ['clerk'], write: [] }
    loose.policy.rowFilters = [{ column: 'tenant_id', attribute: 'tenant' }, { column: 'region', attribute: 'tenant' }]
    const reported = validateBundle(loose)
    expect(reported.ok).toBe(false)
    expect(reported.ok ? [] : reported.problems).toEqual(policyProblems(loose.snapshot, loose.bindings, loose.policy))
    expect(policyProblems(loose.snapshot, loose.bindings, loose.policy)).toContainEqual('policy: fields.ghost: the form has no field ghost')
  })
})
