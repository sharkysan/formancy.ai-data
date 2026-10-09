import { createSnapshot, generateForm } from '@formancy/data-core'
import type { ColumnMeta, FormPolicy, MetadataSnapshot, NormalizedType } from '@formancy/data-core'
import { schemaHash } from '@formancy/spec'
import { describe, expect, test } from 'vitest'
import type { PublishedBundle } from './bundle.js'
import { validateBundle } from './bundle.js'

const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }

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

/** A bundle that is right in every way; each test breaks one thing. */
function good(taken: MetadataSnapshot = snapshot()): PublishedBundle {
  const { form, bindings } = generateForm(taken, {
    connection: 'erp',
    root: { schema: 'sales', name: 'employee' },
    formId: 'employee',
    title: 'Employee',
    lookups: [],
  })
  const policy: FormPolicy = {
    version: 1,
    operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
    fields: { id: { read: ['clerk'], write: ['clerk'] }, name: { read: ['clerk'], write: ['clerk'] }, tenant_id: { read: ['clerk'], write: [] } },
    rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
    lookups: {},
  }
  return { format: 1, connection: 'erp', form, bindings, policy, snapshot: taken }
}

const copy = (bundle: PublishedBundle): PublishedBundle => JSON.parse(JSON.stringify(bundle)) as PublishedBundle

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
    const invalid = copy(good()) as unknown as { form: { specVersion: string } }
    invalid.form.specVersion = '99'
    expect(validateBundle(invalid)).toMatchObject({ ok: false, problems: [expect.stringMatching(/^form: /)] })
  })

  // Shapes a hand edit or a bad client could produce, each refused with a reason.
  test('refuses what is not a bundle at all', () => {
    expect(validateBundle(null)).toEqual({ ok: false, problems: ['a bundle is an object'] })
    expect(validateBundle([])).toEqual({ ok: false, problems: ['a bundle is an object'] })
    const partial = { ...copy(good()), format: 2, connection: '', policy: undefined }
    const outcome = validateBundle(partial)
    expect(outcome.ok ? [] : outcome.problems).toEqual(
      expect.arrayContaining(['format must be 1', 'connection must name a connection', 'snapshot, bindings and policy must all be present']),
    )
    const impossible = copy(good())
    impossible.snapshot.objects.push(copy(good()).snapshot.objects[0] as never)
    expect(validateBundle(impossible)).toMatchObject({ ok: false, problems: [expect.stringMatching(/not one a catalog could produce/)] })
  })
})
