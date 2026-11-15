import type { WriteScope } from '../generate/offers.js'
import type { Together } from '../generate/together.js'
import { scopeRowFilters } from '../lookup/filters.js'
import type { RowFilters } from '../lookup/types.js'
import { lookupRowFilter } from '../policy/evaluate.js'
import type { FormPolicy, PolicyContext } from '../policy/types.js'
import type { SaveChange, SavePart } from '../save.js'
import { findObject } from '../snapshot.js'
import type { PublishedTable } from './children.js'
import { planDelete } from './delete.js'
import { planCreate, planUpdate, readAnswers } from './plan.js'
import type { FieldError, FormRecord, MembershipCheck, PlanRefusal } from './plan-types.js'
import { prepare, refuse } from './prepare.js'
import type { PlannedSaveStep, SaveChild, SavePlanRefusal } from './save-types.js'
import { filtersFor, throughFor } from './scope.js'
import type { ColumnMeta } from '../metadata.js'
import type { DeleteRequest, DescribedTable, InsertRequest, RecordColumn, Through, UpdateRequest } from './types.js'

/*
 * One together child's steps in a save (0155): each change planned by
 * today's planner, under the child form's own policy, in the save's scope,
 * and the child's `within` and count. The record's key is not asked here:
 * `planSave` pins every step to it.
 */

/** A published form as a save plans one of its parts: the bundle the menu reads, with its policy. */
export interface SaveBundle extends PublishedTable {
  policy: FormPolicy
}

/** One child the save changes, as the route read it before the transaction. */
export interface SaveChildInput {
  form: string
  field: string
  bundle: SaveBundle
  changes: readonly SaveChange[]
  /**
   * Over a saved record, the record's rows as this person reads them, at
   * most `max + 1` of them (`planSaveList`), and the table as that list
   * described it; under a new record, which has no rows, the child's table
   * described.
   */
  read: { rows: readonly FormRecord[]; described: DescribedTable }
}

/** One child's steps planned, every field error of its rows, or the refusal of one of its parts. */
export type ChildPlan =
  | {
      ok: true
      child: Omit<SaveChild, 'parent'>
      /** The child's foreign-key columns onto the record, typed from its snapshot, in the foreign key's order: what `parent` pairs with the record's key. */
      columns: RecordColumn[]
      steps: PlannedSaveStep[]
      memberships: Array<{ at: SavePart; check: MembershipCheck }>
      errors: Array<{ at: SavePart; fieldErrors: FieldError[] }>
    }
  | SavePlanRefusal

/** The child's count, under its read filters and throughs -- every row of the record a person who may save its rows reads -- and its foreign-key columns onto the record. */
function countScope(
  input: SaveChildInput,
  together: Together,
  context: PolicyContext,
): { ok: true; filters: RowFilters; through: Through[]; columns: RecordColumn[] } | SavePlanRefusal {
  const { snapshot, bindings, policy } = input.bundle
  const at: SavePart = { form: input.form, field: input.field }
  const ready = prepare(snapshot, bindings)
  if (!ready.ok) return { ...ready, at }
  const filters = filtersFor(ready.prepared, policy, context, 'read')
  if (!filters.ok) return { ...filters, at }
  const through = throughFor(snapshot, bindings, ready.prepared, policy, context, 'read')
  if (!through.ok) return { ...through, at }
  const columns = together.binding.columns.map((name) => ({ name, type: (ready.prepared.columns.get(name) as ColumnMeta).type }))
  return { ok: true, filters: filters.filters, through: through.through, columns }
}

/** The child's `within`: the record under the together lookup's filter for a create, scoped on the record's table as a membership check of it would be. */
function withinScope(input: SaveChildInput, together: Together, context: PolicyContext): { ok: true; within: SaveChild['within'] } | SavePlanRefusal {
  const { snapshot, bindings, policy } = input.bundle
  const at: SavePart = { form: input.form, field: input.field }
  const filter = lookupRowFilter(policy, context, bindings, 'create', input.field)
  if (!filter.ok) return { ...filter, at }
  const target = findObject(snapshot, together.binding.target.table)
  if (target === undefined) return { ...refuse('invalid-bindings', `${input.field} references a table its snapshot does not have.`), at }
  const scoped = scopeRowFilters(target, filter.filter, `lookups.${input.field}`)
  if (!scoped.ok) return { ...scoped, at }
  return { ok: true, within: { target: { ...target.ref }, filters: scoped.filters } }
}

/**
 * A row's answers on an update, less the field that names its record: the
 * page may send it back as it read it -- the record's own token, or the
 * row's own value as listed, which a collation that ignores case may spell
 * otherwise (children.ts) -- and it is dropped; any other value would move
 * the row to another record, past either one's bound, and is over-posting
 * (0011, 0022). Answers that are not an object are refused as an update
 * alone refuses them.
 */
function withoutRecordField(answers: unknown, field: string, record: string, row: FormRecord): { ok: true; answers: Record<string, unknown> } | PlanRefusal {
  const read = readAnswers(answers)
  if (!read.ok) return read
  const kept = Object.fromEntries([...read.answers].filter(([key]) => key !== field))
  if (!read.answers.has(field)) return { ok: true, answers: kept }
  const sent = read.answers.get(field)
  if (sent !== record && sent !== row.answers[field]) {
    return refuse('over-posting', `${field} names the record this row is saved with, and a save never moves a row to another`)
  }
  return { ok: true, answers: kept }
}

/** One change planned: its request, the part it is, and the fields its answer may show and the selections to recheck; or its field errors. */
type ChangePlan =
  | { ok: true; kind: 'delete'; at: SavePart; request: DeleteRequest; fields: string[]; memberships: MembershipCheck[] }
  | { ok: true; kind: 'update'; at: SavePart; request: UpdateRequest; fields: string[]; memberships: MembershipCheck[] }
  | { ok: true; kind: 'create'; at: SavePart; request: InsertRequest; fields: string[]; memberships: MembershipCheck[] }
  | { ok: true; kind: 'errors'; at: SavePart; fieldErrors: FieldError[] }
  | SavePlanRefusal

/**
 * One change of the child, by today's planner in the save's scope
 * (`offeredFor`) under the child form's own policy: a delete by
 * `planDelete`, an update by `planUpdate` with the row as listed for its
 * `asRead` (0040), a create by `planCreate`, which supplies the record's
 * field. A token the record's list does not hold is `not-found` at its
 * part: another record's row, or one this person may not read. Over a new
 * record, `record` is `null` and the list holds nothing.
 */
function planChange(input: SaveChildInput, change: SaveChange, record: string | null, context: PolicyContext): ChangePlan {
  const { snapshot, bindings, policy } = input.bundle
  const { form, field, read } = input
  const scope: WriteScope = { save: field }
  const listed = (token: string): FormRecord | undefined => (record === null ? undefined : read.rows.find((row) => row.record === token))
  const notFound = (at: SavePart): SavePlanRefusal => ({ ok: false, code: 'not-found', message: `${form} holds no such row of this record.`, at })
  if ('delete' in change) {
    const at: SavePart = { form, field, record: change.delete.record }
    if (listed(change.delete.record) === undefined) return notFound(at)
    const planned = planDelete(snapshot, bindings, policy, context, change.delete.record, change.delete.version, read.described, scope)
    return planned.ok ? { ok: true, kind: 'delete', at, request: planned.request, fields: [], memberships: [] } : { ...planned, at }
  }
  if ('update' in change) {
    const { record: token, version, answers } = change.update
    const at: SavePart = { form, field, record: token }
    const row = listed(token)
    if (row === undefined) return notFound(at)
    const kept = withoutRecordField(answers, field, record as string, row)
    if (!kept.ok) return { ...kept, at }
    const planned = planUpdate(snapshot, bindings, policy, context, token, version, kept.answers, row, read.described, { scope })
    if (planned.ok) return { ok: true, kind: 'update', at, request: planned.request, fields: planned.fields, memberships: planned.memberships }
    return planned.code === 'invalid-values' ? { ok: true, kind: 'errors', at, fieldErrors: planned.fieldErrors } : { ...planned, at }
  }
  const at: SavePart = { form, field, ref: change.create.ref }
  const planned = planCreate(snapshot, bindings, policy, context, change.create.answers, read.described, scope)
  if (planned.ok) return { ok: true, kind: 'create', at, request: planned.request, fields: planned.fields, memberships: planned.memberships }
  return planned.code === 'invalid-values' ? { ok: true, kind: 'errors', at, fieldErrors: planned.fieldErrors } : { ...planned, at }
}

/**
 * The steps of one child the save changes, `index` in the save's order, or
 * the refusal of its first part that is not a field error: its `within`
 * where it creates rows, then its deletes, its updates and its creates,
 * each in the order the body sent them, and its count. Over a saved record
 * `record` is its token; under a new one, `null`. Field errors are
 * collected, not answered, so the save answers every part's at once.
 */
export function planChild(input: SaveChildInput, together: Together, index: number, record: string | null, context: PolicyContext): ChildPlan {
  const planned: Array<Extract<ChangePlan, { ok: true }>> = []
  for (const change of input.changes) {
    const one = planChange(input, change, record, context)
    if (!one.ok) return one
    planned.push(one)
  }
  const creating = input.changes.some((change) => 'create' in change)
  const within = creating ? withinScope(input, together, context) : { ok: true as const, within: null }
  if (!within.ok) return within
  const count = countScope(input, together, context)
  if (!count.ok) return count

  const of = <Kind extends 'delete' | 'update' | 'create'>(kind: Kind) =>
    planned.filter((entry): entry is Extract<ChangePlan, { kind: Kind }> => entry.kind === kind)
  const stepsOf = (kind: 'delete' | 'update' | 'create'): PlannedSaveStep[] =>
    of(kind).map((entry, position) => ({ step: { child: index, [kind]: position } as PlannedSaveStep['step'], at: entry.at, fields: entry.fields }))
  const whole: SavePart = { form: input.form, field: input.field }
  return {
    ok: true,
    child: {
      table: { ...input.bundle.bindings.root },
      within: within.within,
      deletes: of('delete').map((entry) => entry.request),
      updates: of('update').map((entry) => entry.request),
      creates: of('create').map((entry) => entry.request),
      count: { filters: count.filters, through: count.through, min: together.min, max: together.max },
    },
    columns: count.columns,
    steps: [
      ...(within.within === null ? [] : [{ step: { child: index, within: true as const }, at: whole, fields: [] }]),
      ...stepsOf('delete'),
      ...stepsOf('update'),
      ...stepsOf('create'),
    ],
    memberships: planned.flatMap((entry) => ('memberships' in entry ? entry.memberships.map((check) => ({ at: entry.at, check })) : [])),
    errors: planned.flatMap((entry) => (entry.kind === 'errors' ? [{ at: entry.at, fieldErrors: entry.fieldErrors }] : [])),
  }
}
