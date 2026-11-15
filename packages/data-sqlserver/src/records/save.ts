import { deleteTerms, rowFilterTerms, SQLSERVER_MAX_PARAMETERS, throughTerms } from '@formancy/data-core'
import type { RecordFailure, RecordValue, SaveChild, SaveOutcome, SaveRecordStep, SaveRequest, SaveStep } from '@formancy/data-core'
import type { ConnectionPool } from 'mssql'
import { prepare } from '../sql/statement.js'
import {
  COUNT_OUTSIDE,
  COUNT_OUTSIDE_MESSAGE,
  DEFINITION_MOVED as MOVED_NUMBER,
  DEFINITION_MOVED_MESSAGE,
  NOT_WITHIN,
  NOT_WITHIN_MESSAGE,
  PAST_DEADLINE,
  PAST_DEADLINE_MESSAGE,
  STEP_UNCHANGED,
  STEP_UNCHANGED_MESSAGE,
} from './batch-steps.js'
import { definitionBytes } from './definition.js'
import { failureFor, refusal } from './errors.js'
import { checkAssigned, checkKey, DEFINITION_MOVED, expectedVersion, recordFrom, whyNothingChanged } from './explain.js'
import type { Row } from './explain.js'
import { saveBatch } from './save-batch.js'
import type { BatchChild, BatchRecord, BatchStep, SaveBatch } from './save-batch.js'
import { existsStatement } from './statements.js'

/*
 * A save of a record with the rows of its together children on SQL Server
 * (0155): checked as each of its writes alone is before anything is sent,
 * built into one batch (save-batch.ts), sent once and never again, and
 * answered from what the batch selects -- every row as its step left it and
 * the record read back, or the step CATCH recorded with SQL Server's number,
 * translated by the rule a single write's refusal is (errors.ts). A step
 * that changed no row is explained after the batch by the read a write
 * alone would ask, pinned as the step was.
 */

/** A row of the batch's `@failed`: the step it stopped at, SQL Server's number and message, and the count `@n` held then. */
interface Failed {
  step: number
  number: number
  message: string
  held: number | null
}

const DECLINED_INSERT: RecordFailure = {
  ok: false,
  code: 'refused',
  message: 'SQL Server completed the insert without writing the row, and the save was rolled back.',
}

/** The record not found by its key once every step ran: a trigger removed it or changed its key, so the save was refused rather than answered with another row. */
const RECORD_GONE: RecordFailure = {
  ok: false,
  code: 'refused',
  message: 'The record was not found by its key once the save had run: a trigger removed it or changed its key, so the save was rolled back.',
}

/** The bounds a count is held to: whole numbers, `0 <= min <= max`, bound as parameters and never written into the batch. */
function checkBounds(count: SaveChild['count']): void {
  const { min, max } = count
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || min > max)
    throw new TypeError("A child's bounds are whole numbers, 0 <= min <= max.")
}

/** The record's step, checked as a write alone checks it, or the version it names no row could hold. */
function prepareRecord(step: SaveRecordStep): BatchRecord | { unversioned: true; definition: Buffer } {
  const definition = definitionBytes(step.request.definition)
  if (step.kind === 'insert') {
    checkAssigned(step.request.values, null, step.request.clock)
    return { step, definition, terms: [], through: [], expected: null }
  }
  const { request } = step
  const terms = rowFilterTerms(request.filters)
  const through = throughTerms(request.through)
  checkKey(request.target, request.key)
  const { concurrency } = request.target
  if (step.kind === 'update') {
    if (step.request.set.length === 0) throw new Error('An update sets at least one column')
    checkAssigned(step.request.set, concurrency.column, step.request.clock)
  } else if (concurrency.kind === 'rowversion' ? step.request.touch === null || step.request.touch === concurrency.column : step.request.touch !== null) {
    throw new Error('A touch sets a rowversion table’s touch column to itself, and moves a version column with none.')
  }
  const expected = expectedVersion(concurrency, request.expectedVersion)
  return expected === undefined ? { unversioned: true, definition } : { step, definition, terms, through, expected }
}

/** A child's steps, checked as each write alone is, the record's columns kept out of what a row's own request writes; or the first step whose version no row could hold. */
function prepareChild(child: SaveChild, index: number): BatchChild | { unversioned: { child: number; delete: number } | { child: number; update: number } } {
  checkBounds(child.count)
  const pinned = new Set(child.parent.map((entry) => entry.column.name))
  const deletes: Array<BatchChild['deletes'][number]> = []
  for (const [position, request] of child.deletes.entries()) {
    const terms = deleteTerms(request)
    checkKey(request.target, terms.key)
    const expected = expectedVersion(request.target.concurrency, terms.expectedVersion)
    if (expected === undefined) return { unversioned: { child: index, delete: position } }
    deletes.push({ request, terms, expected, definition: definitionBytes(request.definition) })
  }
  const updates: Array<BatchChild['updates'][number]> = []
  for (const [position, request] of child.updates.entries()) {
    checkKey(request.target, request.key)
    if (request.set.length === 0) throw new Error('An update sets at least one column')
    checkAssigned(request.set, request.target.concurrency.column, request.clock)
    const set = request.set.find((value) => pinned.has(value.name))
    if (set !== undefined) throw new Error(`${set.name} names the record a row is saved with, which a save never writes on update.`)
    const expected = expectedVersion(request.target.concurrency, request.expectedVersion)
    if (expected === undefined) return { unversioned: { child: index, update: position } }
    updates.push({
      request,
      terms: rowFilterTerms(request.filters),
      through: throughTerms(request.through),
      expected,
      definition: definitionBytes(request.definition),
    })
  }
  const creates = child.creates.map((request) => {
    const named = request.values.find((value) => pinned.has(value.name))
    if (named !== undefined) throw new Error(`${named.name} names the record a row is saved with, which the save writes from the record's key.`)
    checkAssigned(request.values, null, request.clock)
    return { request, definition: definitionBytes(request.definition) }
  })
  if (child.deletes.length + child.updates.length > 0 && child.parent.some((entry) => !('value' in entry)))
    throw new Error("A row of a saved record is located by the record's key, which its token carries; only a new record's key is returned by its step.")
  return {
    child,
    deletes,
    updates,
    creates,
    within: child.within === null ? null : { target: child.within.target, terms: rowFilterTerms(child.within.filters) },
    count: { terms: rowFilterTerms(child.count.filters), through: throughTerms(child.count.through), min: child.count.min, max: child.count.max },
  }
}

/** The child's pin as values its rows' WHERE adds to their key: a saved record's key, which its token carries. */
function pinOf(child: SaveChild): RecordValue[] {
  return child.parent.flatMap((entry) => ('value' in entry ? [{ name: entry.column.name, type: entry.column.type, value: entry.value.value }] : []))
}

/** A row step whose version no row could hold, answered as any other mismatch without anything sent: the read a write alone would ask, pinned to the record. */
async function unversioned(
  pool: ConnectionPool,
  child: SaveChild,
  at: { child: number; delete: number } | { child: number; update: number },
): Promise<RecordFailure> {
  const pin = pinOf(child)
  if ('delete' in at) {
    const one = child.deletes[at.delete] as SaveChild['deletes'][number]
    const terms = deleteTerms(one)
    return whyNothingChanged(
      pool,
      existsStatement({ target: one.target, key: [...terms.key, ...pin] }, terms.terms, terms.through, definitionBytes(one.definition)),
    )
  }
  const one = child.updates[at.update] as SaveChild['updates'][number]
  const statement = existsStatement(
    { target: one.target, key: [...one.key, ...pin] },
    rowFilterTerms(one.filters),
    throughTerms(one.through),
    definitionBytes(one.definition),
  )
  return whyNothingChanged(pool, statement)
}

/** Why a step changed no row, once the batch rolled it back: the read a write alone asks, pinned as the step was. */
async function unchanged(pool: ConnectionPool, step: BatchStep, record: BatchRecord, children: readonly BatchChild[]): Promise<RecordFailure> {
  if (step.kind === 'read-back') return RECORD_GONE
  if (step.kind === 'record') {
    if (record.step.kind === 'insert') return DECLINED_INSERT
    return whyNothingChanged(pool, existsStatement(record.step.request, record.terms, record.through, record.definition))
  }
  const at = step.at as Extract<SaveStep, { child: number }>
  const child = children[at.child] as BatchChild
  const pin = pinOf(child.child)
  if ('delete' in at) {
    const { request, terms, definition } = child.deletes[at.delete] as BatchChild['deletes'][number]
    return whyNothingChanged(pool, existsStatement({ target: request.target, key: [...terms.key, ...pin] }, terms.terms, terms.through, definition))
  }
  if ('update' in at) {
    const { request, terms, through, definition, expected } = child.updates[at.update] as BatchChild['updates'][number]
    const ended = request.open === undefined ? undefined : { open: request.open, concurrency: request.target.concurrency, expected }
    return whyNothingChanged(pool, existsStatement({ target: request.target, key: [...request.key, ...pin] }, terms, through, definition, ended))
  }
  return DECLINED_INSERT
}

/** The step a save stopped at, as the port names it: a step of the batch's own bookkeeping -- its BEGIN, its COMMIT -- is the save's as a whole. */
function stepOf(step: BatchStep): SaveStep {
  return step.kind === 'begin' || step.kind === 'commit' ? 'save' : step.at
}

/** What the batch recorded in CATCH is answered with: the move of the step's table first, then the save's own errors, then SQL Server's own number, translated as a write alone's is. */
async function stopped(
  pool: ConnectionPool,
  failed: readonly Failed[],
  steps: readonly BatchStep[],
  record: BatchRecord,
  children: readonly BatchChild[],
  deadlineMs: number,
): Promise<SaveOutcome> {
  const first = failed[0] as Failed
  const step = steps[first.step] as BatchStep
  const at = stepOf(step)
  const own = (number: number, message: string): boolean => first.number === number && first.message === message
  if (failed.some((row) => row.number === MOVED_NUMBER && row.message === DEFINITION_MOVED_MESSAGE)) return { ok: false, at, failure: DEFINITION_MOVED }
  if (own(PAST_DEADLINE, PAST_DEADLINE_MESSAGE)) {
    return {
      ok: false,
      at: 'save',
      failure: { ok: false, code: 'unavailable', message: `This save took longer than the server allows (${String(deadlineMs)} ms) and was rolled back.` },
    }
  }
  if (own(NOT_WITHIN, NOT_WITHIN_MESSAGE)) return { ok: false, at: at as { child: number; within: true }, rejected: true }
  if (own(COUNT_OUTSIDE, COUNT_OUTSIDE_MESSAGE)) return { ok: false, at: at as { child: number; count: true }, held: first.held ?? 0 }
  if (own(STEP_UNCHANGED, STEP_UNCHANGED_MESSAGE)) return { ok: false, at, failure: await unchanged(pool, step, record, children) }
  return { ok: false, at, failure: refusal({ number: first.number, message: first.message, severity: undefined }, 'write', step.assigned) }
}

/** Each child's rows as the batch selected them, after `@failed` and the record: its deletes, its updates and its creates, one result set each. */
function rowsOf(sets: readonly Row[][], children: readonly BatchChild[]): Extract<SaveOutcome, { ok: true }>['children'] {
  let next = 2
  const row = (): Row => {
    const found = sets[next]?.[0]
    next += 1
    if (found === undefined) throw new Error('SQL Server reported no row for a step the batch wrote.')
    return found
  }
  return children.map((child) => ({
    rows: [
      ...child.deletes.map(({ request }) => {
        const removed = recordFrom(row(), request.target.identity, request.target.concurrency)
        return { deleted: { values: removed.values, version: removed.version as string } }
      }),
      ...child.updates.map(({ request }) => recordFrom(row(), request.returning, request.target.concurrency)),
      ...child.creates.map(({ request }) => recordFrom(row(), request.returning, request.target.concurrency)),
    ],
  }))
}

/**
 * The save checked as each of its writes alone is, before anything is
 * sent, ready for its batch; or the first step whose version no row could
 * hold, and the child it is of, which is answered without anything sent.
 */
function prepareSave(request: SaveRequest): { record: BatchRecord; children: BatchChild[] } | { unversioned: { at: SaveStep; child?: SaveChild } } {
  if (!Number.isSafeInteger(request.deadlineMs) || request.deadlineMs < 1) throw new TypeError('A save deadline is a whole number of milliseconds above 0.')
  const record = prepareRecord(request.record)
  if ('unversioned' in record) return { unversioned: { at: 'record' } }
  const children: BatchChild[] = []
  for (const [index, child] of request.children.entries()) {
    const prepared = prepareChild(child, index)
    if ('unversioned' in prepared) return { unversioned: { at: prepared.unversioned, child } }
    children.push(prepared)
  }
  return { record, children }
}

/** The one batch `request` is sent as, built and not sent: what the suites hold to `saveParameters`' prediction. */
export function saveBatchOf(request: SaveRequest): SaveBatch {
  const prepared = prepareSave(request)
  if ('unversioned' in prepared) throw new Error('A save whose version no row could hold is sent as no batch.')
  return saveBatch(prepared.record, prepared.children, request.readBack.columns, request.deadlineMs)
}

/**
 * The record and its rows in one batch (0155), or the one step that refused
 * it, with nothing stored -- but where a trigger ended the transaction, which
 * may have committed the steps before it: `unknown-outcome` (0031 P8). A
 * malformed request is thrown before anything is sent. A batch past SQL
 * Server's parameter limit is refused unsent, a guard behind the menu's and
 * the publish check's prediction (`saveParameters`). Never sent twice.
 */
export async function saveSqlServer(pool: ConnectionPool, request: SaveRequest): Promise<SaveOutcome> {
  const prepared = prepareSave(request)
  if ('unversioned' in prepared) {
    const { at, child } = prepared.unversioned
    if (child === undefined) {
      const { request: located } = request.record as Exclude<SaveRecordStep, { kind: 'insert' }>
      const statement = existsStatement(located, rowFilterTerms(located.filters), throughTerms(located.through), definitionBytes(located.definition))
      return { ok: false, at: 'record', failure: await whyNothingChanged(pool, statement) }
    }
    return { ok: false, at, failure: await unversioned(pool, child, at as { child: number; delete: number } | { child: number; update: number }) }
  }
  const { record, children } = prepared
  const batch = saveBatch(record, children, request.readBack.columns, request.deadlineMs)
  const bound = batch.statement.parameters.length
  if (bound > SQLSERVER_MAX_PARAMETERS) {
    const message = `This save binds ${String(bound)} parameters, more than the ${String(SQLSERVER_MAX_PARAMETERS)} one SQL Server request takes, so nothing was sent.`
    return { ok: false, at: 'save', failure: { ok: false, code: 'refused', message } }
  }
  let sets: Row[][]
  try {
    const result = await prepare(pool, batch.statement).query<Row>(batch.statement.sql)
    // mssql types every result set's rows `any`, whatever the batch selects.
    sets = (result.recordsets as unknown as Row[][]).map((set) => [...set])
  } catch (error) {
    // What CATCH could not catch -- a table missing when its statement
    // compiled, an attention -- and every connection failure: the save as
    // a whole, rolled back by xact_abort, or unknown once the batch was sent.
    return { ok: false, at: 'save', failure: failureFor(error, 'write') }
  }
  const failed = (sets[0] ?? []) as unknown as Failed[]
  if (failed.length > 0) return stopped(pool, failed, batch.steps, record, children, request.deadlineMs)
  const back = sets[1]?.[0]
  if (back === undefined) throw new Error('SQL Server reported no record read back from a save it committed.')
  const target = request.record.request.target
  return { ok: true, record: recordFrom(back, request.readBack.columns, target.concurrency), children: rowsOf(sets, children) }
}
