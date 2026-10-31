import { describe, expect, test } from 'vitest'
import type { ColumnMeta, ForeignKeyMeta, InboundKey, NormalizedType, ObjectMeta, ObjectRef } from '../metadata.js'
import { createSnapshot } from '../snapshot.js'
import { browseRelations, followTerms } from './follow.js'
import type { BrowseRelation } from './follow.js'

const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const CODE: NormalizedType = { kind: 'text', maxLength: 2, lengthUnit: 'utf16-code-units', fixedLength: true }
const STAMP: NormalizedType = { kind: 'timestamp', withTimeZone: true, precision: 6 }
const col = (name: string, ordinal: number, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta => ({
  name,
  ordinal,
  databaseType: type.kind,
  type,
  nullable: false,
  hasDefault: false,
  defaultExpression: null,
  generated: 'none',
  comment: null,
  access: { select: true, insert: true, update: true },
  ...extra,
})
const sales = (name: string): ObjectRef => ({ schema: 'sales', name })
const table = (name: string, columns: ColumnMeta[], rest: Partial<ObjectMeta> = {}): ObjectMeta => ({
  ref: sales(name),
  kind: 'table',
  comment: null,
  columns,
  primaryKey: null,
  uniqueKeys: [],
  foreignKeys: [],
  checks: [],
  rowSecurity: 'none',
  access: { delete: true },
  referencedBy: [],
  ...rest,
})
const key = (name: string, columns: string[], references: ForeignKeyMeta['references']): ForeignKeyMeta => ({
  name,
  columns,
  references,
  onUpdate: 'no-action',
  onDelete: 'no-action',
  enforced: true,
  validated: true,
})
const inbound = (on: ObjectRef, name: string, columns: string[], referencedColumns: string[]): InboundKey => ({
  table: on,
  name,
  columns,
  referencedColumns,
  onDelete: 'no-action',
  onUpdate: 'no-action',
  enforced: true,
})
const HIDDEN = { select: false, insert: false, update: false }

/*
 * A customer refers to its country by code, and to a region this account
 * cannot see; an invoice refers to the customer by an id the account may
 * not read, and to a period by an instant; an audit table outside the
 * approved schemas refers to the country; an employee refers to its
 * manager, another employee.
 */
const SNAPSHOT = createSnapshot({
  kind: 'postgres',
  serverVersion: '17.6',
  account: { user: 'owner', login: 'owner' },
  scope: { schemas: ['sales'] },
  gaps: [
    { subject: { kind: 'object', object: sales('customer') }, aspect: 'foreign-keys', detail: 'fk_customer_region refers to a table this account cannot see.' },
    { subject: { kind: 'object', object: sales('period') }, aspect: 'referenced-by', detail: 'A table this account cannot see may refer to it.' },
  ],
  objects: [
    table('country', [col('id', 1, INT32), col('iso_code', 2, CODE)], {
      primaryKey: { name: 'pk_country', columns: ['id'] },
      uniqueKeys: [{ name: 'uq_country_iso_code', columns: ['iso_code'] }],
      referencedBy: [
        inbound({ schema: 'audit', name: 'trail' }, 'fk_trail_country', ['country_id'], ['id']),
        inbound(sales('customer'), 'fk_customer_country', ['country_code'], ['iso_code']),
      ],
    }),
    table(
      'customer',
      [
        col('id', 1, INT32, { access: HIDDEN }),
        col('code', 2, CODE),
        col('country_code', 3, CODE, { nullable: true }),
        col('region_id', 4, INT32, { nullable: true }),
      ],
      {
        primaryKey: { name: 'pk_customer', columns: ['id'] },
        uniqueKeys: [{ name: 'uq_customer_code', columns: ['code'] }],
        foreignKeys: [
          key('fk_customer_country', ['country_code'], { table: sales('country'), columns: ['iso_code'] }),
          key('fk_customer_region', ['region_id'], null),
        ],
        referencedBy: [inbound(sales('invoice'), 'fk_invoice_customer', ['customer_id'], ['id'])],
      },
    ),
    table('employee', [col('id', 1, INT32), col('manager_id', 2, INT32, { nullable: true })], {
      primaryKey: { name: 'pk_employee', columns: ['id'] },
      foreignKeys: [key('fk_employee_manager', ['manager_id'], { table: sales('employee'), columns: ['id'] })],
      referencedBy: [inbound(sales('employee'), 'fk_employee_manager', ['manager_id'], ['id'])],
    }),
    table('invoice', [col('id', 1, INT32), col('customer_id', 2, INT32), col('period', 3, STAMP)], {
      primaryKey: { name: 'pk_invoice', columns: ['id'] },
      foreignKeys: [
        key('fk_invoice_customer', ['customer_id'], { table: sales('customer'), columns: ['id'] }),
        key('fk_invoice_period', ['period'], { table: sales('period'), columns: ['starts'] }),
      ],
    }),
    table('period', [col('starts', 1, STAMP)], {
      uniqueKeys: [{ name: 'uq_period_starts', columns: ['starts'] }],
      referencedBy: [inbound(sales('invoice'), 'fk_invoice_period', ['period'], ['starts'])],
    }),
  ],
})

describe('browseRelations', () => {
  // The two ways a row is related: what it refers to, and what refers to it. Offered one way only, a person could reach an order's customer and never the customer's orders.
  test('follows a foreign key either way, each from the columns that hold the values', () => {
    expect(browseRelations(SNAPSHOT, sales('customer')).relations).toEqual<BrowseRelation[]>([
      { direction: 'refers-to', key: 'fk_customer_country', from: ['country_code'], to: { object: sales('country'), columns: ['iso_code'] } },
    ])
    expect(browseRelations(SNAPSHOT, sales('country')).relations).toEqual<BrowseRelation[]>([
      { direction: 'referred-by', key: 'fk_customer_country', from: ['iso_code'], to: { object: sales('customer'), columns: ['country_code'] } },
    ])
  })

  // A key from a table to itself is both: the manager an employee has, and the employees a manager has.
  test('follows a key from a table to itself both ways', () => {
    expect(browseRelations(SNAPSHOT, sales('employee')).relations).toEqual<BrowseRelation[]>([
      { direction: 'refers-to', key: 'fk_employee_manager', from: ['manager_id'], to: { object: sales('employee'), columns: ['id'] } },
      { direction: 'referred-by', key: 'fk_employee_manager', from: ['id'], to: { object: sales('employee'), columns: ['manager_id'] } },
    ])
  })

  // A key left out without a word reads as "no relationship", the one wrong answer (0004): each one that cannot be followed is named with why.
  test('names each key it cannot follow, and why', () => {
    expect(browseRelations(SNAPSHOT, sales('customer')).unfollowed).toEqual([
      { direction: 'refers-to', key: 'fk_customer_region', object: null, reason: 'unseen' },
      { direction: 'referred-by', key: 'fk_invoice_customer', object: sales('invoice'), reason: 'not-comparable' },
    ])
    expect(browseRelations(SNAPSHOT, sales('country')).unfollowed).toEqual([
      { direction: 'referred-by', key: 'fk_trail_country', object: { schema: 'audit', name: 'trail' }, reason: 'not-browsed' },
    ])
  })

  // A follow narrows by equality, which a browse allows on a shown column of a key kind at both ends: a column the account may not read, or an instant, would be refused when pressed.
  test('cannot follow through a column the account may not read, or of a kind no key has', () => {
    expect(browseRelations(SNAPSHOT, sales('invoice'))).toMatchObject({
      relations: [],
      unfollowed: [
        { direction: 'refers-to', key: 'fk_invoice_customer', object: sales('customer'), reason: 'not-comparable' },
        { direction: 'refers-to', key: 'fk_invoice_period', object: sales('period'), reason: 'not-comparable' },
      ],
    })
  })

  // A referenced-by gap says a table this account cannot see may refer to the object: the list of what refers to it is then not all there is.
  test('says whether what refers to the object is all there is', () => {
    expect(browseRelations(SNAPSHOT, sales('country')).inboundComplete).toBe(true)
    expect(browseRelations(SNAPSHOT, sales('period')).inboundComplete).toBe(false)
  })

  // A snapshot taken before 0049 does not say what refers to anything; an empty list from it would claim nothing does.
  test('a snapshot that does not record what refers to an object is not complete', () => {
    const older = createSnapshot({
      kind: 'postgres',
      serverVersion: '17.6',
      account: { user: 'owner', login: 'owner' },
      scope: { schemas: ['sales'] },
      gaps: [],
      objects: [
        {
          ref: sales('lone'),
          kind: 'table',
          comment: null,
          columns: [col('id', 1, INT32)],
          primaryKey: { name: 'pk_lone', columns: ['id'] },
          uniqueKeys: [],
          foreignKeys: [],
          checks: [],
          rowSecurity: 'none',
        },
      ],
    })
    expect(browseRelations(older, sales('lone'))).toEqual({ relations: [], unfollowed: [], inboundComplete: false })
  })

  // The studio's snapshot can be older than the server's: an object it no longer holds follows nothing, rather than throwing in a render.
  test('an object the snapshot does not hold follows nothing', () => {
    expect(browseRelations(SNAPSHOT, sales('nope'))).toEqual({ relations: [], unfollowed: [], inboundComplete: false })
  })
})

describe('followTerms', () => {
  const composite: BrowseRelation = {
    direction: 'referred-by',
    key: 'fk_order_customer',
    from: ['tenant_id', 'customer_no'],
    to: { object: sales('order'), columns: ['tenant_id', 'customer_no'] },
  }

  // The values pair with the other end's columns by position, which is how a composite key pairs them.
  test("narrows the other end's columns to the row's values, pair by pair", () => {
    expect(followTerms(composite, { customer_no: '1001', tenant_id: '1', name: 'Muster AG' })).toEqual([
      { column: 'tenant_id', value: '1' },
      { column: 'customer_no', value: '1001' },
    ])
  })

  // A foreign key with a NULL in it refers to no row (MATCH SIMPLE on both engines); followed, it would find rows that merely share the other columns.
  test('follows nothing from a NULL or a value the page does not hold', () => {
    expect(followTerms(composite, { tenant_id: '1', customer_no: null })).toBeNull()
    expect(followTerms(composite, { tenant_id: '1' })).toBeNull()
  })
})
