import { describe, expect, test } from 'vitest'
import { generateForm } from '../generate/generate.js'
import type { ColumnMeta, ObjectMeta } from '../metadata.js'
import type { FormPolicy } from '../policy/types.js'
import { unscopedLookups } from '../policy/through.js'
import { validatePolicy } from '../policy/validate.js'
import type { RecordListQuery } from '../runtime.js'
import { listable, listColumns, planList, recordPage } from './list.js'
import { planRead } from './plan.js'
import {
  actor,
  AMOUNT,
  AUDITOR,
  BOOLEAN,
  CLERK,
  CLERK_COLUMNS,
  CLERK_FIELDS,
  CLERK_RW,
  col,
  column,
  CUSTOMER_POLICY,
  customerForm,
  customerSource,
  DATE,
  edited,
  INT32,
  INT64,
  INTAKE,
  LINE_POLICY,
  lineForm,
  ORDER_ID,
  ORDER_POLICY,
  ORDER_TARGET,
  ORDER_TOKEN,
  orderForm,
  PG,
  PG_ORDER,
  sales,
  snapshot,
  STAMPED,
  table,
  TENANT_ONE,
  text,
  value,
} from './test-support.js'

/** A first page, in key order, with nothing narrowed: what a grid asks for when it opens. */
const FIRST: RecordListQuery = { search: '', sort: [], parent: null, filter: [], offset: 0, limit: 50 }
const query = (change: Partial<RecordListQuery>): RecordListQuery => ({ ...FIRST, ...change })

const customers = customerForm(customerSource()).bindings

describe('the forms and policies these tests use', () => {
  // Every refusal below has to be the planner's: a policy that did not fit
  // its form would be refused by the policy functions first.
  test('fit each other', () => {
    expect(validatePolicy(ORDER_POLICY, PG_ORDER)).toEqual({ ok: true })
    expect(validatePolicy(CUSTOMER_POLICY, customers)).toEqual({ ok: true })
    expect(validatePolicy(LINE_POLICY, lineForm(PG).bindings)).toEqual({ ok: true })
  })
})

describe('planList', () => {
  // A list reads what a read reads and nothing more: the key, for each row's
  // token, and the columns of the fields this actor may see, under their
  // tenant. A column the policy keeps from the auditor is never fetched, so
  // it cannot leak through a serializer that forgot to drop it. Watched
  // failing with every bound column read.
  test('reads exactly the key and the readable fields’ columns, under the read filter, in key order', () => {
    expect(planList(PG, PG_ORDER, ORDER_POLICY, AUDITOR, FIRST)).toEqual({
      ok: true,
      request: {
        target: ORDER_TARGET.postgres,
        columns: [column('id', INT64), column('order_date', DATE), column('status', text(20))],
        filters: TENANT_ONE,
        through: [],
        equal: [],
        filter: [],
        search: null,
        sort: [{ column: 'id', direction: 'asc', nulls: null }],
        offset: 0,
        limit: 50,
      },
      fields: ['id', 'order_date', 'status'],
    })
    const clerk = planList(PG, PG_ORDER, ORDER_POLICY, CLERK, query({ offset: 100, limit: 7 }))
    expect(clerk).toMatchObject({ ok: true, fields: CLERK_FIELDS, request: { columns: CLERK_COLUMNS, offset: 100, limit: 7 } })
    // Each row of a list is what a read of its token shows: the same columns, the same fields.
    const read = planRead(PG, PG_ORDER, ORDER_POLICY, CLERK, ORDER_TOKEN)
    if (!read.ok || !clerk.ok) throw new Error('expected both to plan')
    expect(clerk.request.columns).toEqual(read.request.columns)
    expect(clerk.fields).toEqual(read.fields)
  })

  // A line has no tenant of its own (0043): its list carries the order
  // lookup's through from the first statement, as its read does, so another
  // tenant's lines are never listed. An actor without the tenant is refused
  // rather than listed unscoped.
  test("carries a line's through, and refuses a context without the tenant", () => {
    const bindings = lineForm(PG).bindings
    expect(planList(PG, bindings, LINE_POLICY, CLERK, FIRST)).toMatchObject({
      ok: true,
      request: {
        filters: { kind: 'unrestricted' },
        through: [{ columns: [column('order_id', INT64)], target: sales('order'), targetColumns: [{ name: 'id', type: INT64 }], filters: TENANT_ONE }],
        sort: [
          { column: 'order_id', direction: 'asc', nulls: null },
          { column: 'line_no', direction: 'asc', nulls: null },
        ],
      },
    })
    expect(planList(PG, PG_ORDER, ORDER_POLICY, actor(['clerk'], {}), FIRST)).toMatchObject({ ok: false, code: 'missing-attribute' })
    expect(planList(PG, bindings, LINE_POLICY, actor(['clerk'], {}), FIRST)).toMatchObject({
      ok: false,
      code: 'missing-attribute',
      message: expect.stringMatching(/^lookups\.order: /) as unknown as string,
    })
  })

  // A list is a read: there is no list grant, so an actor granted fields and
  // not the read operation is refused, never handed a page.
  test('refuses an actor who may not read, whatever fields they are granted', () => {
    expect(planList(PG, PG_ORDER, ORDER_POLICY, INTAKE, FIRST)).toMatchObject({ ok: false, code: 'operation-denied' })
    expect(listable(PG, PG_ORDER, ORDER_POLICY, INTAKE)).toMatchObject({ ok: false, code: 'operation-denied' })
  })

  // Every listed row's token spells its key, and a list hands out a token for
  // every row it admits, where a read hands back only the token it was sent.
  // So a policy that hides customer_no lists nothing -- and one that hides the
  // pinned tenant still lists, because that value is the actor's own. Watched
  // failing with the coverage check removed (tokens emitted for a hidden
  // customer_no), and with the pinned column not counted (the tenant's form
  // refused).
  test('refuses a key held in a field the actor may not read, and counts a pinned key column as read', () => {
    const hiddenNumber: FormPolicy = { ...CUSTOMER_POLICY, fields: { ...CUSTOMER_POLICY.fields, customer_no: { read: [], write: ['clerk'] } } }
    expect(validatePolicy(hiddenNumber, customers)).toEqual({ ok: true })
    for (const refused of [listable(customerSource(), customers, hiddenNumber, CLERK), planList(customerSource(), customers, hiddenNumber, CLERK, FIRST)]) {
      expect(refused).toEqual({
        ok: false,
        code: 'field-denied',
        message: "This form's records are named by fields you may not read, so they are not listed for you.",
      })
    }
    const hiddenTenant: FormPolicy = { ...CUSTOMER_POLICY, fields: { ...CUSTOMER_POLICY.fields, tenant_id: { read: [], write: [] } } }
    const listed = planList(customerSource(), customers, hiddenTenant, CLERK, FIRST)
    expect(listed).toMatchObject({
      ok: true,
      request: { columns: expect.arrayContaining([column('tenant_id', INT32), column('customer_no', INT32)]) as unknown as [] },
    })
    if (listed.ok) expect(listed.fields).not.toContain('tenant_id')
    // A key column bound by a lookup is read through that lookup's field: a line's order.
    const lines = lineForm(PG).bindings
    const hiddenOrder: FormPolicy = { ...LINE_POLICY, fields: { ...LINE_POLICY.fields, order: { read: [], write: ['clerk'] } } }
    expect(planList(PG, lines, hiddenOrder, CLERK, FIRST)).toMatchObject({ ok: false, code: 'field-denied' })
  })

  // A nullable unique key admits many NULLs on PostgreSQL. Rows tied on the
  // sort with NULL keys have no defined order, and offset paging repeats or
  // skips them, so such a form offers no list, on both engines -- though it
  // can still be read by a token. Watched failing with addressability alone
  // checked: the list was planned.
  test('refuses a key that can be NULL, which a read still accepts', () => {
    for (const kind of ['postgres', 'sqlserver'] as const) {
      const source = snapshot(kind, (objects) => {
        const country = objects.find((object) => object.ref.name === 'country') as ObjectMeta
        country.primaryKey = null
        ;(country.columns.find((entry) => entry.name === 'iso_code') as ColumnMeta).nullable = true
      })
      const { bindings } = generateForm(source, { connection: 'erp', root: sales('country'), formId: 'country', title: 'Country', lookups: [] })
      expect(bindings.identity, kind).toEqual(['iso_code'])
      const policy: FormPolicy = {
        version: 1,
        operations: { read: ['clerk'], create: [], update: [] },
        fields: { id: { read: ['clerk'], write: [] }, iso_code: CLERK_RW, name: CLERK_RW },
        rowFilters: [],
        lookups: {},
      }
      expect(planRead(source, bindings, policy, CLERK, 'k1:CH'), kind).toMatchObject({ ok: true })
      expect(planList(source, bindings, policy, CLERK, FIRST), kind).toEqual({
        ok: false,
        code: 'operation-unavailable',
        message: "This form's key can be NULL, so its records have no order a page can rely on.",
      })
      // Who may list is asked first: a person the policy does not let read
      // learns nothing about the table, its key included, as `GET
      // /v1/forms/:id` tells them nothing. Watched failing with the key
      // checked before the policy: the intake clerk was told the key can be NULL.
      for (const stranger of [INTAKE, actor(['nobody'])]) {
        expect(listable(source, bindings, policy, stranger), kind).toMatchObject({ ok: false, code: 'operation-denied' })
        expect(planList(source, bindings, policy, stranger, FIRST), kind).toMatchObject({ ok: false, code: 'operation-denied' })
      }
    }
  })

  // A line form published before `through` existed had to say `rowFilters:
  // []` (0043), and after an upgrade its policy still does: nothing scopes
  // its rows, though its order lookup offers only the tenant's orders. A
  // read reaches another tenant's line only by a token somebody guesses; a
  // list would hand every tenant's lines to anybody it lets read, in one
  // request. So a form whose rows nothing scopes -- no row filter, no
  // through -- while a lookup's options are filtered offers no list: the
  // shape the studio notes. A form whose rows and options are all shared
  // still lists. Watched failing with the check removed: the unscoped line
  // form was planned with an unrestricted filter and no through.
  test("refuses a list of rows nothing scopes while a lookup's options are filtered", () => {
    const lines = lineForm(PG).bindings
    const { through: _through, ...unscoped } = LINE_POLICY
    expect(validatePolicy(unscoped, lines)).toEqual({ ok: true })
    expect(unscopedLookups(lines, unscoped)).toEqual(['order'])
    expect(unscopedLookups(lines, LINE_POLICY)).toEqual([])
    const refusal = {
      ok: false,
      code: 'operation-unavailable',
      message: "Nothing scopes this form's records, though the options of order are filtered, so they are not listed.",
    }
    expect(listable(PG, lines, unscoped, CLERK)).toEqual(refusal)
    expect(planList(PG, lines, unscoped, CLERK, FIRST)).toEqual(refusal)
    // The policy is asked first here too: the intake clerk may not read.
    expect(planList(PG, lines, unscoped, INTAKE, FIRST)).toMatchObject({ ok: false, code: 'operation-denied' })
    const shared: FormPolicy = { ...unscoped, lookups: { order: [] } }
    expect(validatePolicy(shared, lines)).toEqual({ ok: true })
    expect(unscopedLookups(lines, shared)).toEqual([])
    expect(planList(PG, lines, shared, CLERK, FIRST)).toMatchObject({ ok: true, request: { filters: { kind: 'unrestricted' }, through: [] } })
    // A lookup called constructor is a key like any other: a policy that
    // filters nothing for it filters nothing, whatever every object inherits.
    const constructed = edited(lines, (draft) => {
      ;(draft.fields.find((binding) => binding.field === 'order') as { field: string }).field = 'constructor'
    })
    expect(unscopedLookups(constructed, { ...shared, lookups: {} })).toEqual([])
  })

  // The order must be total for offset paging to hold: the identity ends it.
  // A key column the request already sorts by is not named twice, and NULL
  // placement is spelled only for a column the snapshot says is nullable --
  // a NOT NULL one is left for an index to serve. Watched failing with every
  // key column appended, and with `last` on every column.
  test('ends the order with the key columns it does not name, and spells NULLs last only on a nullable column', () => {
    const planned = (sort: RecordListQuery['sort']) => planList(customerSource(), customers, CUSTOMER_POLICY, CLERK, query({ sort }))
    expect(planned([{ field: 'customer_no', direction: 'desc' }])).toMatchObject({
      ok: true,
      request: {
        sort: [
          { column: 'customer_no', direction: 'desc', nulls: null },
          { column: 'tenant_id', direction: 'asc', nulls: null },
        ],
      },
    })
    expect(
      planned([
        { field: 'credit_limit', direction: 'desc' },
        { field: 'name', direction: 'asc' },
      ]),
    ).toMatchObject({
      ok: true,
      request: {
        sort: [
          { column: 'credit_limit', direction: 'desc', nulls: 'last' },
          { column: 'name', direction: 'asc', nulls: null },
          { column: 'tenant_id', direction: 'asc', nulls: null },
          { column: 'customer_no', direction: 'asc', nulls: null },
        ],
      },
    })
  })

  // What a list may be sorted and searched by is one function's answer, the
  // one `GET /v1/forms/:id` sends: readable column fields; sortable when the
  // kind has canonical text, searchable when it is text or integer. A lookup
  // field holds a token, not the label a person reads, so it is neither.
  test('sorts and searches only by readable column fields, and searches only text and integers', () => {
    const clerk = planList(PG, PG_ORDER, ORDER_POLICY, CLERK, query({ search: 'Muster' }))
    expect(clerk).toMatchObject({
      ok: true,
      request: {
        search: {
          text: 'Muster',
          columns: [
            { name: 'id', type: INT64 },
            { name: 'status', type: text(20) },
            { name: 'notes', type: text(null) },
            { name: 'group', type: text(50) },
            { name: 'approved_by', type: INT32 },
          ],
        },
      },
    })
    const NULLS = ['null', 'not-null']
    expect(listColumns(PG_ORDER, CLERK_FIELDS, [])).toEqual({
      searchable: ['id', 'status', 'notes', 'group', 'approved_by'],
      sortable: ['id', 'order_date', 'status', 'amount', 'notes', 'group', 'approved_by', 'paid'],
      filterable: [
        { field: 'id', operators: ['equals', 'range'], input: 'integer', days: null },
        { field: 'order_date', operators: ['equals', 'range'], input: 'date', days: null },
        { field: 'status', operators: ['equals', 'contains'], input: 'text', days: null },
        { field: 'amount', operators: ['equals', 'range'], input: 'decimal', days: null },
        { field: 'notes', operators: ['equals', 'contains', ...NULLS], input: 'text', days: null },
        { field: 'group', operators: ['equals', 'contains', ...NULLS], input: 'text', days: null },
        { field: 'approved_by', operators: ['equals', 'range', ...NULLS], input: 'integer', days: null },
        { field: 'paid', operators: ['equals', ...NULLS], input: 'boolean', days: null },
      ],
      views: [],
    })
    expect(listColumns(PG_ORDER, ['id', 'order_date', 'status'], [])).toMatchObject({ searchable: ['id', 'status'], sortable: ['id', 'order_date', 'status'] })
    for (const field of ['amount', 'customer', 'employee', 'nothing']) {
      expect(planList(PG, PG_ORDER, ORDER_POLICY, AUDITOR, query({ sort: [{ field, direction: 'asc' }] })), field).toEqual({
        ok: false,
        code: 'not-sortable',
        message: `${field} is not a field you may sort this list by.`,
      })
    }
    expect(planList(PG, PG_ORDER, ORDER_POLICY, AUDITOR, query({ sort: [{ field: 'order_date', direction: 'desc' }] }))).toMatchObject({
      ok: true,
      request: {
        sort: [
          { column: 'order_date', direction: 'desc', nulls: null },
          { column: 'id', direction: 'asc', nulls: null },
        ],
      },
    })
  })

  // A column with no canonical text has no order both engines agree on. The
  // generator never makes a field of a binary or a rowversion column; a hand
  // edit can, and the planner still offers no sort by it.
  test('offers no sort by a binary or a rowversion field a hand edit adds', () => {
    const source = snapshot('sqlserver', (objects) => {
      const order = objects.find((object) => object.ref.name === 'order') as ObjectMeta
      order.columns.push(col('scan', 13, { kind: 'binary', maxLength: 16, fixedLength: false }, { nullable: true }))
    })
    const bindings = edited(orderForm(source).bindings, (draft) => {
      draft.fields.push(
        {
          kind: 'column',
          field: 'scan',
          column: 'scan',
          type: { kind: 'binary', maxLength: 16, fixedLength: false },
          nullable: true,
          writes: { create: false, update: false },
        },
        { kind: 'column', field: 'stamp', column: 'row_version', type: { kind: 'rowversion' }, nullable: false, writes: { create: false, update: false } },
      )
    })
    const READ_ONLY = { read: ['clerk'], write: [] }
    const policy: FormPolicy = { ...ORDER_POLICY, fields: { ...ORDER_POLICY.fields, scan: READ_ONLY, stamp: READ_ONLY } }
    expect(listColumns(bindings, ['id', 'scan', 'stamp'], []).sortable).toEqual(['id'])
    for (const field of ['scan', 'stamp']) {
      expect(planList(source, bindings, policy, CLERK, query({ sort: [{ field, direction: 'asc' }] })), field).toMatchObject({
        ok: false,
        code: 'not-sortable',
      })
    }
  })

  // A condition is on the column a readable column field binds (0104),
  // planned by columnFilter. A field the actor may not read, a lookup, an
  // operator its column does not offer and a value it cannot hold are each
  // refused before an adapter sees them, naming the field and never the
  // value. Watched failing with the field read from the request rather
  // than from the readable bindings.
  test('filters only by readable column fields, by what their columns offer', () => {
    const renamed = edited(PG_ORDER, (draft) => {
      const amount = draft.fields.find((binding) => binding.field === 'amount')
      if (amount !== undefined) amount.field = 'total'
    })
    const { amount: _, ...others } = ORDER_POLICY.fields
    const policy: FormPolicy = { ...ORDER_POLICY, fields: { ...others, total: CLERK_RW } }
    const filter: RecordListQuery['filter'] = [
      { field: 'total', op: 'range', from: '10', to: null },
      { field: 'paid', op: 'null' },
    ]
    expect(planList(PG, renamed, policy, CLERK, query({ filter }))).toMatchObject({
      ok: true,
      request: {
        filter: [
          { op: 'range', column: 'amount', type: AMOUNT, from: '10.0000', to: null, before: null },
          { op: 'null', column: 'paid' },
        ],
      },
    })
    const refusals: Array<[typeof CLERK, RecordListQuery['filter'][number], string]> = [
      [AUDITOR, { field: 'amount', op: 'range', from: '10', to: null }, 'amount is not a field you may filter this list by.'],
      [CLERK, { field: 'customer', op: 'null' }, 'customer is not a field you may filter this list by.'],
      [CLERK, { field: 'nothing', op: 'null' }, 'nothing is not a field you may filter this list by.'],
      [CLERK, { field: 'amount', op: 'contains', text: '1' }, 'amount offers no contains condition.'],
      [CLERK, { field: 'order_date', op: 'equals', value: '2026-02-30' }, 'A value given for order_date is not one it can hold.'],
    ]
    for (const [who, term, message] of refusals) {
      expect(planList(PG, PG_ORDER, ORDER_POLICY, who, query({ filter: [term] })), term.field).toEqual({ ok: false, code: 'not-filterable', message })
    }
  })

  // A search the form cannot match would answer with the unfiltered first
  // page, which looks like a search that matched everything. An empty search
  // is no search, and lists.
  test('refuses a search where no readable field can match one', () => {
    const source = snapshot('postgres', (objects) => {
      objects.push(
        table('tag', [col('id', 1, { kind: 'uuid' }), col('day', 2, DATE), col('weight', 3, AMOUNT), col('done', 4, BOOLEAN)], {
          primaryKey: { name: 'pk_tag', columns: ['id'] },
        }),
      )
    })
    const { bindings } = generateForm(source, { connection: 'erp', root: sales('tag'), formId: 'tag', title: 'Tag', lookups: [] })
    const policy: FormPolicy = {
      version: 1,
      operations: { read: ['clerk'], create: [], update: [] },
      fields: { id: CLERK_RW, day: CLERK_RW, weight: CLERK_RW, done: CLERK_RW },
      rowFilters: [],
      lookups: {},
    }
    expect(listColumns(bindings, ['id', 'day', 'weight', 'done'], []).searchable).toEqual([])
    expect(planList(source, bindings, policy, CLERK, query({ search: 'x' }))).toEqual({
      ok: false,
      code: 'not-searchable',
      message: 'This form has no field you may read that a search can match.',
    })
    expect(planList(source, bindings, policy, CLERK, FIRST)).toMatchObject({ ok: true, request: { search: null } })
  })

  // The parent narrows a child grid to one parent's rows: the root's
  // foreign-key columns equal to the values its token names, typed as those
  // columns. The token is decoded by the lookup's own decision -- the root
  // columns' codecs -- so a value the foreign key cannot hold names nothing:
  // `007` is no bigint as a key holds it, and 2^53 + 1 fits the order's int8
  // key and not an int4 foreign key onto it. Watched failing with the token
  // decoded against the target key's types: the int8 value was accepted.
  test('narrows to a parent named by a readable lookup, its token decoded through the root’s foreign-key columns', () => {
    const lines = lineForm(PG).bindings
    expect(planList(PG, lines, LINE_POLICY, CLERK, query({ parent: { field: 'order', record: ORDER_TOKEN } }))).toMatchObject({
      ok: true,
      request: { equal: [value('order_id', INT64, ORDER_ID)], through: [{ filters: TENANT_ONE }] },
    })
    expect(planList(PG, lines, LINE_POLICY, CLERK, query({ parent: { field: 'order', record: 'k1:007' } }))).toEqual({
      ok: false,
      code: 'invalid-record-token',
      message: "The parent's record is not a token of a row order can reference.",
    })
    const narrow = snapshot('postgres', (objects) => {
      ;(objects.find((object) => object.ref.name === 'order_line')?.columns.find((entry) => entry.name === 'order_id') as ColumnMeta).type = INT32
    })
    const narrowLines = lineForm(narrow).bindings
    expect(planList(narrow, narrowLines, LINE_POLICY, CLERK, query({ parent: { field: 'order', record: ORDER_TOKEN } }))).toMatchObject({
      ok: false,
      code: 'invalid-record-token',
    })
    expect(planList(narrow, narrowLines, LINE_POLICY, CLERK, query({ parent: { field: 'order', record: 'k1:7' } }))).toMatchObject({
      ok: true,
      request: { equal: [value('order_id', INT32, '7')] },
    })
  })

  // A parent must be a lookup the actor may read: a column field names no
  // parent, an unknown field none either, and narrowing by a lookup the
  // actor may not see would let them test which rows reference what.
  test('refuses a parent that is not a lookup field the actor may read', () => {
    const hidden: FormPolicy = { ...ORDER_POLICY, fields: { ...ORDER_POLICY.fields, customer: { read: [], write: ['clerk'] } } }
    for (const [policy, field] of [
      [ORDER_POLICY, 'status'],
      [ORDER_POLICY, 'nothing'],
      [hidden, 'customer'],
    ] as const) {
      expect(planList(PG, PG_ORDER, policy, CLERK, query({ parent: { field, record: 'k1:1,1001' } })), field).toEqual({
        ok: false,
        code: 'invalid-request',
        message: `${field} is not a lookup field you may read, so it cannot name a parent.`,
      })
    }
    expect(planList(PG, PG_ORDER, ORDER_POLICY, CLERK, query({ parent: { field: 'customer', record: 'k1:1,1001' } }))).toMatchObject({
      ok: true,
      request: { equal: [value('tenant_id', INT32, '1'), value('customer_no', INT32, '1001')] },
    })
  })

  // Bindings from another snapshot name columns that may mean something else,
  // and are refused before the policy is asked, which reads them. A key no
  // token can carry addresses nothing, and is refused with its own code
  // after the policy: a person it does not let read is told only that.
  test('refuses drifted bindings and an unaddressable form, each with its own code', () => {
    const changed = snapshot('postgres', (objects) => {
      objects.find((object) => object.ref.name === 'order')?.columns.push(col('rush', 13, BOOLEAN, { nullable: true }))
    })
    expect(planList(changed, PG_ORDER, ORDER_POLICY, CLERK, FIRST)).toMatchObject({ ok: false, code: 'drift' })
    const stamped = orderForm(STAMPED).bindings
    expect(planList(STAMPED, stamped, ORDER_POLICY, CLERK, FIRST)).toMatchObject({ ok: false, code: 'operation-unavailable' })
    expect(listable(STAMPED, stamped, ORDER_POLICY, CLERK)).toMatchObject({ ok: false, code: 'operation-unavailable' })
    expect(listable(STAMPED, stamped, ORDER_POLICY, INTAKE)).toMatchObject({ ok: false, code: 'operation-denied' })
  })
})

describe('recordPage', () => {
  const order = (id: string, notes: string | null) => ({ values: { id, order_date: '2026-10-08', status: 'placed', notes }, version: '1' })

  // The extra row says whether more follow, and is never shown. A row whose
  // key does not fit a token stays in its place, so row n of the page is
  // still record offset + n; dropping it would shift every row after it.
  test('keeps a row with no token in its place, and tells more from the extra row', () => {
    const long = '9'.repeat(5000)
    const page = recordPage(PG_ORDER, ['id', 'notes'], [order('1', 'a'), order(long, 'b'), order('3', null), order('4', 'd')], 3)
    expect(page).toEqual({
      rows: [
        { record: 'k1:1', version: '1', answers: { id: '1', notes: 'a' } },
        { record: null, version: '1', answers: { id: long, notes: 'b' } },
        { record: 'k1:3', version: '1', answers: { id: '3', notes: null } },
      ],
      hasMore: true,
    })
    expect(recordPage(PG_ORDER, ['id'], [order('1', null)], 3)).toEqual({ rows: [{ record: 'k1:1', version: '1', answers: { id: '1' } }], hasMore: false })
  })

  // A token twice on one page is an adapter that joined wrongly; a grid would
  // select one row and highlight two.
  test('throws on a record twice in one page', () => {
    expect(() => recordPage(PG_ORDER, ['id'], [order('1', null), order('1', null)], 3)).toThrow('A record appears twice in one page')
  })
})
