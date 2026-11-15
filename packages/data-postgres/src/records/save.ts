import { deleteTerms, reachesPast, rowFilterTerms, throughTerms } from '@formancy/data-core'
import type {
  ApiValue,
  DeleteRequest,
  DeleteTerms,
  InsertRequest,
  ObjectRef,
  ParentColumn,
  RecordColumn,
  RecordFailure,
  RecordRead,
  RecordTarget,
  RecordValue,
  RowFilterTerm,
  SaveChild,
  SaveOutcome,
  SaveRecordStep,
  SaveRequest,
  SaveStep,
  ThroughTerms,
  UpdateRequest,
} from '@formancy/data-core'
import type { Sql, TransactionSql } from 'postgres'
import { run } from '../sql/statement.js'
import type { TextResult, TextRow } from '../sql/statement.js'
import { decodeCanonical } from '../sql/values.js'
import { parseDefinition } from './definition.js'
import type { Definition } from './definition.js'
import { deleteStatement } from './delete.js'
import { recordFailure, sqlState } from './errors.js'
import { CARDINALITY, DECLINED_INSERT, failedWrite, moved, onlyRow, pathOf, recordOf, untilLost, whyNotDeleted, whyNothingChanged } from './explain.js'
import { checkInsert, checkKey, checkUpdate, isVersion } from './requests.js'
import { countStatement, readBackStatement, timeoutStatements, touchStatement, withinStatement } from './save-sql.js'
import { insertStatement, rowExclusiveLock, updateStatement } from './sql.js'
import type { RecordStatement, WritePath } from './sql.js'

/*
 * A save of a record with the rows of its together children on PostgreSQL
 * (0155): one `sql.begin`, on the path the record's definition chooses
 * (0041) -- the locked one under any isolation but READ COMMITTED, or where
 * a delete reaches past its root (0051) -- with every step today's statement
 * for one record, each row's pinned to the record, and nothing translated
 * inside the transaction. A step that changes nothing, a `within` that is
 * false, a count outside its bounds and a deadline that has passed each
 * throw, so postgres.js rolls everything back; the step that failed is then
 * explained outside the transaction, by the read a write alone would ask
 * (explain.ts). The planner chose the steps, their order and the bounds;
 * this runs them and compares each count with the bounds it was given, as a
 * version is compared in a WHERE.
 */

/**
 * Why a save stopped inside its transaction, thrown there so it rolls back:
 * a step the server refused, one that changed nothing, the record not found
 * by its key at the end (`gone`), a `within` that was false, a count
 * outside its bounds, or the deadline.
 */
class Stopped extends Error {
  readonly at: SaveStep
  readonly why: { refused: unknown } | 'unchanged' | 'gone' | 'rejected' | { held: number } | 'deadline'

  constructor(at: Stopped['at'], why: Stopped['why']) {
    super('A save stopped inside its transaction, which rolled back.')
    this.at = at
    this.why = why
  }
}

/** A child's row steps, ready but for the record's key where the database numbers it. */
interface PreparedChild {
  child: SaveChild
  table: ObjectRef
  deletes: Array<{ request: DeleteRequest; terms: DeleteTerms; definition: Definition }>
  updates: Array<{ request: UpdateRequest; scope: Scope; definition: Definition }>
  creates: Array<{ request: InsertRequest; definition: Definition }>
  within: { target: ObjectRef; terms: RowFilterTerm[] } | null
  count: Scope
}

interface Scope {
  terms: readonly RowFilterTerm[]
  through: readonly ThroughTerms[]
}

/** The record's step ready to send: its definition, and the scope it is located under where it locates one. */
interface PreparedRecord {
  step: SaveRecordStep
  target: RecordTarget
  definition: Definition
  scope: Scope
}

/** The values a child's foreign key takes from the record's key: the key known, or the column of the record's own step that returns it. */
function pinValues(parent: readonly ParentColumn[], returned: ReadonlyMap<string, ApiValue>): RecordValue[] {
  return parent.map((entry) => {
    if ('value' in entry) return { name: entry.column.name, type: entry.column.type, value: entry.value.value }
    const value = returned.get(entry.returned)
    if (value === undefined) throw new Error(`The record's step returned no ${entry.returned}, which a child's foreign key takes.`)
    return { name: entry.column.name, type: entry.column.type, value }
  })
}

/** The bounds a count is held to: whole numbers, `0 <= min <= max`, compared here and never written into the statement. */
function checkBounds(count: SaveChild['count']): void {
  const { min, max } = count
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || min > max)
    throw new TypeError("A child's bounds are whole numbers, 0 <= min <= max.")
}

/** The record's step, checked as a write alone checks it before anything is sent. */
function prepareRecord(step: SaveRecordStep): PreparedRecord {
  const { request } = step
  const definition = parseDefinition(request.definition)
  if (step.kind === 'insert') {
    checkInsert(step.request)
    return { step, target: step.request.target, definition, scope: { terms: [], through: [] } }
  }
  const terms = rowFilterTerms(step.request.filters)
  const scope = { terms, through: throughTerms(step.request.through) }
  if (step.kind === 'update') checkUpdate(step.request, terms)
  else {
    checkKey(step.request.target, step.request.key)
    if (step.request.target.concurrency.kind !== 'version-column' || step.request.touch !== null)
      throw new Error('PostgreSQL has no rowversion; a touch here moves a version column, and sets no touch column.')
  }
  return { step, target: step.request.target, definition, scope }
}

/** A child's steps, checked as each write alone is, and its pin kept out of what a row's own request writes. */
function prepareChild(child: SaveChild): PreparedChild {
  checkBounds(child.count)
  const pinned = new Set(child.parent.map((entry) => entry.column.name))
  if (child.deletes.length + child.updates.length > 0 && child.parent.some((entry) => !('value' in entry)))
    throw new Error("A row of a saved record is located by the record's key, which its token carries; only a new record's key is returned by its step.")
  const deletes = child.deletes.map((request) => {
    const terms = deleteTerms(request)
    checkKey(request.target, terms.key)
    if (request.target.concurrency.kind !== 'version-column') throw new Error('PostgreSQL has no rowversion; a delete here is guarded by a version column.')
    return { request, terms, definition: parseDefinition(request.definition) }
  })
  const updates = child.updates.map((request) => {
    const terms = rowFilterTerms(request.filters)
    checkUpdate(request, terms)
    const set = request.set.find((value) => pinned.has(value.name))
    if (set !== undefined) throw new Error(`${set.name} names the record a row is saved with, which a save never writes on update.`)
    return { request, scope: { terms, through: throughTerms(request.through) }, definition: parseDefinition(request.definition) }
  })
  const creates = child.creates.map((request) => {
    const named = request.values.find((value) => pinned.has(value.name))
    if (named !== undefined) throw new Error(`${named.name} names the record a row is saved with, which the save writes from the record's key.`)
    checkInsert(request)
    return { request, definition: parseDefinition(request.definition) }
  })
  return {
    child,
    table: child.table,
    deletes,
    updates,
    creates,
    within: child.within === null ? null : { target: child.within.target, terms: rowFilterTerms(child.within.filters) },
    count: { terms: rowFilterTerms(child.count.filters), through: throughTerms(child.count.through) },
  }
}

/** Every table the save writes, a delete's reach included: what the locked path's one LOCK takes, in codepoint order (sql.ts). */
function written(record: PreparedRecord, children: readonly PreparedChild[]): ObjectRef[] {
  return [
    record.target.table,
    ...children.flatMap((child) => [
      child.table,
      ...child.deletes.flatMap(({ terms }) => [...terms.reach.removed, ...terms.reach.cleared.map((entry) => entry.table)]),
    ]),
  ]
}

/** A located request with the pin added to its key: the row is found only where its foreign key holds the record's key too (0155). */
function pinnedKey<Request extends { key: readonly RecordValue[] }>(request: Request, pin: readonly RecordValue[]): Request {
  return { ...request, key: [...request.key, ...pin] }
}

/** The record's key from what its step returned: every identity column, from the canonical text its insert returned, or the key an update located it by. */
function keyOf(record: PreparedRecord, row: TextRow | undefined): { key: RecordValue[]; returned: Map<string, ApiValue> } {
  if (record.step.kind !== 'insert') return { key: [...record.step.request.key], returned: new Map() }
  const { returning } = record.step.request
  const returned = new Map<string, ApiValue>()
  const key = record.target.identity.map((column) => {
    const index = returning.findIndex((entry) => entry.name === column.name)
    if (index < 0 || row === undefined) throw new Error(`The record's insert returns no ${column.name}, its key, which the save reads it back by.`)
    const value = decodeCanonical(column.type, row[index] ?? null)
    returned.set(column.name, value)
    return { ...column, value }
  })
  return { key, returned }
}

/** What a step that changed nothing is answered with, once the transaction rolled back: the read a write alone would ask, pinned as the step was. */
async function unchanged(sql: Sql, at: SaveStep, record: PreparedRecord, children: readonly PreparedChild[], path: WritePath): Promise<RecordFailure> {
  if (at === 'record') {
    const { step, definition, scope } = record
    if (step.kind === 'insert') return (await moved(sql, record.target.table, definition, path)) ?? DECLINED_INSERT
    const located = { target: step.request.target, key: step.request.key, expectedVersion: step.request.expectedVersion }
    return whyNothingChanged(sql, located, scope, true, definition, path)
  }
  if (typeof at === 'string' || 'within' in at || 'count' in at) throw new Error('Only a write step changes nothing.')
  const child = children[at.child] as PreparedChild
  const pin = pinValues(child.child.parent, new Map())
  if ('delete' in at) {
    const { request, terms, definition } = child.deletes[at.delete] as PreparedChild['deletes'][number]
    return whyNotDeleted(sql, request, pinnedKey(terms, pin), true, definition, path)
  }
  if ('update' in at) {
    const { request, scope, definition } = child.updates[at.update] as PreparedChild['updates'][number]
    return whyNothingChanged(sql, pinnedKey(request, pin), scope, true, definition, path)
  }
  const { definition } = child.creates[at.create] as PreparedChild['creates'][number]
  return (await moved(sql, child.table, definition, path)) ?? DECLINED_INSERT
}

/**
 * What a step the server refused is answered with: a serialization failure
 * at a step that locates its row is a race, explained without the version
 * (explain.ts); a delete's own refusal of a second row is a programming
 * error, as alone (delete.ts); anything else is translated as a write alone
 * is, and answered as the move where the step's table moved (0041).
 */
async function refused(
  sql: Sql,
  at: Exclude<SaveStep, 'save'>,
  error: unknown,
  record: PreparedRecord,
  children: readonly PreparedChild[],
  path: WritePath,
): Promise<RecordFailure> {
  const state = sqlState(error)
  if (at === 'record') {
    const { step } = record
    if (state === '40001' && step.kind !== 'insert') {
      const located = { target: step.request.target, key: step.request.key, expectedVersion: step.request.expectedVersion }
      return whyNothingChanged(sql, located, record.scope, false, record.definition, path)
    }
    return failedWrite(sql, record.target.table, record.definition, path, recordFailure(error, 'write'))
  }
  const child = children[at.child] as PreparedChild
  if ('delete' in at) {
    const { request, terms, definition } = child.deletes[at.delete] as PreparedChild['deletes'][number]
    if (state === CARDINALITY)
      throw new Error(
        'The identity matched more than one row, so the delete was refused inside its statement and nothing was saved: the bindings do not name a key.',
      )
    if (state === '40001') return whyNotDeleted(sql, request, pinnedKey(terms, pinValues(child.child.parent, new Map())), false, definition, path)
    return failedWrite(sql, terms.root, definition, path, recordFailure(error, 'write'))
  }
  if ('update' in at) {
    const { request, scope, definition } = child.updates[at.update] as PreparedChild['updates'][number]
    if (state === '40001') return whyNothingChanged(sql, pinnedKey(request, pinValues(child.child.parent, new Map())), scope, false, definition, path)
    return failedWrite(sql, child.table, definition, path, recordFailure(error, 'write'))
  }
  if ('create' in at)
    return failedWrite(sql, child.table, (child.creates[at.create] as PreparedChild['creates'][number]).definition, path, recordFailure(error, 'write'))
  // `within` and the count write nothing: a refusal there is translated as it is.
  return recordFailure(error, 'write')
}

/** A row's answer from the statement that wrote it: what its RETURNING read. */
function rowOf(target: RecordTarget, columns: readonly RecordColumn[], result: TextResult): Omit<RecordRead, 'ok'> {
  return recordOf(target, columns, onlyRow(result) as TextRow)
}

type Answered = Extract<SaveOutcome, { ok: true }>

/** Sends one statement of the save as the step it is: past the deadline it is not sent, and a refusal names its step. */
type Send = (at: SaveStep, statement: RecordStatement) => Promise<TextResult>

/** One child's `within`, deletes, updates and creates, each pinned to the record, and the rows as each step left them. */
async function childSteps(
  send: Send,
  index: number,
  prepared: PreparedChild,
  record: { key: readonly RecordValue[]; returned: ReadonlyMap<string, ApiValue> },
  path: WritePath,
): Promise<Answered['children'][number]> {
  const pin = pinValues(prepared.child.parent, record.returned)
  const rows: Answered['children'][number]['rows'] = []
  if (prepared.within !== null) {
    const [found] = (await send({ child: index, within: true }, withinStatement(prepared.within.target, record.key, prepared.within.terms))).rows
    if (found?.[0] !== 'true') throw new Stopped({ child: index, within: true }, 'rejected')
  }
  for (const [position, { request: del, terms, definition }] of prepared.deletes.entries()) {
    const result = await send({ child: index, delete: position }, deleteStatement(del, pinnedKey(terms, pin), definition, path))
    const row = result.rows[0]
    if (row === undefined) throw new Stopped({ child: index, delete: position }, 'unchanged')
    const removed = recordOf(del.target, del.target.identity, row)
    rows.push({ deleted: { values: removed.values, version: removed.version as string } })
  }
  for (const [position, { request: update, scope, definition }] of prepared.updates.entries()) {
    const result = await send({ child: index, update: position }, updateStatement(pinnedKey(update, pin), scope.terms, scope.through, definition, path))
    if (result.rows.length === 0) throw new Stopped({ child: index, update: position }, 'unchanged')
    rows.push(rowOf(update.target, update.returning, result))
  }
  for (const [position, { request: create, definition }] of prepared.creates.entries()) {
    const result = await send({ child: index, create: position }, insertStatement({ ...create, values: [...create.values, ...pin] }, definition, path))
    if (result.count !== 1) throw new Stopped({ child: index, create: position }, 'unchanged')
    rows.push(rowOf(create.target, create.returning, result))
  }
  return { rows }
}

/** The record's own step: an insert, an update or the touch, and the key its rows take. */
async function recordStep(send: Send, record: PreparedRecord, path: WritePath): Promise<ReturnType<typeof keyOf>> {
  const { step, definition, scope } = record
  const own =
    step.kind === 'insert'
      ? await send('record', insertStatement(step.request, definition, path))
      : step.kind === 'update'
        ? await send('record', updateStatement(step.request, scope.terms, scope.through, definition, path))
        : await send('record', touchStatement(step.request, scope.terms, scope.through, definition, path))
  // INSERT 0 0 is the guard, a trigger or a rule; an update's no row is stale, gone or declined: explained after the rollback.
  if (step.kind === 'insert' ? own.count !== 1 : own.rows.length === 0) throw new Stopped('record', 'unchanged')
  return keyOf(record, own.rows[0])
}

/**
 * Runs the save's statements in `tx`, in the planner's order: the
 * timeouts, the locked path's LOCK, the record's step, each child's steps,
 * the counts, the record read back by its key -- and returns every row as
 * its step left it with the record read back, for postgres.js to COMMIT.
 * The deadline is checked before each statement and before the COMMIT.
 */
async function steps(
  tx: TransactionSql,
  request: SaveRequest,
  record: PreparedRecord,
  children: readonly PreparedChild[],
  path: WritePath,
  sending: () => void,
): Promise<Answered> {
  const start = performance.now()
  const send: Send = async (at, statement) => {
    if (performance.now() - start >= request.deadlineMs) throw new Stopped('save', 'deadline')
    try {
      return await untilLost(run(tx, statement.text, statement.params))
    } catch (error) {
      throw new Stopped(at, { refused: error })
    }
  }
  for (const statement of timeoutStatements(request.deadlineMs)) await send('save', statement)
  if (path === 'locked') await send('save', rowExclusiveLock(written(record, children)))
  sending()

  const key = await recordStep(send, record, path)
  const rows: Answered['children'] = []
  for (const [index, prepared] of children.entries()) rows.push(await childSteps(send, index, prepared, key, path))
  for (const [index, prepared] of children.entries()) {
    const { count } = prepared.child
    const pin = pinValues(prepared.child.parent, key.returned)
    const [counted] = (await send({ child: index, count: true }, countStatement(prepared.table, pin, prepared.count.terms, prepared.count.through, count.max)))
      .rows
    const held = Number(counted?.[0])
    if (held < count.min || held > count.max) throw new Stopped({ child: index, count: true }, { held })
  }
  const back = onlyRow(await send('record', readBackStatement(record.target, key.key, request.readBack.columns)))
  // Not there by its key: a trigger removed the record or changed its key. Failing closed, rolled back.
  if (back === undefined) throw new Stopped('record', 'gone')
  if (performance.now() - start >= request.deadlineMs) throw new Stopped('save', 'deadline')
  return { ok: true, record: recordOf(record.target, request.readBack.columns, back), children: rows }
}

/** The record not found by its key after every step: a trigger removed it or changed its key, so the save was refused rather than answered with another row. */
const RECORD_GONE: RecordFailure = {
  ok: false,
  code: 'refused',
  message: 'The record was not found by its key once the save had run: a trigger removed it or changed its key, so the save was rolled back.',
}

/**
 * A save whose request names a version no row could hold -- one that is
 * not a number names no state a row was ever in -- answered as any other
 * mismatch without anything sent, at the first such step; or `undefined`.
 */
async function unversioned(sql: Sql, record: PreparedRecord, children: readonly PreparedChild[], path: WritePath): Promise<SaveOutcome | undefined> {
  const { step } = record
  if (step.kind !== 'insert' && !isVersion(step.request.expectedVersion)) {
    const located = { target: step.request.target, key: step.request.key, expectedVersion: step.request.expectedVersion }
    return { ok: false, at: 'record', failure: await whyNothingChanged(sql, located, record.scope, false, record.definition, path) }
  }
  for (const [index, child] of children.entries()) {
    const del = child.deletes.findIndex(({ terms }) => !isVersion(terms.expectedVersion))
    if (del >= 0) {
      const { request: one, terms, definition } = child.deletes[del] as PreparedChild['deletes'][number]
      const pin = pinValues(child.child.parent, new Map())
      return { ok: false, at: { child: index, delete: del }, failure: await whyNotDeleted(sql, one, pinnedKey(terms, pin), false, definition, path) }
    }
    const update = child.updates.findIndex(({ request: one }) => !isVersion(one.expectedVersion))
    if (update >= 0) {
      const { request: one, scope, definition } = child.updates[update] as PreparedChild['updates'][number]
      const pin = pinValues(child.child.parent, new Map())
      return { ok: false, at: { child: index, update }, failure: await whyNothingChanged(sql, pinnedKey(one, pin), scope, false, definition, path) }
    }
  }
  return undefined
}

/** What a save that stopped inside its transaction is answered with, once postgres.js rolled it back. */
async function answered(
  sql: Sql,
  stop: Stopped,
  request: SaveRequest,
  record: PreparedRecord,
  children: readonly PreparedChild[],
  path: WritePath,
  sent: boolean,
): Promise<SaveOutcome> {
  const { at, why } = stop
  if (why === 'deadline') {
    const message = `This save took longer than the server allows (${String(request.deadlineMs)} ms) and was rolled back.`
    return { ok: false, at: 'save', failure: { ok: false, code: 'unavailable', message } }
  }
  if (why === 'rejected') return { ok: false, at: at as { child: number; within: true }, rejected: true }
  if (typeof why === 'object' && 'held' in why) return { ok: false, at: at as { child: number; count: true }, held: why.held }
  if (why === 'gone') return { ok: false, at: 'record', failure: RECORD_GONE }
  if (why === 'unchanged') return { ok: false, at, failure: await unchanged(sql, at, record, children, path) }
  // A SET or the LOCK, refused by the server before the record's step: the save as a whole.
  if (at === 'save') return { ok: false, at, failure: recordFailure(why.refused, sent ? 'write' : 'read') }
  return { ok: false, at, failure: await refused(sql, at, why.refused, record, children, path) }
}

/**
 * The record and its rows in one transaction (0155), or the one step that
 * refused it, with nothing stored. A malformed request is thrown before
 * anything is sent. Never retried: a connection lost once the record's step
 * was sent is `unknown-outcome`, though COMMIT was never sent, and one lost
 * before is `unavailable` -- `lockedTransaction`'s rule, for the same fact.
 * COMMIT or BEGIN refused with the connection still there -- a deferred
 * constraint, 40001 under SERIALIZABLE -- rolled back, and that refusal is
 * the answer, at `save` (0031 P2b).
 */
export async function savePostgres(sql: Sql, request: SaveRequest): Promise<SaveOutcome> {
  if (!Number.isSafeInteger(request.deadlineMs) || request.deadlineMs < 1) throw new TypeError('A save deadline is a whole number of milliseconds above 0.')
  const record = prepareRecord(request.record)
  const children = request.children.map(prepareChild)
  const path: WritePath = children.some((child) => child.deletes.some(({ terms }) => reachesPast(terms.reach))) ? 'locked' : pathOf(record.definition)
  const refusedUnsent = await unversioned(sql, record, children, path)
  if (refusedUnsent !== undefined) return refusedUnsent

  let sent = false
  try {
    return await sql.begin((tx) =>
      steps(tx, request, record, children, path, () => {
        sent = true
      }),
    )
  } catch (error) {
    if (error instanceof Stopped) return answered(sql, error, request, record, children, path, sent)
    // A refusal the server sent is translated whatever was sent before it; a
    // connection lost is unknown once the record's step was sent.
    return { ok: false, at: 'save', failure: recordFailure(error, sent ? 'write' : 'read') }
  }
}
