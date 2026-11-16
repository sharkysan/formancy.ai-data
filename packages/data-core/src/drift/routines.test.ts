import { describe, expect, test } from 'vitest'
import { ACTION_POLICY, actionForm, CLOSE_ORDER, pgParameter, pgRoutine, routineSnapshot, SHIP, SHIP_ORDER, withRoutines } from '../actions/test-actions.js'
import type { MetadataSnapshot, ObjectMeta } from '../metadata.js'
import { factsSnapshot, restrict, snapshot } from '../records/test-support.js'
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
