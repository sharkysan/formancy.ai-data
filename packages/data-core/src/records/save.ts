import { togetherOf, type Together } from '../generate/together.js'
import { byCodepoint } from '../policy/inputs.js'
import type { PolicyContext } from '../policy/types.js'
import type { SavePart } from '../save.js'
import { childLookups, parentKey, referencingFields } from './children.js'
import { planList } from './list.js'
import { planCreate, planUpdate } from './plan.js'
import type { FieldError, FormRecord, MembershipCheck, PlannedInsert, PlannedList, PlannedUpdate } from './plan-types.js'
import { prepare, type Prepared, refuse, unaddressable } from './prepare.js'
import { type ChildPlan, planChild, type SaveBundle, type SaveChildInput } from './save-steps.js'
import type { ParentColumn, PlannedSave, PlannedSaveStep, SaveChild, SavePlanRefusal, SaveRecordStep } from './save-types.js'
import { newKeyPart, pinsTouch } from './together.js'
import type { DescribedTable, RecordValue } from './types.js'

/** One column of the record's key as a save knows it before any statement: its value, or the record's step returns it. */
type KeyPart = { value: RecordValue } | { returned: string }

/*
 * A save of a record with the rows of its together children (0155): every
 * part planned by today's planners under its own form's policy, every
 * field error of every part collected at once, every row step pinned to
 * the record, and each child the save changes counted. The one request an
 * adapter will run as one transaction, in this order: the record's step;
 * each child, in codepoint order of form and field, its `within` where it
 * has creates, then its deletes, its updates and its creates; the counts;
 * the record read back by its key.
 *
 * Deletes go before creates, so a row removed and another added under its
 * key are one save. The record's own step goes first, so its triggers see
 * the rows as they were, and a row's trigger that updates the record runs
 * after it: 0155 names that cost rather than reorder the steps.
 *
 * Pure and isomorphic, as the other planners are (plan.ts). Who may act
 * is asked of every part before this, by the route; a part's own planner
 * asks again, and a refusal there answers alone, at its part.
 */

/** A together child that requires rows of a new record (`rowsRequired`), by its form's id. */
export interface RequiredRows {
  form: string
  field: string
  min: number
  max: number
}

/** What the route read before the transaction: the record's bundle, its step, each child the save changes, and the configured deadline. */
export interface SaveInput {
  parent: SaveBundle
  /**
   * The record's step. A create carries each together child that requires
   * rows of the record (`rowsRequired`), whoever the person is, `[]` for
   * none: a save that creates none of one's rows would leave the record
   * below its bound, and nothing else knows of a child the body leaves out.
   */
  record:
    | { create: { answers: unknown; described: DescribedTable; required: readonly RequiredRows[] } }
    | { update: { record: string; version: string; answers: unknown; asRead: FormRecord | undefined; described: DescribedTable } }
  children: readonly SaveChildInput[]
  /** The server's deadline for the transaction, a whole number of milliseconds from configuration. */
  deadlineMs: number
}

/**
 * The list of a saved record's rows a save is planned over (0155): the
 * child's own list under its read policy, narrowed to the record through
 * its together field, in key order, with `max + 1` rows -- one more than
 * the record may hold, so a record another writer left above its bound is
 * seen -- and no filter, related condition or search. The field and `max`
 * are the child's own bindings', so the list cannot be planned over
 * another. One statement per child, which reads every row as this person
 * reads it, and describes the table; one page, which `TOGETHER_MAX_ROWS`
 * keeps `max + 1` within.
 */
export function planSaveList(child: SaveBundle, record: string, context: PolicyContext): PlannedList {
  const ready = prepare(child.snapshot, child.bindings)
  if (!ready.ok) return ready
  const together = togetherOf(child.bindings)
  // A malformed one is refused by `prepare` above.
  if (together === null || together === 'malformed') return refuse('operation-unavailable', "This form's rows are not saved with a record.")
  return planList(child.snapshot, child.bindings, child.policy, context, {
    search: '',
    sort: [],
    parent: { field: together.binding.field, record },
    filter: [],
    after: null,
    limit: together.max + 1,
  })
}

/** Why the record's own form cannot carry a save of its rows, or `null`: no key a token carries, a form over versions, or one whose own rows are saved with another record -- a save is one level deep. */
function carryProblem(parent: SaveBundle, prepared: Prepared): SavePlanRefusal | null {
  const at: SavePart = { record: true }
  if (!prepared.addressable) return { ...unaddressable(prepared), at }
  if (togetherOf(parent.bindings) !== null)
    return { ...refuse('operation-unavailable', "This form's rows are saved with another record, so it saves none of its own with it."), at }
  if (parent.bindings.validity !== undefined) return { ...refuse('operation-unavailable', 'A form over versions saves no rows with its records.'), at }
  return null
}

/** The children the save changes, each a together child of the record through its field, in codepoint order of form and field -- or why one is not. */
function childrenOf(
  parent: SaveBundle,
  inputs: readonly SaveChildInput[],
): { ok: true; children: Array<SaveChildInput & { together: Together }> } | SavePlanRefusal {
  const key = parentKey(parent)
  const seen = new Set<string>()
  const children: Array<SaveChildInput & { together: Together }> = []
  for (const input of inputs) {
    if (input.changes.length === 0) continue
    const name = `${input.form}\u0000${input.field}`
    if (seen.has(name)) return refuse('invalid-request', `${input.form} is named twice through ${input.field}.`)
    seen.add(name)
    const together = togetherOf(input.bundle.bindings)
    const references = referencingFields(key, childLookups(input.bundle)).includes(input.field)
    if (together === null || together === 'malformed' || together.binding.field !== input.field || !references) {
      return refuse('invalid-request', `${input.form} is not saved with this form's records through ${input.field}.`)
    }
    children.push({ ...input, together })
  }
  children.sort((left, right) => byCodepoint(left.form, right.form) || byCodepoint(left.field, right.field))
  return { ok: true, children }
}

/** The record's step from its planned write: an insert, an update, or -- an update that sets nothing -- the touch that moves its version. */
function recordStep(parent: SaveBundle, planned: Extract<PlannedInsert | PlannedUpdate, { ok: true }>): { ok: true; step: SaveRecordStep } | SavePlanRefusal {
  const at: SavePart = { record: true }
  const { request } = planned
  if (!('set' in request)) return { ok: true, step: { kind: 'insert', request } }
  if (request.set.length > 0 || request.clock !== undefined) return { ok: true, step: { kind: 'update', request } }
  const { concurrency } = request.target
  // A version column is incremented by the touch itself; a rowversion moves only when a column is set.
  const touch = concurrency.kind === 'rowversion' ? (parent.bindings.concurrency?.touch ?? null) : null
  if (concurrency.kind === 'rowversion' && touch === null) {
    return {
      ...refuse('operation-unavailable', 'A save of these rows alone must move the record’s rowversion, and this form confirms no column to touch.'),
      at,
    }
  }
  if (touch !== null && pinsTouch(parent.policy, touch)) {
    return { ...refuse('invalid-policy', `rowFilters: ${touch} is the touch column, which a save of rows sets; a row filter cannot pin it.`), at }
  }
  const { target, key, expectedVersion, filters, through, definition } = request
  return { ok: true, step: { kind: 'touch', request: { target, key, expectedVersion, filters, through, definition, touch } } }
}

/**
 * The record's key as the save knows it before any statement: each
 * identity column's value where it is known -- a saved record's token, or
 * a value its insert writes -- or the column itself where the database
 * numbers it and the record's step returns it (`newKeyPart`, which the
 * menu asks too). A key the database fills any other way cannot be known,
 * and its rows cannot be saved with it.
 */
function recordKey(parent: SaveBundle, prepared: Prepared, step: SaveRecordStep): { ok: true; key: Map<string, KeyPart> } | SavePlanRefusal {
  const key = new Map<string, KeyPart>()
  const known = step.kind === 'insert' ? step.request.values : step.request.key
  for (const { name } of prepared.target.identity) {
    const value = known.find((entry) => entry.name === name)
    const part = newKeyPart(parent.snapshot.kind, prepared, name, value !== undefined)
    if (part === 'written') key.set(name, { value: value as RecordValue })
    else if (part === 'returned') key.set(name, { returned: name })
    else
      return {
        ...refuse(
          'operation-unavailable',
          `This record's ${name} is filled by the database in a way that can repeat, so its rows cannot be saved with it until it is given.`,
        ),
        at: { record: true },
      }
  }
  return { ok: true, key }
}

/** Each of the child's foreign-key columns paired with the record's key column it references, in order, as `referencingFields` proved them. */
function pinned(plan: Extract<ChildPlan, { ok: true }>, together: Together, key: ReadonlyMap<string, KeyPart>): ParentColumn[] {
  return plan.columns.map((column, index) => {
    const from = key.get(together.binding.target.columns[index] as string) as KeyPart
    return 'value' in from ? { column, value: from.value } : { column, returned: from.returned }
  })
}

/** The bound a child would be left outside before any statement, or `null`: a record listed above its `max`, or a new record's creates outside its bounds. */
function boundRefusal(child: SaveChildInput & { together: Together }, creating: boolean): SavePlanRefusal | null {
  const { min, max } = child.together
  const creates = child.changes.filter((change) => 'create' in change).length
  const held = creating ? creates : child.read.rows.length
  const at: SavePart = { form: child.form, field: child.field }
  const rows = { form: child.form, field: child.field, min, max, held }
  if (held > max)
    return {
      ok: false,
      code: 'too-many-rows',
      message: `${child.form} holds at most ${String(max)} rows of this record; it would hold ${String(held)}.`,
      at,
      rows,
    }
  if (creating && held < min)
    return {
      ok: false,
      code: 'too-few-rows',
      message: `${child.form} holds at least ${String(min)} rows of this record; it would hold ${String(held)}.`,
      at,
      rows,
    }
  return null
}

/** The record's own write, planned as it is alone -- an update that may change nothing where rows change with it, which becomes the touch. */
function planRecord(input: SaveInput, rows: boolean, context: PolicyContext): PlannedInsert | PlannedUpdate {
  const { parent, record } = input
  if ('create' in record) return planCreate(parent.snapshot, parent.bindings, parent.policy, context, record.create.answers, record.create.described)
  const { record: token, version, answers, asRead, described } = record.update
  return planUpdate(parent.snapshot, parent.bindings, parent.policy, context, token, version, answers, asRead, described, { touch: rows })
}

/** The first bound the save would leave a child outside, before any statement, or `null`: a child that requires rows of a new record and gets none, then each child's own. */
function firstBound(input: SaveInput, children: ReadonlyArray<SaveChildInput & { together: Together }>): SavePlanRefusal | null {
  const creating = 'create' in input.record
  for (const entry of 'create' in input.record ? input.record.create.required : []) {
    if (children.some((child) => child.form === entry.form && child.field === entry.field)) continue
    const rows = { form: entry.form, field: entry.field, min: entry.min, max: entry.max, held: 0 }
    const message = `${entry.form} holds at least ${String(entry.min)} rows of this record; it would hold 0.`
    return { ok: false, code: 'too-few-rows', message, at: { form: entry.form, field: entry.field }, rows }
  }
  for (const child of children) {
    const bound = boundRefusal(child, creating)
    if (bound !== null) return bound
  }
  return null
}

/** The planned record and children as one request, each child pinned to the record's key, with every step in the order the adapter runs them. */
function assembled(
  input: SaveInput,
  record: Extract<PlannedInsert | PlannedUpdate, { ok: true }>,
  step: SaveRecordStep,
  children: ReadonlyArray<SaveChildInput & { together: Together }>,
  plans: ReadonlyArray<Extract<ChildPlan, { ok: true }>>,
  key: ReadonlyMap<string, KeyPart>,
): PlannedSave {
  const at: SavePart = { record: true }
  const steps: PlannedSaveStep[] = [{ step: 'record', at, fields: record.fields }]
  const memberships: Array<{ at: SavePart; check: MembershipCheck }> = record.memberships.map((check) => ({ at, check }))
  const saved: SaveChild[] = plans.map((plan, index) => {
    steps.push(...plan.steps)
    memberships.push(...plan.memberships)
    return { ...plan.child, parent: pinned(plan, (children[index] as SaveChildInput & { together: Together }).together, key) }
  })
  children.forEach((child, index) => steps.push({ step: { child: index, count: true }, at: { form: child.form, field: child.field }, fields: [] }))
  return {
    ok: true,
    request: { record: step, children: saved, readBack: { columns: record.request.returning }, deadlineMs: input.deadlineMs },
    steps,
    memberships,
    moved: record.moved,
  }
}

/**
 * The save `input` asks for, for this person -- or the first part's
 * refusal, every part's field errors at once, or the bound a child would be
 * left outside. Refusals that are not field errors answer alone, the
 * record's before any child's and each child's in the save's order; then
 * the field errors; then the bounds. A new record's bound is checked here,
 * before any statement, since it holds no rows but the save's own creates;
 * a saved record's is the transaction's count, and only a list already
 * above `max` is refused here.
 */
export function planSave(input: SaveInput, context: PolicyContext): PlannedSave {
  if (!Number.isSafeInteger(input.deadlineMs) || input.deadlineMs <= 0) throw new TypeError('A save deadline is a whole number of milliseconds above 0.')
  const { parent } = input
  const ready = prepare(parent.snapshot, parent.bindings)
  if (!ready.ok) return { ...ready, at: { record: true } }
  const found = childrenOf(parent, input.children)
  if (!found.ok) return found
  const { children } = found
  const carry = children.length === 0 ? null : carryProblem(parent, ready.prepared)
  if (carry !== null) return carry

  const refusals: SavePlanRefusal[] = []
  const errors: Array<{ at: SavePart; fieldErrors: FieldError[] }> = []
  const planned = planRecord(input, children.length > 0, context)
  if (!planned.ok && planned.code === 'invalid-values') errors.push({ at: { record: true }, fieldErrors: planned.fieldErrors })
  else if (!planned.ok) refusals.push({ ...planned, at: { record: true } })
  const step = planned.ok ? recordStep(parent, planned) : null
  if (step !== null && !step.ok) refusals.push(step)
  const token = 'update' in input.record ? input.record.update.record : null
  const plans: ChildPlan[] = children.map((child, index) => planChild(child, child.together, index, token, context))
  for (const plan of plans) {
    if (!plan.ok) refusals.push(plan)
    else errors.push(...plan.errors)
  }
  const first = refusals[0]
  if (first !== undefined) return first
  if (errors.length > 0) {
    const fields = errors.flatMap((part) => part.fieldErrors.map((error) => error.field))
    return { ok: false, code: 'invalid-values', message: `${[...new Set(fields)].join(', ')} cannot be written`, parts: errors }
  }
  const bound = firstBound(input, children)
  if (bound !== null) return bound

  // Every refusal above is answered, so the record and each child planned.
  const record = planned as Extract<typeof planned, { ok: true }>
  const stepped = (step as Extract<typeof step, { ok: true }>).step
  const key = recordKey(parent, ready.prepared, stepped)
  if (children.length > 0 && !key.ok) return key
  return assembled(input, record, stepped, children, plans as Array<Extract<ChildPlan, { ok: true }>>, key.ok ? key.key : new Map<string, KeyPart>())
}
