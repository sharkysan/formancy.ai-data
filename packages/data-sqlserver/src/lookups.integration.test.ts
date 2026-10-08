import mssql from 'mssql'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { LookupConfig, LookupOptions, LookupQuery, LookupRow, MetadataSnapshot, ObjectRef, RowFilters } from '@formancy/data-core'
import { buildLookupConfig, generateForm } from '@formancy/data-core'
import type { SqlServerFixture } from '@formancy/data-fixtures'
import { startSqlServerFixture } from '@formancy/data-fixtures'
import { createSqlServerLookups, discoverSqlServer } from './index.js'

/**
 * The lookup half of the port against REAL SQL Server, loaded with the shared
 * fixture, as its owner and as `formancy_reader`, who may read sales.order and
 * nothing else.
 *
 * Every configuration here is derived the way a deployment derives one: the
 * snapshot is discovered, the bindings are generated from it, and
 * `buildLookupConfig` checks one against the other. So every identifier the
 * adapter quotes came from the catalog, as it will in production.
 */
let fixture: SqlServerFixture
let owner: mssql.ConnectionPool
let reader: mssql.ConnectionPool
let snapshot: MetadataSnapshot

const ORDER: ObjectRef = { schema: 'sales', name: 'order' }
const CUSTOMER: ObjectRef = { schema: 'sales', name: 'customer' }
const CODE_USE: ObjectRef = { schema: 'ops', name: 'code_use' }

/** 'é' forty times: 200 characters of escapes, which with `k1:` no token can hold. */
const TOO_LONG_FOR_A_TOKEN = 'é'.repeat(40)

beforeAll(async () => {
  fixture = await startSqlServerFixture()
  owner = await new mssql.ConnectionPool(fixture.admin).connect()
  reader = await new mssql.ConnectionPool(fixture.reader).connect()

  // Tenant 3's customers carry the characters LIKE treats specially, names
  // whose case-insensitive order is not their code-point order, and credit
  // limits with NULLs among them. Constants of this file, so they are spliced.
  await owner.request().batch(`insert into sales.customer (tenant_id, customer_no, name, credit_limit) values
    (3, 1, N'100% Bio', 5.00), (3, 2, N'A_B', null), (3, 3, N'AxB', 1.00),
    (3, 4, N'[x] Brackets', null), (3, 5, N'x marks', 3.00), (3, 6, N'apple', 2.00), (3, 7, N'Banana', 4.00)`)
  // A unique key that admits a NULL, and a key no token can hold.
  await owner.request().batch('create schema ops')
  await owner.request().batch(`create table ops.code (code nvarchar(60) null constraint uq_code unique, label nvarchar(50) not null);
    create table ops.code_use (id int not null constraint pk_code_use primary key,
      code nvarchar(60) null constraint fk_code_use_code references ops.code (code))`)
  await owner
    .request()
    .input('long', mssql.NVarChar(mssql.MAX), TOO_LONG_FOR_A_TOKEN)
    .query(`insert into ops.code (code, label) values (N'A', N'Alpha'), (null, N'Nothing'), (@long, N'Long')`)

  snapshot = await discoverSqlServer(owner, { schemas: ['sales', 'ops'] })
})

afterAll(async () => {
  await reader?.close()
  await owner?.close()
  await fixture?.stop()
})

/** The lookup a form over `root` gets for `foreignKey`, derived exactly as a deployment derives it. */
function lookupConfig(root: ObjectRef, foreignKey: string, display: string[], options: Omit<LookupOptions, 'snapshot'> = {}): LookupConfig {
  const { bindings } = generateForm(snapshot, { connection: 'erp', root, formId: 'form', title: 'Form', lookups: [{ foreignKey, display }] })
  const field = bindings.fields.find((binding) => binding.kind === 'lookup')
  if (field === undefined) throw new Error(`the form over ${root.name} has no lookup for ${foreignKey}`)
  return buildLookupConfig(bindings, field.field, { snapshot, ...options })
}

const customers = (): LookupConfig => lookupConfig(ORDER, 'fk_order_customer', ['name'])
const tenant = (value: string): RowFilters => ({ kind: 'restricted', equal: [{ column: 'tenant_id', value }] })
const EVERY_ROW: RowFilters = { kind: 'unrestricted' }
const page = (search: string, offset = 0, limit = 50): LookupQuery => ({ search, offset, limit })
const labels = (rows: readonly LookupRow[]): string[] => rows.map((row) => row.label)

describe('the tenant filter', () => {
  // The plan's sentence: reject cross-tenant keys even when the referenced
  // record exists. Tenant 2 has a customer 1001 too, so a lookup that ran the
  // filter after the query, or not at all, would offer it.
  test("offers only the tenant's own customers", async () => {
    const lookups = createSqlServerLookups(owner)
    expect(await lookups.search(customers(), page(''), tenant('1'))).toEqual({
      rows: [{ token: 'k1:1,1001', label: 'Muster AG' }],
      hasMore: false,
      omitted: 0,
    })
  })

  // A forged token is refused for the same reason an invented one is: no row
  // found under this actor's filters encodes to it (0012). Another tenant's
  // real customer, a customer that does not exist and a string that is not a
  // token are all non-members; the tenant's own is not.
  test("rejects another tenant's token, and resolve leaves it out", async () => {
    const lookups = createSqlServerLookups(owner)
    const tokens = ['k1:1,1001', 'k1:2,1001', 'k1:1,9999', 'not a token']
    expect(await lookups.rejects(customers(), tokens, tenant('1'))).toEqual(['k1:2,1001', 'k1:1,9999', 'not a token'])
    expect(await lookups.resolve(customers(), tokens, tenant('1'))).toEqual([{ token: 'k1:1,1001', label: 'Muster AG' }])
    // The same token for the tenant it belongs to is a member: the 1 above was the filter's doing.
    expect(await lookups.rejects(customers(), ['k1:2,1001'], tenant('2'))).toEqual([])
  })

  // An empty restriction is what a missing policy defaults to, so it must not
  // read as "every row" (0012): it is refused before a statement is built.
  // Every row has to be written as `unrestricted`. A filter on a column the
  // table does not have is the database's refusal, not a filter dropped.
  test('every row is only ever offered when the filters say unrestricted', async () => {
    const lookups = createSqlServerLookups(owner)
    const empty = { kind: 'restricted', equal: [] } as unknown as RowFilters
    await expect(lookups.search(customers(), page(''), empty)).rejects.toThrow(/Row filters are/)
    await expect(lookups.rejects(customers(), ['k1:1,1001'], empty)).rejects.toThrow(/Row filters are/)
    await expect(lookups.resolve(customers(), ['k1:1,1001'], empty)).rejects.toThrow(/Row filters are/)
    const everyone = await lookups.search(customers(), page('GmbH'), EVERY_ROW)
    expect(labels(everyone.rows)).toEqual(['Other Tenant GmbH'])
    const wrongColumn: RowFilters = { kind: 'restricted', equal: [{ column: 'region', value: 'north' }] }
    await expect(lookups.search(customers(), page(''), wrongColumn)).rejects.toMatchObject({ number: 207 })
  })
})

describe('a search', () => {
  // formancy's own narrowing takes the query as text (0012). In LIKE, `%` and
  // `_` are wildcards and `[x]` is a character class, so an unescaped search
  // for '%' offers every row, '_' finds AxB and '[x]' finds 'x marks'.
  test('for %, _ or [x] matches only those characters', async () => {
    const lookups = createSqlServerLookups(owner)
    const search = async (text: string) => labels((await lookups.search(customers(), page(text), tenant('3'))).rows)
    expect(await search('%')).toEqual(['100% Bio'])
    expect(await search('_')).toEqual(['A_B'])
    expect(await search('[x]')).toEqual(['[x] Brackets'])
    // And an ordinary search still matches anywhere in the text.
    expect(await search('x')).toEqual(['[x] Brackets', 'AxB', 'x marks'])
  })

  // Case is the column's collation's: the fixture database is
  // SQL_Latin1_General_CP1_CI_AS, so 'muster' finds 'Muster AG'. Written down
  // here because PostgreSQL's default is the other way round.
  test("compares case by the column's collation", async () => {
    const lookups = createSqlServerLookups(owner)
    expect(labels((await lookups.search(customers(), page('muster'), tenant('1'))).rows)).toEqual(['Muster AG'])
  })

  // A displayed integer is searched as the digits its label shows, so typing
  // a customer number finds the customer. The configuration does not carry a
  // search column's type; the server converts the integer for LIKE.
  test('matches an integer column by the digits a label shows', async () => {
    const lookups = createSqlServerLookups(owner)
    const config = lookupConfig(ORDER, 'fk_order_customer', ['customer_no', 'name'])
    expect(config.search).toEqual(['customer_no', 'name'])
    expect((await lookups.search(config, page('100'), tenant('1'))).rows).toEqual([{ token: 'k1:1,1001', label: '1001 · Muster AG' }])
    expect((await lookups.search(config, page('99'), tenant('1'))).rows).toEqual([])
  })
})

describe('the order of a page', () => {
  // SQL Server puts NULLs first in an ascending order; the configuration says
  // last unless an administrator chose otherwise, so the two engines offer the
  // same first page (0012). Without the CASE that places them, A_B and
  // [x] Brackets would lead.
  test('puts NULLs where the configuration says, whichever way the list runs', async () => {
    const lookups = createSqlServerLookups(owner)
    const byLimit = (nulls: 'first' | 'last', direction: 'asc' | 'desc' = 'asc') =>
      lookupConfig(ORDER, 'fk_order_customer', ['name'], { sort: [{ column: 'credit_limit', direction, nulls }] })
    const order = async (config: LookupConfig) => labels((await lookups.search(config, page(''), tenant('3'))).rows)
    expect(await order(byLimit('last'))).toEqual(['AxB', 'apple', 'x marks', 'Banana', '100% Bio', 'A_B', '[x] Brackets'])
    expect(await order(byLimit('first'))).toEqual(['A_B', '[x] Brackets', 'AxB', 'apple', 'x marks', 'Banana', '100% Bio'])
    expect(await order(byLimit('last', 'desc'))).toEqual(['100% Bio', 'Banana', 'x marks', 'apple', 'AxB', 'A_B', '[x] Brackets'])
  })

  // Text is ordered by the column's collation, which is the server's rule and
  // not code-point order: case-insensitively, 'apple' comes before 'Banana',
  // where code points would put every capital first. Said here because a
  // conformance case cannot compare this order across engines (0012).
  test("orders text by the column's collation, not by code point", async () => {
    const lookups = createSqlServerLookups(owner)
    expect(labels((await lookups.search(customers(), page(''), tenant('3'))).rows)).toEqual([
      '[x] Brackets',
      '100% Bio',
      'A_B',
      'apple',
      'AxB',
      'Banana',
      'x marks',
    ])
  })

  // Offset paging over a total order neither repeats nor skips a row, and the
  // extra row read past each page says whether there is another.
  test('pages through every row once, and says when there is more', async () => {
    const lookups = createSqlServerLookups(owner)
    const pages = await Promise.all([0, 3, 6].map((offset) => lookups.search(customers(), page('', offset, 3), tenant('3'))))
    expect(pages.map((result) => result.hasMore)).toEqual([true, true, false])
    const all = await lookups.search(customers(), page(''), tenant('3'))
    expect(pages.flatMap((result) => result.rows)).toEqual(all.rows)
  })
})

describe('keys a token cannot carry', () => {
  // A unique key admits one NULL on SQL Server. No foreign key value can
  // reference that row, so offering it would offer a choice that cannot be
  // saved. And a row whose key needs more than 200 characters as a token is
  // counted, so "not there" and "cannot be offered" stay different answers.
  test('a NULL key is never offered, and a key too long for a token is counted in omitted', async () => {
    const lookups = createSqlServerLookups(owner)
    const config = lookupConfig(CODE_USE, 'fk_code_use_code', ['label'])
    expect(await lookups.search(config, page(''), EVERY_ROW)).toEqual({ rows: [{ token: 'k1:A', label: 'Alpha' }], hasMore: false, omitted: 1 })
  })

  // SQL Server's `=` ignores case under this collation and trailing spaces
  // under every one, so `IN` finds CH for 'ch' and A for 'A '. Membership is
  // the re-encoded row's (0012): a token the lookup never offered is refused,
  // and resolve does not label it with another row's name.
  test('a token spelled differently from the row the database matched is rejected', async () => {
    const lookups = createSqlServerLookups(owner)
    const countries = lookupConfig(CUSTOMER, 'fk_customer_country', ['name'])
    expect(await lookups.rejects(countries, ['k1:CH', 'k1:ch'], EVERY_ROW)).toEqual(['k1:ch'])
    expect(await lookups.resolve(countries, ['k1:ch'], EVERY_ROW)).toEqual([])
    expect(await lookups.resolve(countries, ['k1:CH'], EVERY_ROW)).toEqual([{ token: 'k1:CH', label: 'Switzerland' }])
    const codes = lookupConfig(CODE_USE, 'fk_code_use_code', ['label'])
    expect(await lookups.rejects(codes, ['k1:A', 'k1:A~0020'], EVERY_ROW)).toEqual(['k1:A~0020'])
  })
})

describe('the parameter limit', () => {
  // Why the adapter splits at 2098 and not at the 2100 the message names: the
  // driver sends a parameterised statement through sp_executesql, whose own
  // two parameters count. A change in the driver or the server moves this.
  test('a statement may bind 2098 parameters, and 2099 is refused with 8003', async () => {
    const bind = async (count: number) => {
      const request = owner.request()
      const names = Array.from({ length: count }, (_, index) => {
        request.input(`p${String(index)}`, mssql.Int, index)
        return `(@p${String(index)})`
      })
      return request.query(`select count(*) as n from (values ${names.join(', ')}) as v (x)`)
    }
    await expect(bind(2098)).resolves.toMatchObject({ recordset: [{ n: 2098 }] })
    await expect(bind(2099)).rejects.toMatchObject({ number: 8003 })
  })

  // formancy asks about every value a submission holds at once; a datagrid of
  // lookups is thousands. Two parameters per composite key and one per filter
  // put 2500 keys far past the limit, so they are asked about in groups, and
  // the answer is the same as for one.
  test('resolve and rejects answer for thousands of tokens', async () => {
    const lookups = createSqlServerLookups(owner)
    const invented = Array.from({ length: 2500 }, (_, index) => `k1:1,${String(index + 2000)}`)
    const tokens = [...invented.slice(0, 1250), 'k1:1,1001', ...invented.slice(1250)]
    expect(await lookups.rejects(customers(), tokens, tenant('1'))).toEqual(invented)
    expect(await lookups.resolve(customers(), tokens, tenant('1'))).toEqual([{ token: 'k1:1,1001', label: 'Muster AG' }])
  })
})

describe('as the restricted reader', () => {
  // formancy_reader may read sales.order and not sales.customer. A lookup
  // that answered "nothing found" would let a submission through formancy's
  // members port as though every token were simply wrong; it must refuse
  // instead (formancy.ai 0022), which a thrown error does.
  test('a lookup over a table the account may not read throws rather than offering nothing', async () => {
    const lookups = createSqlServerLookups(reader)
    await expect(lookups.search(customers(), page(''), tenant('1'))).rejects.toMatchObject({ number: 229 })
    await expect(lookups.rejects(customers(), ['k1:1,1001'], tenant('1'))).rejects.toMatchObject({ number: 229 })
    // Nothing is asked when no token could be a member, so there is nothing to refuse.
    expect(await lookups.rejects(customers(), ['not a token'], tenant('1'))).toEqual(['not a token'])
    expect(await lookups.resolve(customers(), ['not a token', 'k1:x,1001'], tenant('1'))).toEqual([])
  })
})

describe('a request the configuration cannot answer', () => {
  // validateLookupQuery refuses a search on a lookup with nothing searchable;
  // an adapter handed one anyway must not drop the search and list every row.
  // And filters so many that no key fits in a statement are refused rather
  // than sent as a statement the server refuses.
  test('is refused before a statement is built', async () => {
    const lookups = createSqlServerLookups(owner)
    const unsearchable = lookupConfig(ORDER, 'fk_order_customer', ['credit_limit'])
    expect(unsearchable.search).toEqual([])
    await expect(lookups.search(unsearchable, page('Muster'), tenant('1'))).rejects.toThrow(/no searchable column/)
    expect((await lookups.search(unsearchable, page(''), tenant('1'))).rows).toEqual([{ token: 'k1:1,1001', label: '999999999999.99' }])
    const crowded: RowFilters = { kind: 'restricted', equal: [{ column: 'tenant_id', value: '1' }, ...Array.from({ length: 2096 }, () => ({ column: 'tenant_id', value: '1' }))] }
    await expect(lookups.resolve(customers(), ['k1:1,1001'], crowded)).rejects.toThrow(/leave no parameter for a key/)
  })
})
