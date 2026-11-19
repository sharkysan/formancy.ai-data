import { describe, expect, test } from 'vitest'
import {
  ACTION_POLICY,
  actionForm,
  CLOSE_ORDER,
  msParameter,
  msRoutine,
  pgParameter,
  pgRoutine,
  routineSnapshot,
  SHIP,
  SHIP_ORDER,
  withRoutines,
} from '../actions/test-actions.js'
import type { ActionChoice } from '../actions/types.js'
import { type BoundAction, bindAction } from '../generate/actions.js'
import type { ConcurrencyBinding, FormBindings } from '../generate/types.js'
import type { ColumnMeta, MetadataSnapshot, ObjectMeta } from '../metadata.js'
import { factsSnapshot, INT64, orderForm, restrict, snapshot } from '../records/test-support.js'
import type { RoutineMeta } from '../routines.js'
import { createSnapshot } from '../snapshot.js'
import { diffSnapshots } from './fixture.js'
import type { DriftReport } from './types.js'

/*
 * Drift against a form's actions (0159), row by row: a bound routine gone,
 * changed in what a call rests on, no longer executable or out of sight
 * blocks the actions over it, and only them; one that reaches past its
 * caller's grants where it did not is for review; a routine nothing binds
 * is a note. A change to the root stops the actions that rest on what it
 * changed. Every report passes through `fixture.ts`'s check that the
 * runtime never refuses an action review lets run.
 */

const BASE = routineSnapshot()
const { bindings: BINDINGS } = actionForm(BASE)

function review(current: MetadataSnapshot, base: MetadataSnapshot = BASE): DriftReport {
  return diffSnapshots(base, current, base === BASE ? BINDINGS : actionForm(base).bindings, ACTION_POLICY)
}

/** The base's routines with `ship_order` replaced, and these beside them. */
function shipped(routine: RoutineMeta | null, ...more: RoutineMeta[]): MetadataSnapshot {
  return routineSnapshot('postgres', [...(routine === null ? [] : [routine]), CLOSE_ORDER, ...more])
}

const rows = (report: DriftReport) =>
  report.changes.map((change) => [change.kind, change.severity, change.subject.kind === 'routine' ? change.subject.routine.name : ''])

/**
 * The order on SQL Server with `ship` bound over `ship`, a procedure by
 * the order's id, on its rowversion with `notes` confirmed as the touch
 * column a run sets (0155).
 */
function sqlServerShip(ship: RoutineMeta): { base: MetadataSnapshot; bindings: FormBindings } {
  const base = withRoutines(snapshot('sqlserver'), [ship])
  const generated = orderForm(base).bindings
  const concurrency: ConcurrencyBinding = { ...(generated.concurrency as ConcurrencyBinding), touch: 'notes' }
  const root = base.objects.find((object) => object.ref.name === 'order') as ObjectMeta
  const choice: ActionChoice = { ...SHIP, routine: ship.ref, parameters: [{ parameter: '@order_id', from: { key: 'id' } }] }
  const bound = bindAction(base, root, { identity: generated.identity, concurrency, fields: generated.fields }, choice) as BoundAction
  return { base, bindings: { ...generated, concurrency, actions: [{ ...bound, dialog: null }] } }
}

describe('a routine an action binds', () => {
  // Gone, with no gap to say the account lost sight of it: `ship` cannot
  // run, and only `ship`; every write the form offers is untouched.
  // Watched failing with the routines family left out of `diffSnapshots`:
  // no change, and `ship` still runnable.
  test('dropped blocks its actions alone', () => {
    const report = review(shipped(null))
    expect(rows(report)).toEqual([['routine-dropped', 'blocking', 'ship_order']])
    expect(report.actions).toEqual(['close'])
    expect(report.writable).toEqual({ create: true, update: true, delete: false })
    expect(report.runtime.actions).toEqual(['close'])
  })

  // Its parameters' names, types, modes or order, what it returns, or its
  // kind: what a call is spelled from. The runtime refuses it too, as a
  // request compares the routine it describes by the same shape. Watched
  // failing with `callShape` comparing names alone.
  test('changed in what a call rests on blocks its actions', () => {
    const retyped = { ...SHIP_ORDER, parameters: [SHIP_ORDER.parameters[0] as RoutineMeta['parameters'][number], pgParameter('tenant', 'int8')] }
    const report = review(shipped(retyped))
    expect(rows(report)).toEqual([['routine-changed', 'blocking', 'ship_order']])
    expect(report.actions).toEqual(['close'])
    expect(report.runtime.actions).toEqual(['close'])
  })

  // EXECUTE revoked: every run would be refused by the database. Watched
  // failing with the executable check taken out.
  test('no longer executable blocks its actions', () => {
    const report = review(shipped({ ...SHIP_ORDER, executable: false }))
    expect(rows(report)).toEqual([['privilege-narrowed', 'blocking', 'ship_order']])
    expect(report.actions).toEqual(['close'])
  })

  // SECURITY DEFINER turned on: the routine may now act beyond the
  // account's grants. Somebody decides; nothing stops, and the runtime
  // runs it. Watched failing with reach compared in `callShape`: it
  // blocked.
  test('reaching beyond its caller’s grants is for review, and stops nothing', () => {
    const report = review(shipped({ ...SHIP_ORDER, reach: 'owner' }))
    expect(rows(report)).toEqual([['routine-reach-changed', 'review', 'ship_order']])
    expect(report.actions).toEqual(['ship', 'close'])
    expect(report.runtime.actions).toEqual(['ship', 'close'])
  })

  // Made STRICT since publication (0167): PostgreSQL no longer calls it
  // given a NULL, and the run's description refuses it (0160). It stops
  // its actions alone, at review and at the runtime, in the generator's
  // words. Watched failing on 2026-11-19 with `madeStrict` answering null:
  // a `routine-changed` for review, which stops nothing; and with it left
  // out of `runtimeRoutineStops` alone: "expected [ 'ship', 'close' ] to
  // deeply equal [ 'close' ]".
  test('made STRICT blocks its actions, at review and at the runtime', () => {
    const base = routineSnapshot('postgres', [{ ...SHIP_ORDER, onNull: 'called' }, CLOSE_ORDER])
    const report = review(routineSnapshot('postgres', [{ ...SHIP_ORDER, onNull: 'not-called' }, CLOSE_ORDER]), base)
    expect(rows(report)).toEqual([['routine-changed', 'blocking', 'ship_order']])
    expect(report.changes[0]?.message).toBe(
      'sales.ship_order(pg_catalog.int8, pg_catalog.int4) is STRICT: PostgreSQL does not call it when an argument is NULL, so a run would answer done for a call that never ran; it was not when the form was published. ship is blocked until the form is reviewed.',
    )
    expect(report.actions).toEqual(['close'])
    expect(report.runtime.actions).toEqual(['close'])
  })

  // STRICT's rule is PostgreSQL's alone (0167): a run on SQL Server calls
  // a procedure, which the engine always calls. A bound procedure dropped
  // and created again as a scalar function declared RETURNS NULL ON NULL
  // INPUT changed what a call of it rests on, and that one change says so,
  // without a second in PostgreSQL's words beside it. Watched failing on
  // 2026-11-19 with `madeStrict` asked whatever the engine: "expected [ [
  // 'routine-changed', …(2) ], …(1) ] to deeply equal [ [
  // 'routine-changed', …(2) ] ]".
  test('on SQL Server, a procedure become a function not called given a NULL is one change of what a call rests on', () => {
    const ship = msRoutine('ship_order', [msParameter('@order_id', '127:8:19:0', INT64, 'bigint')], { onNull: 'called' })
    const { base, bindings } = sqlServerShip(ship)
    const result = { typeId: '127:8:19:0', databaseType: 'bigint', type: INT64 }
    const current = withRoutines(snapshot('sqlserver'), [{ ...ship, kind: 'function', effects: 'reads', returns: 'scalar', result, onNull: 'not-called' }])
    const report = diffSnapshots(base, current, bindings, ACTION_POLICY)
    expect(rows(report)).toEqual([['routine-changed', 'blocking', 'ship_order']])
    expect(report.changes[0]?.message).toMatch(/changed what a call of it rests on/)
    expect(report.actions).toEqual([])
    expect(report.runtime.actions).toEqual([])
  })

  // A snapshot taken before 0167 did not read whether PostgreSQL calls a
  // routine given a NULL: read for the first time, the fact is no change of
  // the routine, either way, and stops nothing -- the run's description
  // still refuses a STRICT one (0160). Watched failing on 2026-11-19 with
  // the routine compared whole: "called: expected [ [ 'routine-changed',
  // …(2) ] ] to deeply equal []".
  test('whether it is called given a NULL, read for the first time, is no change', () => {
    for (const onNull of ['called', 'not-called'] as const) {
      const report = review(routineSnapshot('postgres', [{ ...SHIP_ORDER, onNull }, CLOSE_ORDER]))
      expect(rows(report), onNull).toEqual([])
      expect(report.actions, onNull).toEqual(['ship', 'close'])
      expect(report.runtime.actions, onNull).toEqual(['ship', 'close'])
    }
  })

  // What a call does not rest on -- what it may change -- is said for
  // review and stops nothing. Watched failing with every change of a bound
  // routine read as a call's.
  test('changed in what a call does not rest on is for review', () => {
    expect(rows(review(shipped({ ...SHIP_ORDER, effects: 'reads' })))).toEqual([['routine-changed', 'review', 'ship_order']])
  })

  // Out of sight is not gone (0004): a routines gap that covers it says
  // why, once, and the action stops as it would if it were gone. Watched
  // failing with gaps unasked: `routine-dropped`, and the gap again on its
  // own.
  test('out of sight behind a gap blocks its actions, and the gap is said once', () => {
    const hidden = withRoutines(
      snapshot('postgres'),
      [CLOSE_ORDER],
      [{ subject: { kind: 'schema', schema: 'sales' }, aspect: 'routines', detail: 'not listed' }],
    )
    const report = review(hidden)
    expect(rows(report)).toEqual([['access-narrowed', 'blocking', 'ship_order']])
    expect(report.changes[0]?.message).toMatch(/is not visible to this connection: "not listed"/)
  })

  // In a schema discovery is no longer approved for, the snapshot cannot
  // say whether it is there: the routine's action stops, as a table out of
  // scope stops its form. Watched failing with scope unasked: the routine
  // was said to be gone.
  test('out of scope blocks its actions', () => {
    const inOps = { ...SHIP_ORDER, ref: { ...SHIP_ORDER.ref, schema: 'ops' } }
    const scoped = (schemas: string[], routines: RoutineMeta[]) => {
      const source = snapshot('postgres')
      return createSnapshot({ ...source, scope: { schemas, routines: true }, routines })
    }
    const base = scoped(['ops', 'sales'], [inOps, CLOSE_ORDER])
    const ship = { ...SHIP, routine: inOps.ref }
    const report = diffSnapshots(base, scoped(['sales'], [CLOSE_ORDER]), actionForm(base, [ship]).bindings, ACTION_POLICY)
    expect(rows(report)).toEqual([['scope-narrowed', 'blocking', 'ship_order']])
    expect(report.actions).toEqual([])
  })

  // Discovered without routines, the current snapshot cannot say whether
  // a bound routine is still there: each action over one stops, as a
  // column out of sight stops what rests on it. Watched failing with
  // routines compared only where both record them: nothing was said.
  test('unknown, where the current snapshot does not record routines, blocks its actions', () => {
    const report = review(snapshot('postgres'))
    expect(rows(report)).toEqual([
      ['access-narrowed', 'blocking', 'close_order'],
      ['access-narrowed', 'blocking', 'ship_order'],
    ])
    expect(report.actions).toEqual([])
  })

  // An overload beside which every call of the bound one is ambiguous
  // (0158, R7): every run would fail. Said once, on the new routine, and
  // not again as a routine nothing binds. Watched failing with ambiguity
  // left to the runtime: an `info` note.
  test('made ambiguous by a new overload blocks its actions', () => {
    const longer = pgRoutine('ship_order', [pgParameter('order_id', 'int8'), pgParameter('tenant', 'int4'), pgParameter('note', 'text', { hasDefault: true })])
    const report = review(shipped(SHIP_ORDER, longer))
    expect(report.changes.map((change) => [change.kind, change.severity])).toEqual([['routine-added', 'blocking']])
    expect(report.actions).toEqual(['close'])
  })

  // An overload that was there and gained a default is not new: it is
  // said as the change it is, on it, and blocks the action it made
  // ambiguous. Watched failing with every such overload called new:
  // `routine-added`.
  test('made ambiguous by an overload that changed blocks its actions, said as a change', () => {
    const overload = (hasDefault: boolean) =>
      pgRoutine('ship_order', [pgParameter('order_id', 'int8'), pgParameter('tenant', 'int4'), pgParameter('note', 'text', { hasDefault })])
    const report = review(shipped(SHIP_ORDER, overload(true)), shipped(SHIP_ORDER, overload(false)))
    expect(report.changes.map((change) => [change.kind, change.severity, change.message])).toEqual([
      [
        'routine-changed',
        'blocking',
        expect.stringMatching(/^sales\.ship_order\(pg_catalog\.int8, pg_catalog\.int4, pg_catalog\.text\) changed, and now has a parameter of each/),
      ],
    ])
    expect(report.actions).toEqual(['close'])
  })
})

describe('a routine no action binds', () => {
  // Between two snapshots that both record routines, a routine new,
  // changed or gone in scope is a note: nothing stops. Watched failing
  // with unbound routines compared as bound ones: `routine-added` blocked.
  test('appeared, changed or went, and stops nothing', () => {
    const other = pgRoutine('archive_order', [pgParameter('order_id', 'int8')])
    const base = routineSnapshot('postgres', [SHIP_ORDER, CLOSE_ORDER, other])
    expect(rows(review(shipped(SHIP_ORDER, pgRoutine('reopen_order', [pgParameter('order_id', 'int8')])), base))).toEqual([
      ['routine-dropped', 'info', 'archive_order'],
      ['routine-added', 'info', 'reopen_order'],
    ])
    expect(rows(review(shipped(SHIP_ORDER, { ...other, executable: false }), base))).toEqual([['routine-changed', 'info', 'archive_order']])
  })

  // Read for the first time, whether the engine calls a routine given a
  // NULL is no change of one nothing binds either; between two snapshots
  // that both say, a change of it is a note like any other (0167). Watched
  // failing on 2026-11-19 with routines compared whole: "expected [ [
  // 'routine-changed', 'info', …(1) ] ] to deeply equal []".
  test('whether it is called given a NULL is a note only where both snapshots say', () => {
    const other = pgRoutine('archive_order', [pgParameter('order_id', 'int8')])
    const unknown = routineSnapshot('postgres', [SHIP_ORDER, CLOSE_ORDER, other])
    expect(rows(review(shipped(SHIP_ORDER, { ...other, onNull: 'not-called' }), unknown))).toEqual([])
    const known = routineSnapshot('postgres', [SHIP_ORDER, CLOSE_ORDER, { ...other, onNull: 'called' }])
    expect(rows(review(shipped(SHIP_ORDER, { ...other, onNull: 'not-called' }), known))).toEqual([['routine-changed', 'info', 'archive_order']])
  })
})

describe('a change of the root', () => {
  // The approver `approve` passes, widened to a bigint its int4 parameter
  // cannot hold: `approve` stops, `ship` -- which passes no column but the
  // key -- does not, and neither do the writes the widening leaves safe.
  // Watched failing with the column rule taken out of `rootActionStops`:
  // `approve` still ran.
  test('stops the actions that pass a column its parameter no longer holds', () => {
    const approveOrder = pgRoutine('approve_order', [pgParameter('order_id', 'int8'), pgParameter('approver', 'int4')])
    const approve = {
      name: 'approve',
      routine: approveOrder.ref,
      scope: 'record' as const,
      parameters: [
        { parameter: 'order_id', from: { key: 'id' } },
        { parameter: 'approver', from: { field: 'approved_by' } },
      ],
    }
    const base = routineSnapshot('postgres', [SHIP_ORDER, approveOrder])
    const { bindings } = actionForm(base, [SHIP, approve])
    const widened = withRoutines(
      snapshot('postgres', (objects) => {
        const approver = (objects.find((object) => object.ref.name === 'order') as ObjectMeta).columns.find((column) => column.name === 'approved_by')
        if (approver !== undefined) approver.type = { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' }
      }),
      [SHIP_ORDER, approveOrder],
    )
    const report = diffSnapshots(base, widened, bindings, ACTION_POLICY)
    expect(report.actions).toEqual(['ship'])
    expect(report.runtime.actions).toEqual(['ship'])
    expect(report.changes.find((change) => change.subject.kind === 'column')?.severity).toBe('blocking')
  })

  // A run moves the version column: the account's UPDATE on it lost stops
  // every action. The DELETE grant lost stops delete and no action, which
  // deletes nothing. Watched failing with every privilege change read as
  // the record's address: the DELETE grant stopped both actions.
  test('stops every action where a run cannot move the version, and none for a delete’s grant', () => {
    const facts = (edit: (objects: ObjectMeta[]) => void = () => {}, mayDelete?: (object: ObjectMeta) => boolean) =>
      withRoutines(factsSnapshot('postgres', edit, mayDelete), [SHIP_ORDER, CLOSE_ORDER])
    const base = facts()
    const unmoved = review(
      facts((objects) => restrict(objects, 'order', 'row_version', { update: false })),
      base,
    )
    expect(unmoved.actions).toEqual([])
    expect(unmoved.changes.map((change) => [change.kind, change.severity])).toEqual([['privilege-narrowed', 'blocking']])
    const undeletable = review(
      facts(
        () => {},
        (object) => object.ref.name !== 'order',
      ),
      base,
    )
    expect(undeletable.actions).toEqual(['ship', 'close'])
  })

  // A version that no longer proves the record stops delete for the
  // record's own sake, not a delete's: an old read would act on a record
  // created again under its key (0050), so every action stops, at review
  // and at the runtime, though no action passes a column the change is
  // about -- here the key's column no longer numbered by the database.
  // Watched failing with that rule taken out of `rootActionStops`: both
  // actions still ran.
  test('stops every action where the version no longer proves the record, its key unnumbered', () => {
    const unnumbered = withRoutines(
      snapshot('postgres', (objects) => {
        ;((objects.find((object) => object.ref.name === 'order') as ObjectMeta).columns[0] as ColumnMeta).generated = 'none'
      }),
      [SHIP_ORDER, CLOSE_ORDER],
    )
    const report = review(unnumbered)
    expect(report.actions).toEqual([])
    expect(report.runtime.actions).toEqual([])
    expect(report.changes.map((change) => [change.kind, change.severity, change.subject.kind])).toEqual([['column-generation-changed', 'blocking', 'column']])
  })

  // The same, where a new foreign key takes a key its never-repeating
  // default filled (0057): a lookup over it would write the key. Watched
  // failing with that rule taken out of `rootActionStops`: `ship` still
  // ran.
  test('stops every action where the version no longer proves the record, its key taken by a foreign key', () => {
    const uuidKey = (objects: ObjectMeta[]) => {
      const id = (objects.find((object) => object.ref.name === 'order') as ObjectMeta).columns[0] as ColumnMeta
      Object.assign(id, { databaseType: 'uuid', type: { kind: 'uuid' }, generated: 'none', hasDefault: true, defaultExpression: 'gen_random_uuid()' })
    }
    const shipByUuid = pgRoutine('ship_order', [pgParameter('order_id', 'uuid'), pgParameter('tenant', 'int4')])
    const ship: ActionChoice = { ...SHIP, routine: shipByUuid.ref }
    const base = routineSnapshot('postgres', [shipByUuid], uuidKey)
    const { bindings } = actionForm(base, [ship])
    expect(bindings.actions?.map((action) => action.name)).toEqual(['ship'])
    const taken = routineSnapshot('postgres', [shipByUuid], (objects) => {
      uuidKey(objects)
      ;(objects.find((object) => object.ref.name === 'order') as ObjectMeta).foreignKeys.push({
        name: 'fk_order_mirror',
        columns: ['id'],
        references: { table: { schema: 'sales', name: 'employee' }, columns: ['id'] },
        onUpdate: 'no-action',
        onDelete: 'no-action',
        enforced: true,
        validated: true,
      })
    })
    const reviewed = diffSnapshots(base, taken, bindings, ACTION_POLICY)
    expect(reviewed.actions).toEqual([])
    expect(reviewed.runtime.actions).toEqual([])
    expect(reviewed.changes.find((change) => change.subject.kind === 'foreign-key')?.severity).toBe('blocking')
  })

  // On a rowversion form a run sets the confirmed touch column to itself
  // (0155): one the account may no longer UPDATE, or one the database now
  // computes, is one no run can set, so the actions that move by it stop.
  // A privilege is review's: a request's description of the root carries
  // none, and the database refuses the run's UPDATE itself (0041); a
  // computed column is in the description, and the runtime stops the
  // action too. Watched failing with `touchColumnProblem` unasked in
  // `stillServes`: `ship` still ran.
  test('stops the actions whose touch column a run can no longer set', () => {
    const ship = msRoutine('ship_order', [msParameter('@order_id', '127:8:19:0', INT64, 'bigint')])
    const { base, bindings } = sqlServerShip(ship)
    expect(diffSnapshots(base, base, bindings, ACTION_POLICY).actions).toEqual(['ship'])
    const current = withRoutines(
      snapshot('sqlserver', (objects) => restrict(objects, 'order', 'notes', { update: false })),
      [ship],
    )
    const report = diffSnapshots(base, current, bindings, ACTION_POLICY)
    expect(report.actions).toEqual([])
    expect(report.runtime.actions).toEqual(['ship'])
    const computed = withRoutines(
      snapshot('sqlserver', (objects) => {
        ;((objects.find((object) => object.ref.name === 'order') as ObjectMeta).columns.find((column) => column.name === 'notes') as ColumnMeta).generated =
          'computed'
      }),
      [ship],
    )
    const recomputed = diffSnapshots(base, computed, bindings, ACTION_POLICY)
    expect(recomputed.actions).toEqual([])
    expect(recomputed.runtime.actions).toEqual([])
  })

  // The key a run locates its record by, gone or out of sight: every
  // action stops, as update and delete do. A keys gap is an access change,
  // whose stop of delete would otherwise read as a delete's own. Watched
  // failing with the rule for a change that stops update and delete
  // together taken out: the gap left both actions running.
  test('stops every action where the record can no longer be found by its key', () => {
    const unkeyed = withRoutines(
      snapshot('postgres', (objects) => {
        ;(objects.find((object) => object.ref.name === 'order') as ObjectMeta).primaryKey = null
      }),
      [SHIP_ORDER, CLOSE_ORDER],
    )
    expect(review(unkeyed).actions).toEqual([])
    const keys = { subject: { kind: 'object' as const, object: { schema: 'sales', name: 'order' } }, aspect: 'keys' as const, detail: 'keys hidden' }
    const report = review(withRoutines(snapshot('postgres'), [SHIP_ORDER, CLOSE_ORDER], [keys]))
    expect(report.actions).toEqual([])
    expect(report.changes.map((change) => [change.kind, change.severity])).toEqual([['access-narrowed', 'blocking']])
  })
})
