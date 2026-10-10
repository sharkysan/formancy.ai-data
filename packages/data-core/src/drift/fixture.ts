import { expect } from 'vitest'
import type { DatabaseKind } from '../adapter.js'
import { generateForm } from '../generate/generate.js'
import type { FormBindings, GenerationRequest } from '../generate/types.js'
import type { ColumnMeta, CoverageAspect, CoverageGap, CoverageSubject, DiscoveryAccount, ForeignKeyMeta, MetadataSnapshot, NormalizedType, ObjectMeta, ObjectRef, TextLengthUnit } from '../metadata.js'
import type { FormPolicy } from '../policy/types.js'
import { createSnapshot, findObject } from '../snapshot.js'
import { describedOf, diffRootDefinition, diffSnapshots as review } from './diff.js'
import type { DescribedRoot } from './diff.js'
import type { DriftChange, DriftKind, DriftReport } from './types.js'

/*
 * Test support shared by the drift suites, and nothing else. It is not part of
 * the package: tsdown bundles what `index.ts` reaches, and nothing there
 * imports this.
 *
 * A snapshot shaped like @formancy/data-fixtures' model, restated for the
 * reason generate.test.ts gives. Bindings come from generateForm, never from a
 * literal, so every test reviews what the generator would really publish.
 */

export const INT16: NormalizedType = { kind: 'integer', min: '-32768', max: '32767' }
export const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
export const INT64: NormalizedType = { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' }
// One length unit for every text: these suites test planning, not units, which codec.test.ts covers (0026).
export const text = (maxLength: number | null, fixedLength = false, lengthUnit: TextLengthUnit = 'utf16-code-units'): NormalizedType => ({ kind: 'text', maxLength, lengthUnit, fixedLength })
export const decimal = (precision: number, scale: number): NormalizedType => ({ kind: 'decimal', precision, scale })

export const ORDER_REF: ObjectRef = { schema: 'sales', name: 'order' }
/** In a schema of its own, so a narrowed scope can hide the lookup's target and not the root. */
export const CUSTOMER_REF: ObjectRef = { schema: 'crm', name: 'customer' }
export const EMPLOYEE_REF: ObjectRef = { schema: 'sales', name: 'employee' }
export const SUMMARY_REF: ObjectRef = { schema: 'sales', name: 'customer_summary' }

export function col(name: string, databaseType: string, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta {
  return { name, ordinal: 0, databaseType, type, nullable: false, hasDefault: false, defaultExpression: null, generated: 'none', comment: null, access: { select: true, insert: true, update: true }, ...extra }
}

export function table(name: string, columns: ColumnMeta[], extra: Partial<ObjectMeta> = {}): ObjectMeta {
  return {
    ref: { schema: 'sales', name },
    kind: 'table',
    comment: null,
    columns: columns.map((column, index) => ({ ...column, ordinal: index + 1 })),
    primaryKey: null,
    uniqueKeys: [],
    foreignKeys: [],
    checks: [],
    rowSecurity: 'none',
    ...extra,
  }
}

function foreignKeyTo(name: string, columns: string[], target: ObjectRef, targetColumns: string[]): ForeignKeyMeta {
  return { name, columns, references: { table: target, columns: targetColumns }, onUpdate: 'no-action', onDelete: 'no-action', enforced: true, validated: true }
}

/** The fixture's objects, built fresh on every call so one test's edit can never reach another. */
function model(kind: DatabaseKind): ObjectMeta[] {
  return [
    table(
      'customer',
      [col('tenant_id', 'int', INT32), col('customer_no', 'int', INT32), col('name', 'nvarchar(200)', text(200)), col('active', 'bit', { kind: 'boolean' }, { hasDefault: true, defaultExpression: '((1))' })],
      { ref: CUSTOMER_REF, primaryKey: { name: 'pk_customer', columns: ['tenant_id', 'customer_no'] } },
    ),
    table('employee', [col('id', 'int', INT32), col('name', 'nvarchar(200)', text(200))], { primaryKey: { name: 'pk_employee', columns: ['id'] } }),
    table(
      'order',
      [
        col('id', 'bigint', INT64, { generated: 'identity-always' }),
        col('tenant_id', 'int', INT32),
        col('customer_no', 'int', INT32),
        col('order_date', 'date', { kind: 'date' }),
        col('status', 'nvarchar(20)', text(20), { hasDefault: true, defaultExpression: "('placed')" }),
        col('amount', 'decimal(18,4)', decimal(18, 4)),
        col('notes', 'nvarchar(max)', text(null), { nullable: true }),
        col('created_by', 'int', INT32, { nullable: true }),
        col('paid', 'bit', { kind: 'boolean' }),
        col('attachment', 'varbinary(max)', { kind: 'binary', maxLength: null, fixedLength: false }, { nullable: true }),
        kind === 'sqlserver'
          ? col('row_version', 'rowversion', { kind: 'rowversion' }, { generated: 'rowversion' })
          : col('row_version', 'bigint', INT64, { hasDefault: true, defaultExpression: '0' }),
      ],
      {
        primaryKey: { name: 'pk_order', columns: ['id'] },
        foreignKeys: [
          foreignKeyTo('fk_order_customer', ['tenant_id', 'customer_no'], CUSTOMER_REF, ['tenant_id', 'customer_no']),
          foreignKeyTo('fk_order_created_by', ['created_by'], EMPLOYEE_REF, ['id']),
        ],
        checks: [{ name: 'ck_order_amount', expression: '([amount]>=(0))', enforced: true, validated: true }],
      },
    ),
    table('customer_summary', [col('tenant_id', 'int', INT32), col('customer_no', 'int', INT32), col('order_count', 'bigint', INT64)], { kind: 'view' }),
  ]
}

/** A policy whose lookups filter nothing: what drift is given when a test is not about filter columns. */
export const NO_FILTERS: Pick<FormPolicy, 'lookups'> = { lookups: {} }

export const OWNER: DiscoveryAccount = { user: 'owner', login: 'owner' }

export interface Options {
  gaps?: CoverageGap[]
  schemas?: string[]
  kind?: DatabaseKind
  serverVersion?: string
  account?: DiscoveryAccount
  /** The published policy's lookup filters, which drift compares by type on each target (0028). None by default. */
  policy?: Pick<FormPolicy, 'lookups'>
}

export function snapshot(edit: (objects: ObjectMeta[]) => void = () => {}, options: Options = {}): MetadataSnapshot {
  const kind = options.kind ?? 'sqlserver'
  const objects = model(kind)
  edit(objects)
  return createSnapshot({
    kind,
    serverVersion: options.serverVersion ?? '16.0.4125',
    account: options.account ?? OWNER,
    scope: { schemas: options.schemas ?? ['crm', 'sales'] },
    objects,
    gaps: options.gaps ?? [],
  })
}

export function object(objects: ObjectMeta[], name: string): ObjectMeta {
  const found = objects.find((candidate) => candidate.ref.name === name)
  expect(found, `the fixture has no ${name}`).toBeDefined()
  return found as ObjectMeta
}

export function column(objects: ObjectMeta[], tableName: string, name: string): ColumnMeta {
  const found = object(objects, tableName).columns.find((candidate) => candidate.name === name)
  expect(found, `the fixture's ${tableName} has no ${name}`).toBeDefined()
  return found as ColumnMeta
}

/** One of the order table's foreign keys. */
export function foreignKey(objects: ObjectMeta[], name: string): ForeignKeyMeta {
  const found = object(objects, 'order').foreignKeys.find((candidate) => candidate.name === name)
  expect(found, `the fixture's order has no ${name}`).toBeDefined()
  return found as ForeignKeyMeta
}

export function remove(objects: ObjectMeta[], name: string): void {
  objects.splice(objects.indexOf(object(objects, name)), 1)
}

export function dropColumn(objects: ObjectMeta[], tableName: string, name: string): void {
  const owner = object(objects, tableName)
  owner.columns = owner.columns.filter((candidate) => candidate.name !== name)
}

export function dropForeignKey(objects: ObjectMeta[], name: string): void {
  const order = object(objects, 'order')
  order.foreignKeys = order.foreignKeys.filter((candidate) => candidate.name !== name)
}

/** Append a column after the last one, as ALTER TABLE ... ADD does. */
export function addColumn(objects: ObjectMeta[], tableName: string, added: ColumnMeta): void {
  const owner = object(objects, tableName)
  owner.columns.push({ ...added, ordinal: Math.max(...owner.columns.map((existing) => existing.ordinal)) + 1 })
}

export function retype(objects: ObjectMeta[], tableName: string, name: string, databaseType: string, type: NormalizedType): void {
  Object.assign(column(objects, tableName, name), { databaseType, type })
}

/**
 * A gap about `target`: a subject as the contract writes it, or for brevity an
 * object (an `ObjectRef`) or the whole scope (`null`).
 */
export function gap(target: CoverageSubject | ObjectRef | null, aspect: CoverageAspect, detail = 'Hidden from this account.'): CoverageGap {
  const subject: CoverageSubject = target === null ? { kind: 'scope' } : 'kind' in target ? target : { kind: 'object', object: target }
  return { subject, aspect, detail }
}

/** Narrow what the account may do with one column, as a revoked grant would (0027). */
export function restrict(objects: ObjectMeta[], tableName: string, name: string, access: Partial<ColumnMeta['access']>): void {
  const found = column(objects, tableName, name)
  found.access = { ...found.access, ...access }
}

export const ORDER: GenerationRequest = {
  connection: 'erp',
  root: ORDER_REF,
  formId: 'sales-order',
  title: 'Order',
  lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
}
export const EMPLOYEE: GenerationRequest = { connection: 'erp', root: EMPLOYEE_REF, formId: 'sales-employee', title: 'Employee', lookups: [] }
export const SUMMARY: GenerationRequest = { connection: 'erp', root: SUMMARY_REF, formId: 'sales-summary', title: 'Summary', lookups: [] }

/** The order form's fields, in its order: what a change to the whole root affects. */
export const ORDER_FIELDS = ['id', 'customer', 'order_date', 'status', 'amount', 'notes', 'created_by', 'paid']

const refKey = (ref: ObjectRef): string => `${ref.schema}\u0000${ref.name}`

/**
 * Whether `current` differs from `base` only in the root's own definition --
 * its kind, columns, keys and foreign keys -- with the same gaps, account and
 * scope, every other object the same, and every column the base has keeping
 * its access and comment: what a request's description of the root holds. A
 * lookup through the root itself is excluded, because its target is the root.
 */
function onlyTheRootDefinition(base: MetadataSnapshot, current: MetadataSnapshot, root: ObjectRef, targets: readonly ObjectRef[]): boolean {
  if (base.kind !== current.kind || base.fingerprint === current.fingerprint) return false
  if (targets.some((target) => refKey(target) === refKey(root))) return false
  if (JSON.stringify([base.account, base.scope, base.gaps]) !== JSON.stringify([current.account, current.scope, current.gaps])) return false
  const others = (snapshot: MetadataSnapshot) => JSON.stringify(snapshot.objects.filter((object) => refKey(object.ref) !== refKey(root)))
  if (others(base) !== others(current)) return false
  const was = findObject(base, root)
  const is = findObject(current, root)
  if (was === undefined || is === undefined) return false
  if (was.comment !== is.comment || was.rowSecurity !== is.rowSecurity || JSON.stringify(was.checks) !== JSON.stringify(is.checks)) return false
  return was.columns.every((column) => {
    const now = is.columns.find((candidate) => candidate.name === column.name)
    return now === undefined || (now.comment === column.comment && JSON.stringify(now.access) === JSON.stringify(column.access))
  })
}

/**
 * `diffSnapshots`, held on every call the drift suites make to what the
 * runtime rests on (0041), so every report any of them builds is a case of
 * both:
 *
 * - The runtime is never stricter than review: whatever review allows -- a
 *   read, a create, an update -- the report's `runtime` allows. A runtime
 *   that refused more would refuse a form review calls usable.
 * - Where `current` differs from `base` only in the root's definition,
 *   `diffRootDefinition` over the root as `current` describes it gives the
 *   very report review gives: one decision, not two that agree today.
 */
export function diffSnapshots(base: MetadataSnapshot, current: MetadataSnapshot, bindings: FormBindings, policy: Pick<FormPolicy, 'lookups'>): DriftReport {
  const report = review(base, current, bindings, policy)
  const allows = (operation: 'read' | 'create' | 'update', verdict: { readable: boolean; writable: { create: boolean; update: boolean } }) =>
    operation === 'read' ? verdict.readable : verdict.writable[operation]
  for (const operation of ['read', 'create', 'update'] as const) {
    expect(!allows(operation, report) || allows(operation, report.runtime), `review allows ${operation} and the runtime refuses it: ${JSON.stringify(report.changes.map((change) => change.kind))}`).toBe(true)
  }
  const targets = bindings.fields.flatMap((binding) => (binding.kind === 'lookup' ? [binding.target.table] : []))
  if (onlyTheRootDefinition(base, current, bindings.root, targets)) {
    expect(diffRootDefinition(base, describedOf(current, bindings.root) as DescribedRoot, bindings, policy)).toEqual(report)
  }
  return report
}

/** Publish a form from `base`, then review it against a snapshot made by `edit`. */
export function drift(
  edit?: (objects: ObjectMeta[]) => void,
  options: Options = {},
  request: GenerationRequest = ORDER,
  base: MetadataSnapshot = snapshot(undefined, { kind: options.kind ?? 'sqlserver' }),
): DriftReport {
  const { bindings } = generateForm(base, request)
  return diffSnapshots(base, snapshot(edit, options), bindings, options.policy ?? NO_FILTERS)
}

export function kinds(report: DriftReport): DriftKind[] {
  return report.changes.map((change) => change.kind)
}

/** The one change a report holds, failing the test when it holds any other number. */
export function only(report: DriftReport): DriftChange {
  expect(kinds(report)).toHaveLength(1)
  return report.changes[0] as DriftChange
}

/** The name of a change's subject, or '' for an object or the scope. */
export function named(change: DriftChange): string {
  return 'name' in change.subject ? change.subject.name : ''
}
