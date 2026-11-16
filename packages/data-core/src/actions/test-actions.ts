import type { ActionChoice } from './types.js'
import type { DatabaseKind } from '../adapter.js'
import { generateForm } from '../generate/generate.js'
import type { GeneratedForm, GenerationRequest } from '../generate/types.js'
import type { CoverageGap, MetadataSnapshot, NormalizedType, ObjectMeta } from '../metadata.js'
import type { FormPolicy } from '../policy/types.js'
import { ORDER_POLICY, sales, snapshot } from '../records/test-support.js'
import type { RoutineMeta, RoutineParameter } from '../routines.js'
import { createSnapshot } from '../snapshot.js'

/*
 * What the action suites share (0159), and nothing else uses: not exported
 * from the package. The fixture's order, as the planner's suites have it
 * (`records/test-support.ts`), discovered with routines: the order shipped
 * by `ship_order`, as the fixture's routine is (0158), and closed by
 * `close_order`, which takes one parameter from each kind of source.
 */

const INT4: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const INT8: NormalizedType = { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' }
const UNBOUNDED: NormalizedType = { kind: 'text', maxLength: null, lengthUnit: 'code-points', fixedLength: false }
const NUMERIC: NormalizedType = { kind: 'decimal', precision: null, scale: null }

/** PostgreSQL's oid for each built-in type these suites name, as its discovery's `ROUTINE_TYPES` keys it. */
const OID: Record<string, { typeId: string; databaseType: string; type: NormalizedType }> = {
  int8: { typeId: '20', databaseType: 'bigint', type: INT8 },
  int4: { typeId: '23', databaseType: 'integer', type: INT4 },
  text: { typeId: '25', databaseType: 'text', type: UNBOUNDED },
  date: { typeId: '1082', databaseType: 'date', type: { kind: 'date' } },
  bool: { typeId: '16', databaseType: 'boolean', type: { kind: 'boolean' } },
  uuid: { typeId: '2950', databaseType: 'uuid', type: { kind: 'uuid' } },
  numeric: { typeId: '1700', databaseType: 'numeric', type: NUMERIC },
  timestamp: { typeId: '1114', databaseType: 'timestamp without time zone', type: { kind: 'timestamp', withTimeZone: false, precision: 6 } },
}

/** A PostgreSQL parameter of a built-in type, in, without a default. */
export function pgParameter(name: string, type: keyof typeof OID, extra: Partial<RoutineParameter> = {}): RoutineParameter {
  const { typeId, databaseType, type: normalized } = OID[type] as (typeof OID)[string]
  return { name, mode: 'in', typeId, databaseType, type: normalized, hasDefault: false, ...extra }
}

/** A PostgreSQL function returning void, as its account may run it: its signature spelled from its parameters' types, as discovery spells it. */
export function pgRoutine(name: string, parameters: RoutineParameter[], extra: Partial<RoutineMeta> = {}): RoutineMeta {
  const spelled = Object.fromEntries(Object.entries(OID).map(([key, entry]) => [entry.typeId, key]))
  const signature = parameters
    .filter((parameter) => parameter.mode !== 'out' && parameter.mode !== 'table')
    .map((parameter) => `pg_catalog.${spelled[parameter.typeId] ?? 'unknown'}`)
    .join(', ')
  return {
    ref: { schema: 'sales', name, signature },
    kind: 'function',
    parameters,
    effects: 'writes',
    returns: 'void',
    result: null,
    reach: 'account',
    executable: true,
    ...extra,
  }
}

/** The fixture's routine (0158): an order shipped, by its id and its tenant. */
export const SHIP_ORDER = pgRoutine('ship_order', [pgParameter('order_id', 'int8'), pgParameter('tenant', 'int4')])

/** An order closed: its id, a reason and a date asked of the person, whether it is urgent, who closed it, and its amount as stored. */
export const CLOSE_ORDER = pgRoutine('close_order', [
  pgParameter('order_id', 'int8'),
  pgParameter('reason', 'text'),
  pgParameter('due', 'date'),
  pgParameter('urgent', 'bool'),
  pgParameter('closed_by', 'text'),
  pgParameter('amount', 'numeric'),
])

/** A SQL Server procedure: a T-SQL routine as discovery records it, `@` names, no signature, reaching as its owner. */
export function msRoutine(name: string, parameters: RoutineParameter[], extra: Partial<RoutineMeta> = {}): RoutineMeta {
  return {
    ref: { schema: 'sales', name, signature: '' },
    kind: 'procedure',
    parameters,
    effects: 'writes',
    returns: 'void',
    result: null,
    reach: 'owner',
    executable: true,
    ...extra,
  }
}

/** A SQL Server parameter: its type id as discovery spells one, `user_type_id:max_length:precision:scale`. */
export function msParameter(name: string, typeId: string, type: NormalizedType, databaseType: string): RoutineParameter {
  return { name, mode: 'in', typeId, databaseType, type, hasDefault: null }
}

/** `source`, discovered with routines: these, and these gaps beside its own. */
export function withRoutines(source: MetadataSnapshot, routines: RoutineMeta[], gaps: CoverageGap[] = []): MetadataSnapshot {
  return createSnapshot({
    kind: source.kind,
    serverVersion: source.serverVersion,
    account: source.account,
    scope: { schemas: source.scope.schemas, routines: true },
    objects: JSON.parse(JSON.stringify(source.objects)) as ObjectMeta[],
    gaps: [...source.gaps, ...gaps],
    routines,
  })
}

/** The planner's snapshot of `kind`, edited, discovered with `routines` -- the fixture's two by default. */
export function routineSnapshot(
  kind: DatabaseKind = 'postgres',
  routines: RoutineMeta[] = [SHIP_ORDER, CLOSE_ORDER],
  edit: (objects: ObjectMeta[]) => void = () => {},
): MetadataSnapshot {
  return withRoutines(snapshot(kind, edit), routines)
}

/** Ship an order: its id from the key, its tenant from the context. */
export const SHIP: ActionChoice = {
  name: 'ship',
  routine: SHIP_ORDER.ref,
  scope: 'record',
  parameters: [
    { parameter: 'order_id', from: { key: 'id' } },
    { parameter: 'tenant', from: { attribute: 'tenant' } },
  ],
}

/** Close an order: one parameter from each kind of source. */
export const CLOSE: ActionChoice = {
  name: 'close',
  routine: CLOSE_ORDER.ref,
  scope: 'record',
  parameters: [
    { parameter: 'order_id', from: { key: 'id' } },
    { parameter: 'reason', from: { input: 'reason' } },
    { parameter: 'due', from: { input: 'due' } },
    { parameter: 'urgent', from: { input: 'urgent' } },
    { parameter: 'closed_by', from: { actor: 'id' } },
    { parameter: 'amount', from: { field: 'amount' } },
  ],
}

/** The order form's request, as `orderForm` makes it, with these actions. */
export function orderRequest(source: MetadataSnapshot, actions: ActionChoice[] = [SHIP, CLOSE]): GenerationRequest {
  return {
    connection: 'erp',
    root: sales('order'),
    formId: 'sales-order',
    title: 'Order',
    lookups: [
      { foreignKey: 'fk_order_customer', display: ['name'] },
      { foreignKey: 'fk_order_created_by', display: ['name'] },
    ],
    ...(source.kind === 'postgres' ? { versionColumn: 'row_version' } : {}),
    actions,
  }
}

/** The order form generated with these actions. */
export function actionForm(source: MetadataSnapshot = routineSnapshot(), actions: ActionChoice[] = [SHIP, CLOSE]): GeneratedForm {
  return generateForm(source, orderRequest(source, actions))
}

/** The order policy with clerks granted both actions: what a clerk reads includes the amount `close` passes. */
export const ACTION_POLICY: FormPolicy = { ...ORDER_POLICY, actions: { ship: { roles: ['clerk', 'auditor'] }, close: { roles: ['clerk'] } } }
