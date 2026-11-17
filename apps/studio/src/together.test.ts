// @vitest-environment node
//
// Node rather than jsdom: what the Choose step says of rows saved with
// their record is plain data, asked of data-core's own functions.
import { describe, expect, test } from 'vitest'
import { boundsProblem, findObject } from '@formancy/data-core'
import type { FormPolicy, LookupChoice, MetadataSnapshot, ObjectMeta } from '@formancy/data-core'
import type { ProposalRequest } from './api.js'
import { EMPTY_POLICY } from './policy-model.js'
import { OWNER_SNAPSHOT, SECTIONS_SNAPSHOT, SQLSERVER_SNAPSHOT } from './test-server.js'
import { TOGETHER_SNAPSHOT } from './test-together.js'
import { STARTING_BOUNDS, togetherCandidate, togetherReasons, touchCandidates } from './together.js'

/**
 * Which lookups are offered to be saved with their record, which columns a
 * touch is offered through, and what the generator, the policy check and
 * the publish gate refuse of either (0155) -- each asked of the captured
 * fixture, or of `TOGETHER_SNAPSHOT` where the fixture has no table to
 * refuse.
 */
function rootOf(snapshot: MetadataSnapshot, name: string): ObjectMeta {
  const root = findObject(snapshot, { schema: 'sales', name })
  if (root === undefined) throw new Error(`the snapshot has no sales.${name}`)
  return root
}

function request(root: string, lookups: LookupChoice[], extra: Partial<ProposalRequest> = {}): ProposalRequest {
  return { connection: 'fixture', root: { schema: 'sales', name: root }, formId: `sales-${root}`, title: root, lookups, pinned: [], ...extra }
}

const LINE_ORDER: LookupChoice = { foreignKey: 'fk_order_line_order', display: ['order_date'] }
const DELIVERY_ORDER: LookupChoice = { foreignKey: 'fk_delivery_order', display: ['order_date'] }
const TENANT: FormPolicy = { ...EMPTY_POLICY, rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }] }

function reasons(snapshot: MetadataSnapshot, asked: ProposalRequest, policy: FormPolicy = EMPTY_POLICY) {
  const found = togetherReasons(snapshot, rootOf(snapshot, asked.root.name), asked, policy)
  return { blocked: Object.fromEntries(found.blocked), chosen: found.chosen, touch: found.touch }
}

describe('which lookups are offered to be saved with their record', () => {
  // The two rules of the generator's a lookup's own shape decides: a line's
  // order is NOT NULL and another table's, a customer's too; an order's
  // creator may be NULL, and an employee's manager -- made NOT NULL here --
  // is its own table's. Watched failing with the NULL check taken out (the
  // creator offered) and with the table check taken out (the manager
  // offered): a box the generator then refuses whatever else is chosen.
  test('a key NOT NULL onto another table, and no other', () => {
    const offered = (snapshot: MetadataSnapshot, root: string, key: string) => {
      const table = rootOf(snapshot, root)
      const foreignKey = table.foreignKeys.find((candidate) => candidate.name === key)
      if (foreignKey === undefined) throw new Error(`sales.${root} has no ${key}`)
      return togetherCandidate(table, foreignKey)
    }
    expect(offered(OWNER_SNAPSHOT, 'order_line', 'fk_order_line_order')).toBe(true)
    expect(offered(OWNER_SNAPSHOT, 'order', 'fk_order_customer')).toBe(true)
    expect(offered(OWNER_SNAPSHOT, 'order', 'fk_order_created_by')).toBe(false)
    expect(offered(TOGETHER_SNAPSHOT, 'employee', 'fk_employee_manager')).toBe(false)
  })

  // The box starts at no row required and at the largest max the
  // generator's own rule takes, one row less than a list's page: watched
  // failing with SAVE_MAX_ROWS, 100, which that rule refuses -- every box
  // ticked would have started refused -- and with one row fewer, a max
  // below the most a record may hold through the form.
  test('starts at none required and the largest max the generator takes', () => {
    expect(STARTING_BOUNDS.min).toBe(0)
    expect(boundsProblem(STARTING_BOUNDS)).toBeNull()
    expect(boundsProblem({ ...STARTING_BOUNDS, max: STARTING_BOUNDS.max + 1 })).not.toBeNull()
  })
})

describe('which columns a touch is offered through', () => {
  // The design's list for the fixture's sales.order on SQL Server, in
  // catalog order: no key's column (id), no foreign key's (tenant_id,
  // customer_no, created_by, approved_by), nothing generated (row_version),
  // and no pin. Watched failing with `touchColumnProblem` unasked, which
  // listed id and the foreign keys' columns, and with the pins unasked,
  // which listed status pinned.
  test('the generator’s candidates, and no pinned one', () => {
    const order = rootOf(SQLSERVER_SNAPSHOT, 'order')
    expect(touchCandidates(order, []).map((column) => column.name)).toEqual(['order_date', 'status', 'amount', 'notes', 'group'])
    expect(touchCandidates(order, [{ column: 'status', attribute: 'tenant' }]).map((column) => column.name)).toEqual(['order_date', 'amount', 'notes', 'group'])
  })
})

describe('what is refused of them, and in whose words', () => {
  // A delivery under row security: its box is not offered, with the
  // generator's own sentence, before anybody ticks it; the same delivery
  // without row security is offered. Watched failing with the lookups not
  // asked unticked: nothing said until the box was ticked.
  test('a lookup the generator refuses, before its box is ticked', () => {
    expect(reasons(TOGETHER_SNAPSHOT, request('delivery', [DELIVERY_ORDER])).blocked).toEqual({
      fk_delivery_order: 'order is saved with its record, and row security on the table would hide rows from every count',
    })
    expect(reasons(SQLSERVER_SNAPSHOT, request('delivery', [DELIVERY_ORDER])).blocked).toEqual({})
  })

  // A customer's company details, whose key is its foreign key onto the
  // customer: shown as a section of each customer, its box is not offered,
  // in the generator's words, and offered again once it is not a section.
  // Watched failing with the lookups not asked unticked: nothing said
  // until the box was ticked.
  test('a section, before its box is ticked', () => {
    const plain: LookupChoice = { foreignKey: 'fk_customer_company_customer', display: ['name'] }
    expect(reasons(SECTIONS_SNAPSHOT, request('customer_company', [{ ...plain, section: { when: null } }])).blocked).toEqual({
      fk_customer_company_customer: "customer is saved with its record and is a section, and a section's lookup cannot be both",
    })
    expect(reasons(SECTIONS_SNAPSHOT, request('customer_company', [plain])).blocked).toEqual({})
  })

  // Ticked: bounds out of order are the generator's to refuse, a pin
  // outside the order's key is the bundle check's, and on SQL Server a max
  // whose lines one batch cannot hold is the publish gate's -- each in its
  // own words, and the last gone at the max it names. Watched failing with
  // each source left out of `togetherReasons` in turn: each case said
  // nothing.
  test('a lookup ticked, in the generator’s, the bundle check’s and the publish gate’s words', () => {
    const ticked = (bounds: { min: number; max: number }) => [{ ...LINE_ORDER, together: bounds }]
    expect(reasons(OWNER_SNAPSHOT, request('order_line', ticked({ min: 3, max: 2 }))).chosen).toEqual([
      'The generator refuses it: order is saved with its record, and its bounds are not 0 <= min <= max.',
    ])
    const pinned = request('delivery', [{ ...DELIVERY_ORDER, together: { ...STARTING_BOUNDS } }], { pinned: ['tenant_id'], versionColumn: 'row_version' })
    expect(reasons(OWNER_SNAPSHOT, pinned, TENANT).chosen).toEqual([
      "The server refuses the policy with it: rowFilters: tenant_id is outside order's foreign key, and order is saved with its record: a person could read some of a record's rows and not others, and its bound would count rows they do not see.",
    ])
    expect(reasons(TOGETHER_SNAPSHOT, request('order_line', ticked({ ...STARTING_BOUNDS }))).chosen).toEqual([
      'Publishing refuses it: order is saved with its record up to 49 rows, and one change of a row binds up to 54 parameters on SQL Server, past the 2100 one batch holds; a max of 38 or less fits.',
    ])
    expect(reasons(TOGETHER_SNAPSHOT, request('order_line', ticked({ min: 0, max: 38 }))).chosen).toEqual([])
  })

  // A touch column a pin took is the generator's to refuse, said of the
  // touch column alone, and the order's lookups nothing. Watched failing
  // with the touch unasked: nothing said of it.
  test('a touch column the generator refuses', () => {
    const order = request('order', [{ foreignKey: 'fk_order_customer', display: ['name'] }], { pinned: ['status'], touchColumn: 'status' })
    expect(reasons(SQLSERVER_SNAPSHOT, order)).toEqual({
      blocked: {},
      chosen: [],
      touch: 'the touch column status is pinned by the policy, and a save of rows would write it',
    })
    expect(reasons(SQLSERVER_SNAPSHOT, { ...order, pinned: [] }).touch).toBeNull()
  })

  // Where the request is refused without anything saved together -- a pin
  // on a column the table does not have -- nothing is blamed on the box:
  // Generate sends it, and says the server's refusal. Watched failing with
  // that request unasked: the box was refused with the pin's sentence.
  test('nothing, where the rest of the request is refused', () => {
    expect(reasons(TOGETHER_SNAPSHOT, request('delivery', [DELIVERY_ORDER], { pinned: ['nope'] }))).toEqual({ blocked: {}, chosen: [], touch: null })
  })
})
