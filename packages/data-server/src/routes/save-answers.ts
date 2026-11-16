import { recordToken, rejectedSelection, toFormAnswers } from '@formancy/data-core'
import type {
  FormBindings,
  FormRecord,
  PlannedSaveStep,
  RecordFailure,
  SaveBody,
  SaveChange,
  SavedRecord,
  SaveOutcome,
  SavePart,
  SavePlan,
  SavePlanRefusal,
  SaveRefusal,
  SaveStep,
} from '@formancy/data-core'
import { canonicalize } from '@formancy/spec'
import { deleteFailure, recordFailure } from './runtime-errors.js'
import type { WriteAnswer } from './write-once.js'

/*
 * What a save is answered with (0155): the record and every row as stored,
 * or the one refusal, naming the part of the body it is about -- the
 * record, a child, or a row by its token or its ref -- in words the server
 * wrote, as every write's refusal is (0028). The database's own words never
 * reach the person, the log or the audit.
 */

/** The bindings of the record's form and of each child the save names, by form id: what a part's refusal and answer are worded by. */
export interface SaveForms {
  parent: FormBindings
  children: ReadonlyMap<string, FormBindings>
}

/** 409 at any step: the record moved, or a row did. Not "nothing was saved": a resend that reaches another process is answered this over a save the first sending stored (0031). */
const STALE = 'This record or its rows changed since they were read. Reload them, review the changes, and save again.'

/** A 503 for the save as a whole: the database could not complete it -- out of reach, a deadlock, a lock past the deadline, a step that would start past it -- and it was rolled back. */
function unavailable(deadlineMs: number): WriteAnswer {
  const message = `The database could not complete this save now, or not within the ${String(deadlineMs)} ms the server allows, and it was rolled back. Nothing was saved.`
  return { status: 503, body: { code: 'unavailable', message } }
}

/** `answer` with the part it is about. */
export function at(answer: WriteAnswer, part: SavePart | undefined): WriteAnswer {
  if (part === undefined) return answer
  return { ...answer, body: { ...(answer.body as Record<string, unknown>), at: part } }
}

/** The part of the body a change is: a new row by its ref, a row by its token. */
export function partOf(form: string, field: string, change: SaveChange): SavePart {
  if ('create' in change) return { form, field, ref: change.create.ref }
  return { form, field, record: 'update' in change ? change.update.record : change.delete.record }
}

const samePart = (left: SavePart, right: SavePart): boolean => canonicalize(left) === canonicalize(right)

/** The planned step an adapter names, with the part it is and the fields its answer may show. */
function plannedStep(plan: SavePlan, step: Exclude<SaveStep, 'save'>): PlannedSaveStep | undefined {
  return plan.steps.find((entry) => canonicalize(entry.step) === canonicalize(step))
}

/** The child `index` of the planned request, as the body named it: its count's part. */
function childPart(plan: SavePlan, index: number): { form: string; field: string } {
  const counted = plannedStep(plan, { child: index, count: true })
  if (counted === undefined || !('form' in counted.at)) throw new Error(`the planned save has no child ${String(index)}`)
  return { form: counted.at.form, field: counted.at.field }
}

/**
 * A planner's refusal as the answer, with its part (0155): every part's
 * field errors at once; a row the record's list does not hold, as an
 * update of another record's row is -- not found, never forbidden (0012);
 * a bound a child would be left outside, with the count; any other refusal
 * by `other`, which words it as a write alone's.
 */
export function planAnswer(plan: SavePlanRefusal, other: (refusal: SavePlanRefusal) => WriteAnswer): WriteAnswer {
  if (plan.code === 'invalid-values' && 'parts' in plan) {
    return { status: 422, body: { code: plan.code, message: plan.message, parts: plan.parts } satisfies SaveRefusal }
  }
  if (plan.code === 'not-found' && 'at' in plan && plan.at !== undefined) {
    return { status: 404, body: { code: 'not-found', message: 'No such row of this record.', at: plan.at } satisfies SaveRefusal }
  }
  if ((plan.code === 'too-few-rows' || plan.code === 'too-many-rows') && 'rows' in plan) {
    return { status: 422, body: { code: plan.code, message: plan.message, at: plan.at, rows: plan.rows } satisfies SaveRefusal }
  }
  return other(plan)
}

/**
 * The adapter's refusal of a save as the answer (0155), at the step it
 * names: `within` refused as a selection that is not an option, on the
 * child as a whole; a count outside its bound with what it held; a stale
 * step in the save's words, at the record or the row; any other failure as
 * a write alone's of that step's form -- a delete's as a delete's -- with
 * its field error in that child's field keys. A failure of the save as a
 * whole names no part. `unknown-outcome` is the route's to answer.
 */
export function failedAnswer(forms: SaveForms, plan: SavePlan, outcome: Exclude<SaveOutcome, { ok: true }>): WriteAnswer {
  if ('rejected' in outcome) {
    const child = childPart(plan, outcome.at.child)
    const parts = [{ at: child, fieldErrors: [rejectedSelection(child.field)] }]
    return { status: 422, body: { code: 'invalid-values', message: 'The record is not one these rows may reference.', parts } satisfies SaveRefusal }
  }
  if ('held' in outcome) {
    const child = childPart(plan, outcome.at.child)
    const { min, max } = (plan.request.children[outcome.at.child] as SavePlan['request']['children'][number]).count
    const code = outcome.held < min ? 'too-few-rows' : 'too-many-rows'
    const message = `${child.form} holds ${outcome.held < min ? 'at least' : 'at most'} ${String(outcome.held < min ? min : max)} rows of this record; this save would leave it ${String(outcome.held)}.`
    return { status: 422, body: { code, message, at: child, rows: { ...child, min, max, held: outcome.held } } satisfies SaveRefusal }
  }
  return stepAnswer(forms, plan, outcome.at, outcome.failure)
}

function stepAnswer(forms: SaveForms, plan: SavePlan, step: SaveStep, failure: RecordFailure): WriteAnswer {
  if (step === 'save') return failure.code === 'unavailable' ? unavailable(plan.request.deadlineMs) : recordFailure(forms.parent, failure)
  const part = plannedStep(plan, step)?.at
  if (failure.code === 'stale') return { status: 409, body: { code: 'stale', message: STALE, ...(part === undefined ? {} : { at: part }) } }
  if (step === 'record') return at(recordFailure(forms.parent, failure), { record: true })
  const child = forms.children.get(childPart(plan, step.child).form) as FormBindings
  return at('delete' in step ? deleteFailure(failure) : recordFailure(child, failure), part)
}

/** One row as its step left it, each in its form's answers and the fields this person may read. */
type Row = Extract<SaveOutcome, { ok: true }>['children'][number]['rows'][number]

/**
 * The record and every change as stored (0155), in the order the body sent
 * them: the record read back after every step; each new row with the ref
 * the page minted, each updated row, each deleted row's token as the
 * database held its key -- the token sent where no key could be read --
 * each matched to the planned step that wrote it.
 */
export function savedAnswer(forms: SaveForms, plan: SavePlan, body: SaveBody, outcome: Extract<SaveOutcome, { ok: true }>): SavedRecord {
  const [own] = plan.steps
  if (own === undefined) throw new Error('a planned save has its record step first')
  const record: FormRecord = toFormAnswers(forms.parent, own.fields, { ok: true, ...outcome.record })
  // Each child's rows come back in its row steps' order: deletes, updates, creates.
  const written: Array<{ part: SavePart; fields: readonly string[]; row: Row }> = []
  const seen = new Map<number, number>()
  for (const entry of plan.steps) {
    const { step } = entry
    if (typeof step === 'string' || 'within' in step || 'count' in step) continue
    const position = seen.get(step.child) ?? 0
    seen.set(step.child, position + 1)
    written.push({ part: entry.at, fields: entry.fields, row: outcome.children[step.child]?.rows[position] as Row })
  }
  const rows = body.rows.map(({ form, field, changes }) => {
    const bindings = forms.children.get(form) as FormBindings
    return {
      form,
      field,
      changes: changes.map((change) => {
        const found = written.find((entry) => samePart(entry.part, partOf(form, field, change)))
        if (found === undefined) throw new Error('a change of the save has no step that wrote it')
        if ('deleted' in found.row) {
          const token = recordToken(bindings.identity ?? [], found.row.deleted.values)
          return { deleted: token.ok ? token.token : (partOf(form, field, change) as { record: string }).record }
        }
        const stored = toFormAnswers(bindings, found.fields, { ok: true, ...found.row })
        return 'create' in change ? { ref: change.create.ref, row: stored } : { row: stored }
      }),
    }
  })
  return { record, rows }
}
