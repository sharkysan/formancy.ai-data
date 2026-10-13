import { describe, expect, test } from 'vitest'
import type { CoverageGap, ForeignKeyMeta, InboundKey, ObjectMeta } from '../metadata.js'
import { col, factsSnapshot, fk, INT32, INT64, MS, MS_FACTS, ORDER_POLICY, orderForm, sales, table, text } from '../records/test-support.js'
import { createSnapshot } from '../snapshot.js'
import { deleteEffects, deleteProblems, deleteReach, unaccepted } from './cascades.js'
import type { CascadeRule, FormPolicy } from './types.js'

/*
 * What a delete of one of the order form's records also does, and whether
 * a policy may grant it (0050, 0051): one decision, asked at publish, on
 * every read of a bundle, by the planner and -- through `unaccepted` -- by
 * drift review. A delete reaches another table's rows only through a
 * foreign key the policy's `cascades` names with its action; the account
 * must be able to DELETE from every table it reaches; and whatever cannot
 * be seen -- a table outside the scope, a key out of sight, a change that
 * other keys follow -- is refused rather than taken for nothing.
 */

const DELETING: FormPolicy = { ...ORDER_POLICY, operations: { ...ORDER_POLICY.operations, delete: ['clerk'] } }

const LINE_KEY: CascadeRule = { table: sales('order_line'), foreignKey: 'fk_order_line_order', onDelete: 'cascade' }
const NOTE_KEY: CascadeRule = { table: sales('line_note'), foreignKey: 'fk_line_note_line', onDelete: 'cascade' }
const accepting = (...cascades: CascadeRule[]): FormPolicy => ({ ...DELETING, cascades })

function acting(key: ForeignKeyMeta, onDelete: InboundKey['onDelete'], onUpdate: InboundKey['onUpdate'] = 'no-action'): ForeignKeyMeta {
  return { ...key, onDelete, onUpdate }
}

/** The test snapshot with 0049's facts, its order_line key onto order doing `onDelete`. */
function lines(onDelete: InboundKey['onDelete'], enforced = true, edit: (objects: ObjectMeta[]) => void = () => {}, mayDelete?: (object: ObjectMeta) => boolean) {
  return factsSnapshot(
    'sqlserver',
    (objects) => {
      const key = objects.find((object) => object.ref.name === 'order_line')?.foreignKeys.find((candidate) => candidate.name === 'fk_order_line_order')
      if (key !== undefined) Object.assign(key, { onDelete, enforced })
      edit(objects)
    },
    mayDelete,
  )
}

/** A note on each line, which goes when its line does: a cascade two levels below the order. */
function noted(onDelete: InboundKey['onDelete'] = 'cascade') {
  return (objects: ObjectMeta[]) => {
    objects.push(
      table('line_note', [col('id', 1, INT32, { generated: 'identity-always' }), col('order_id', 2, INT64), col('line_no', 3, INT32), col('note', 4, text(50))], {
        primaryKey: { name: 'pk_line_note', columns: ['id'] },
        foreignKeys: [acting(fk('fk_line_note_line', ['order_id', 'line_no'], 'order_line', ['order_id', 'line_no']), onDelete)],
      }),
    )
  }
}

/**
 * A memo on an order, whose reference a delete of the order clears, and
 * which a copy refers to by that reference, doing `follows` when it changes
 * and `onDelete` when a memo is deleted -- which a delete of an order never
 * does, since it keeps the memo.
 */
function memo(follows: InboundKey['onUpdate'], onDelete: InboundKey['onDelete'] = 'no-action') {
  return (objects: ObjectMeta[]) => {
    objects.push(
      table('order_memo', [col('id', 1, INT32, { generated: 'identity-always' }), col('order_id', 2, INT64, { nullable: true }), col('memo', 3, text(50))], {
        primaryKey: { name: 'pk_order_memo', columns: ['id'] },
        uniqueKeys: [{ name: 'uq_order_memo_order', columns: ['order_id'] }],
        foreignKeys: [acting(fk('fk_order_memo_order', ['order_id'], 'order', ['id']), 'set-null')],
      }),
      table('memo_copy', [col('id', 1, INT32), col('order_id', 2, INT64, { nullable: true })], {
        primaryKey: { name: 'pk_memo_copy', columns: ['id'] },
        foreignKeys: [acting(fk('fk_memo_copy_memo', ['order_id'], 'order_memo', ['order_id']), onDelete, follows)],
      }),
    )
  }
}
const MEMO_KEY: CascadeRule = { table: sales('order_memo'), foreignKey: 'fk_order_memo_order', onDelete: 'set-null' }
const MEMO_COPY_KEY: CascadeRule = { table: sales('memo_copy'), foreignKey: 'fk_memo_copy_memo', onDelete: 'cascade' }

/** The order referred to as well by a key from a table outside the snapshot. */
function copied(onDelete: InboundKey['onDelete']) {
  return factsSnapshot('sqlserver', (objects: ObjectMeta[]) => {
    const order = objects.find((object) => object.ref.name === 'order') as ObjectMeta
    order.referencedBy = [{ table: { schema: 'audit', name: 'order_copy' }, name: 'fk_copy', columns: ['order_id', 'kept'], referencedColumns: ['id', 'tenant_id'], onDelete, onUpdate: 'no-action', enforced: true }]
  })
}
const COPY_KEY = (onDelete: CascadeRule['onDelete']): CascadeRule => ({ table: { schema: 'audit', name: 'order_copy' }, foreignKey: 'fk_copy', onDelete })

/** `source` again, with `gaps`. */
function gapped(source: ReturnType<typeof lines>, gaps: CoverageGap[]) {
  const { fingerprint: _fingerprint, ...rest } = source
  return createSnapshot({ ...rest, gaps })
}

function problems(snapshot: ReturnType<typeof lines>, policy: FormPolicy): string[] {
  return deleteProblems(snapshot, orderForm(snapshot).bindings, policy)
}

describe('deleteProblems', () => {
  // A policy that grants delete to nobody makes no claim about what a
  // delete does, whatever the database would do on one.
  test('says nothing of a policy that grants nobody delete', () => {
    expect(problems(lines('cascade'), ORDER_POLICY)).toEqual([])
    expect(problems(lines('cascade'), { ...ORDER_POLICY, operations: { ...ORDER_POLICY.operations, delete: [] } })).toEqual([])
  })

  // The fixture's lines cascade from their order. Granted without naming
  // the key, a delete of an order would delete rows no form governs;
  // clearing a reference or setting a default is as much a change to
  // another table's rows. Each key is named, with its table and action
  // (watched failing with every grant accepted).
  test('refuses a grant while a key that deletes, clears or defaults rows on delete is not named', () => {
    expect(problems(lines('cascade'), DELETING)).toEqual([
      'operations.delete grants roles, and deleting a record of sales.order also deletes rows of sales.order_line (fk_order_line_order, ON DELETE CASCADE), which cascades does not accept',
    ])
    expect(problems(copied('set-null'), DELETING)).toEqual([
      'operations.delete grants roles, and deleting a record of sales.order also sets order_id, kept of audit.order_copy to NULL in the rows that refer to it (fk_copy, ON DELETE SET NULL), which cascades does not accept',
      'operations.delete grants roles, and deleting a record of sales.order also changes rows of audit.order_copy, outside the approved schemas, and what follows from that change cannot be seen',
    ])
    expect(problems(copied('set-default'), DELETING)).toContain(
      'operations.delete grants roles, and deleting a record of sales.order also sets order_id, kept of audit.order_copy to its default in the rows that refer to it (fk_copy, ON DELETE SET DEFAULT), which cascades does not accept',
    )
  })

  // Named with its action, the key is accepted (0051): the delete takes the
  // order's lines with it, which the administrator has said they know.
  test('accepts a grant that names every key a delete acts through, with its action', () => {
    expect(problems(lines('cascade'), accepting(LINE_KEY))).toEqual([])
  })

  // A key that only refuses a delete -- NO ACTION, RESTRICT -- is the
  // database's to enforce: a delete of a record still referred to is
  // refused there, and nothing else is changed. Nothing to name, so a
  // grant over it stands (watched failing with every grant over a RESTRICT
  // key refused).
  test('accepts a grant while the keys that refer to the root only refuse a delete', () => {
    for (const action of ['no-action', 'restrict'] as const) expect(problems(lines(action), DELETING), action).toEqual([])
  })

  // A key whose triggers are disabled still acts on PostgreSQL when they
  // are the referring table's checks (0049), and one enabled again acts with
  // nothing here noticing: counted whatever `enforced` says.
  test('counts an acting key whatever its enforcement', () => {
    expect(problems(lines('cascade', false), DELETING)).toHaveLength(1)
    expect(problems(lines('cascade', false), accepting(LINE_KEY))).toEqual([])
  })

  // A cascade is followed past the first table: the order's lines take
  // their notes with them, and a policy that names the lines' key alone has
  // accepted half of what the delete does (watched failing with the reach
  // of the root alone: the note's key went unasked).
  test('follows a cascade two levels down, and needs both keys named', () => {
    const snapshot = lines('cascade', true, noted())
    expect(problems(snapshot, accepting(LINE_KEY))).toEqual([
      'operations.delete grants roles, and deleting a record of sales.order also deletes rows of sales.line_note (fk_line_note_line, ON DELETE CASCADE), which cascades does not accept',
    ])
    expect(problems(snapshot, accepting(LINE_KEY, NOTE_KEY))).toEqual([])
  })

  // A key accepted as a cascade that has become SET NULL does something
  // else, which nobody accepted; an acceptance of a key the delete does not
  // reach says something untrue, as a through over nothing would (0011)
  // (watched failing with names accepted without their action).
  test('refuses an acceptance with another action, and one of a key a delete does not reach', () => {
    expect(problems(lines('set-null'), accepting(LINE_KEY))).toEqual([
      'operations.delete grants roles, and deleting a record of sales.order also sets order_id of sales.order_line to NULL in the rows that refer to it (fk_order_line_order, ON DELETE SET NULL), which cascades does not accept',
      'cascades[0] accepts fk_order_line_order of sales.order_line as ON DELETE CASCADE, and it is ON DELETE SET NULL',
    ])
    expect(problems(lines('cascade'), accepting(LINE_KEY, { table: sales('customer'), foreignKey: 'fk_customer_country', onDelete: 'cascade' }))).toEqual([
      'cascades[1] accepts fk_customer_country of sales.customer, and no such key refers to a table a delete of sales.order reaches',
    ])
    expect(problems(lines('no-action'), accepting(LINE_KEY))).toEqual(['cascades[0] accepts fk_order_line_order of sales.order_line as ON DELETE CASCADE, and it is ON DELETE NO ACTION'])
  })

  // A delete keeps the rows whose reference it clears, so a key onto a
  // cleared table is read for its ON UPDATE alone, and its ON DELETE never
  // runs. An acceptance of it as the cascade it is on paper says the delete
  // does what it does not (watched failing with the cleared table's keys
  // matched as the removed tables' are: the policy was accepted).
  test("refuses an acceptance of a key onto a table the delete only clears, whatever that key's ON DELETE", () => {
    expect(problems(lines('no-action', true, memo('no-action', 'cascade')), accepting(MEMO_KEY))).toEqual([])
    expect(problems(lines('no-action', true, memo('no-action', 'cascade')), accepting(MEMO_KEY, MEMO_COPY_KEY))).toEqual([
      "cascades[1] accepts fk_memo_copy_memo of sales.memo_copy, and a delete of sales.order does not act through it: it refers to sales.order_memo, whose rows a delete keeps and clears a reference in",
    ])
  })

  // A table outside the approved schemas is only a name in the snapshot:
  // what refers to it, whether the account may delete from it, nothing is
  // known. A cascade into it is refused even when named.
  test('refuses a cascade into a table outside the scope, named or not', () => {
    expect(problems(copied('cascade'), accepting(COPY_KEY('cascade')))).toEqual([
      'operations.delete grants roles, and deleting a record of sales.order also deletes rows of audit.order_copy, outside the approved schemas, and what that reaches in turn cannot be seen',
    ])
    expect(problems(copied('set-null'), accepting(COPY_KEY('set-null')))).toEqual([
      'operations.delete grants roles, and deleting a record of sales.order also changes rows of audit.order_copy, outside the approved schemas, and what follows from that change cannot be seen',
    ])
  })

  // A reference set NULL is a change to the referring row's columns, and a
  // key that refers to those columns with ON UPDATE CASCADE, SET NULL or SET
  // DEFAULT carries the change on into a third table. Followed that far, a
  // delete would reach rows through a key nobody could have named in
  // `cascades`, so it is refused; one that only refuses the change is the
  // database's to enforce.
  test('refuses a SET NULL whose columns another key follows on update', () => {
    expect(problems(lines('no-action', true, memo('cascade')), accepting(MEMO_KEY))).toEqual([
      'operations.delete grants roles, and deleting a record of sales.order also sets order_id of sales.order_memo to NULL in the rows that refer to it (fk_order_memo_order, ON DELETE SET NULL), and fk_memo_copy_memo of sales.memo_copy follows order_id ON UPDATE CASCADE, which a delete does not follow',
    ])
    expect(problems(lines('no-action', true, memo('no-action')), accepting(MEMO_KEY))).toEqual([])
  })

  // Neither engine's cascade asks anything of the deleting account, so each
  // adapter asks DELETE on every table a delete reaches -- PostgreSQL's
  // statement, under the locks it takes first, and SQL Server's batch
  // (0051). A grant the adapter would refuse at the first request is
  // refused here.
  test('refuses a grant while the account may not DELETE from a table the delete reaches', () => {
    const notLines = (object: ObjectMeta) => object.ref.name !== 'order_line'
    expect(problems(lines('cascade', true, () => {}, notLines), accepting(LINE_KEY))).toEqual([
      "operations.delete grants roles, and deleting a record of sales.order reaches sales.order_line, which this connection's account may not DELETE from: a delete is held to the account's DELETE on every table it reaches",
    ])
    const notMemo = (object: ObjectMeta) => object.ref.name !== 'order_memo'
    expect(problems(lines('no-action', true, memo('no-action'), notMemo), accepting(MEMO_KEY))).toEqual([
      "operations.delete grants roles, and deleting a record of sales.order reaches sales.order_memo, which this connection's account may not DELETE from: a delete is held to the account's DELETE on every table it reaches",
    ])
  })

  // What a delete does cannot be seen from a snapshot taken before 0049,
  // nor from one that says it cannot see every key onto a table the delete
  // reaches: refused, rather than read as "nothing refers to it".
  test('refuses a grant over a snapshot that does not record, or cannot see, what refers to a table the delete reaches', () => {
    expect(deleteProblems(MS, orderForm(MS).bindings, DELETING)).toEqual([
      'operations.delete grants roles, and this snapshot does not record what refers to sales.order, so what a delete also does cannot be seen: discover again',
    ])
    const scope = gapped(MS_FACTS, [{ subject: { kind: 'scope' }, aspect: 'referenced-by', detail: 'this account lacks VIEW DEFINITION on the database' }])
    expect(problems(scope, DELETING)).toEqual(['operations.delete grants roles, and this snapshot cannot show everything that refers to sales.order: this account lacks VIEW DEFINITION on the database'])
    const elsewhere = gapped(MS_FACTS, [{ subject: { kind: 'object', object: sales('employee') }, aspect: 'referenced-by', detail: 'a key onto a partition' }])
    expect(problems(elsewhere, DELETING)).toEqual([])
    const below = gapped(lines('cascade'), [{ subject: { kind: 'object', object: sales('order_line') }, aspect: 'referenced-by', detail: 'a key onto a partition' }])
    expect(problems(below, accepting(LINE_KEY))).toEqual(['operations.delete grants roles, and this snapshot cannot show everything that refers to sales.order_line, which a delete of sales.order reaches: a key onto a partition'])
  })
})

describe('unaccepted', () => {
  // Drift review asks this of a key that appeared or changed: one the
  // policy names with that action is what the publish check accepts.
  test('is false for a key the policy names with its action, and true otherwise for one that acts', () => {
    const key = { table: sales('order_line'), name: 'fk_order_line_order', onDelete: 'cascade' } as const
    expect(unaccepted(accepting(LINE_KEY), key)).toBe(false)
    expect(unaccepted(DELETING, key)).toBe(true)
    expect(unaccepted(accepting(LINE_KEY), { ...key, onDelete: 'set-null' })).toBe(true)
    expect(unaccepted(accepting(LINE_KEY), { ...key, onDelete: 'no-action' })).toBe(false)
  })
})

describe('deleteReach', () => {
  // What a delete removes rows of, the root first and then the rest in
  // codepoint order; what it clears; and each key the policy accepts, with
  // the table it refers to, which the adapters' guards match the key itself
  // by. Whether the database may refuse it while the record is referred to
  // is what a page tells a person before they confirm.
  test('is the root, every table a cascade reaches, and every key the policy accepts', () => {
    expect(deleteReach(lines('no-action'), sales('order'), DELETING)).toEqual({ reach: { removed: [sales('order')], cleared: [], accepted: [] }, restricted: true })
    expect(deleteReach(lines('restrict'), sales('order'), DELETING).restricted).toBe(true)
    expect(deleteReach(MS_FACTS, sales('order_line'), DELETING).restricted).toBe(false)
    expect(deleteReach(lines('cascade', true, noted()), sales('order'), accepting(LINE_KEY, NOTE_KEY))).toEqual({
      reach: {
        removed: [sales('order'), sales('line_note'), sales('order_line')],
        cleared: [],
        accepted: [
          { from: sales('line_note'), name: 'fk_line_note_line', onto: sales('order_line'), onDelete: 'cascade' },
          { from: sales('order_line'), name: 'fk_order_line_order', onto: sales('order'), onDelete: 'cascade' },
        ],
      },
      restricted: false,
    })
    expect(deleteReach(lines('no-action', true, memo('no-action')), sales('order'), accepting(MEMO_KEY))).toEqual({
      reach: { removed: [sales('order')], cleared: [{ table: sales('order_memo'), columns: ['order_id'] }], accepted: [{ from: sales('order_memo'), name: 'fk_order_memo_order', onto: sales('order'), onDelete: 'set-null' }] },
      restricted: true,
    })
  })

  // Two keys of one table that each clear a reference to the order name
  // that table once among the tables cleared, with the columns of both:
  // the adapters lock it once and refuse any key that follows either column
  // ON UPDATE. Listed with the first key's columns alone, a key that follows
  // the second would carry the change on unseen. The refusal names the key
  // that clears the column followed (watched failing with the second key's
  // columns dropped, and with the first key named for the second's column).
  test("clears a table two keys refer to the root through once, with both keys' columns", () => {
    const twice = (follows: InboundKey['onUpdate']) => (objects: ObjectMeta[]) => {
      memo('no-action')(objects)
      const memoTable = objects.find((object) => object.ref.name === 'order_memo') as ObjectMeta
      memoTable.columns.push(col('reorder_id', 4, INT64, { nullable: true }))
      memoTable.uniqueKeys.push({ name: 'uq_order_memo_reorder', columns: ['reorder_id'] })
      memoTable.foreignKeys.push(acting(fk('fk_order_memo_reorder', ['reorder_id'], 'order', ['id']), 'set-null'))
      objects.push(
        table('reorder_copy', [col('id', 1, INT32), col('reorder_id', 2, INT64, { nullable: true })], {
          primaryKey: { name: 'pk_reorder_copy', columns: ['id'] },
          foreignKeys: [acting(fk('fk_reorder_copy_memo', ['reorder_id'], 'order_memo', ['reorder_id']), 'no-action', follows)],
        }),
      )
    }
    const REORDER_KEY: CascadeRule = { table: sales('order_memo'), foreignKey: 'fk_order_memo_reorder', onDelete: 'set-null' }
    expect(deleteReach(lines('no-action', true, twice('no-action')), sales('order'), accepting(MEMO_KEY, REORDER_KEY)).reach.cleared).toEqual([{ table: sales('order_memo'), columns: ['order_id', 'reorder_id'] }])
    expect(problems(lines('no-action', true, twice('cascade')), accepting(MEMO_KEY, REORDER_KEY))).toEqual([
      'operations.delete grants roles, and deleting a record of sales.order also sets reorder_id of sales.order_memo to NULL in the rows that refer to it (fk_order_memo_reorder, ON DELETE SET NULL), and fk_reorder_copy_memo of sales.reorder_copy follows reorder_id ON UPDATE CASCADE, which a delete does not follow',
    ])
  })

  // A key that only refuses, onto a table a cascade reaches, may refuse the
  // delete as one onto the root may.
  test('says a key onto a table past the root may refuse the delete', () => {
    expect(deleteReach(lines('cascade', true, noted('no-action')), sales('order'), accepting(LINE_KEY)).restricted).toBe(true)
  })
})

describe('deleteEffects', () => {
  // What a page words its confirmation by (0051): whether the policy
  // accepts a key that deletes other rows, or one that changes them, and
  // whether a key may refuse the delete -- never which tables.
  test('says whether an accepted key cascades or clears, and whether one restricts', () => {
    expect(deleteEffects(lines('cascade'), sales('order'), accepting(LINE_KEY))).toEqual({ cascades: true, clears: false, restricted: false })
    expect(deleteEffects(lines('no-action', true, memo('no-action')), sales('order'), accepting(MEMO_KEY))).toEqual({ cascades: false, clears: true, restricted: true })
    expect(deleteEffects(lines('no-action'), sales('order'), DELETING)).toEqual({ cascades: false, clears: false, restricted: true })
  })
})
