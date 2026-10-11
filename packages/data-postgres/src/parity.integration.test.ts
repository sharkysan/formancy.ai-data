import { buildLookupConfig, encodeKeyToken, findObject, generateForm, rowFilterTerms, scopeRowFilters } from '@formancy/data-core'
import type {
  ApiValue,
  LookupConfig,
  LookupOptions,
  LookupQuery,
  MetadataSnapshot,
  ObjectMeta,
  ObjectRef,
  RecordColumn,
  RecordFailure,
  RecordOutcome,
  RecordTarget,
  RecordValue,
  RowFilters,
  UpdateRequest,
} from '@formancy/data-core'
import type { PostgresFixture } from '@formancy/data-fixtures'
import { covers, defined, DISPLAY_PARITY, displayCase, FILTER_PARITY, filterCase, PARITY_SCOPE, REFUSAL_PARITY, refusalCase, startPostgresFixture, TEMPORAL_PARITY, temporalCase } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createPostgresLookups, createPostgresRecords, discoverPostgres } from './index.js'
import { searchStatement } from './lookups/sql.js'

/**
 * The parity cases of 0028 against REAL PostgreSQL: the shared fixture's
 * `parity` schema, discovered as its owner, with the answers written once in
 * `@formancy/data-fixtures` for both engines. The SQL Server suite runs the
 * same cases, so a row filter, a label or a refusal that means something else
 * on one engine fails on that one.
 *
 * Configs are built the way a deployment builds them — discovery, the
 * generator, `buildLookupConfig` — and filters the way the planner and the
 * server scope them, with `scopeRowFilters`.
 */
let fixture: PostgresFixture
let owner: Sql
let parity: MetadataSnapshot

const FIRST_PAGE: LookupQuery = { search: '', offset: 0, limit: 50 }
const EVERY_ROW: RowFilters = { kind: 'unrestricted' }

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  parity = await discoverPostgres(owner, PARITY_SCOPE)
})

afterAll(async () => {
  await owner?.end()
  await fixture?.stop()
})

function objectOf(name: string): ObjectMeta {
  const found = findObject(parity, { schema: 'parity', name })
  if (found === undefined) throw new Error(`discovery found no parity.${name}`)
  return found
}

function col(table: string, name: string): RecordColumn {
  const found = objectOf(table).columns.find((column) => column.name === name)
  if (found === undefined) throw new Error(`parity.${table} has no column ${name}`)
  return { name, type: found.type }
}

function val(table: string, name: string, value: ApiValue): RecordValue {
  return { ...col(table, name), value }
}

function versioned(table: string, identity: readonly string[]): RecordTarget & UpdateRequest['target'] {
  return { table: { schema: 'parity', name: table }, identity: identity.map((name) => col(table, name)), concurrency: { kind: 'version-column', column: 'version' } }
}

/** The filters a policy's rule on tenant_item becomes, scoped as the planner and the server scope them. */
function scoped(column: string, value: string): RowFilters {
  const scoping = scopeRowFilters(objectOf('tenant_item'), [{ column, value }], 'parity')
  if (!scoping.ok) throw new Error(scoping.message)
  return scoping.filters
}

function lookupOver(root: string, foreignKey: string, display: string[], options: Omit<LookupOptions, 'snapshot'> = {}): LookupConfig {
  const rootRef: ObjectRef = { schema: 'parity', name: root }
  const { bindings } = generateForm(parity, { connection: 'test', root: rootRef, formId: 'parity', title: 'Parity', lookups: [{ foreignKey, display }] })
  const field = bindings.fields.find((candidate) => candidate.kind === 'lookup' && candidate.foreignKey === foreignKey)
  if (field === undefined) throw new Error(`the generator made no lookup for ${foreignKey}`)
  return buildLookupConfig(bindings, field.field, { snapshot: parity, ...options })
}

function tokenOf(...key: string[]): string {
  const encoded = encodeKeyToken(key)
  if (!encoded.ok) throw new Error(encoded.message)
  return encoded.token
}

function failed(outcome: RecordOutcome): RecordFailure {
  if (outcome.ok) throw new Error(`expected a failure, got ${JSON.stringify(outcome)}`)
  return outcome
}

const items = (): LookupConfig => lookupOver('item_use', 'fk_item_use_item', ['label'])
const tenantItem = () => versioned('tenant_item', ['tenant_code', 'item_no'])

/** Every key a filter case names: the rows that differ by case, a trailing space and an accent. */
const NAMED: ReadonlyArray<readonly [string, string]> = [
  ...new Map(FILTER_PARITY.flatMap((entry) => ('keys' in entry ? entry.keys : [])).map((key) => [tokenOf(...key), key] as const)).values(),
]

/** Each named row's label and version, by token, read by the owner without any filter. */
async function namedRows(): Promise<Map<string, { label: string; version: string }>> {
  const rows = await owner<{ tenant_code: string; item_no: string; label: string; version: string }[]>`
    select tenant_code, item_no::text as item_no, label, version::text as version from parity.tenant_item where item_no <= 4`
  return new Map(rows.map((row) => [tokenOf(row.tenant_code, row.item_no), { label: row.label, version: row.version }]))
}

describe('a row filter compares the canonical value exactly (FILTER_PARITY)', () => {
  test('the fixture has the named rows the cases are about', async () => {
    // A case whose rows were never loaded would pass by finding nothing.
    expect(NAMED).toHaveLength(4)
    expect([...(await namedRows()).keys()].sort()).toEqual(NAMED.map((key) => tokenOf(...key)).sort())
  })

  for (const entry of FILTER_PARITY) {
    if ('refused' in entry) {
      // A fixed-length column's canonical value has no trailing space, so
      // `AB ` names nothing it holds. Bound, PostgreSQL's bpchar equality
      // would ignore the space and select all four rows; refused, no SQL is
      // built. And a term that reaches the adapter by hand is thrown before
      // anything is sent.
      test(`${entry.column} = '${entry.value}' is refused before any SQL is built`, covers('postgres', filterCase(entry)), async () => {
        const scoping = scopeRowFilters(objectOf('tenant_item'), [{ column: entry.column, value: entry.value }], 'parity')
        expect(scoping).toMatchObject({ ok: false, code: entry.refused })
        const forged = { kind: 'restricted', equal: [{ column: entry.column, type: col('tenant_item', entry.column).type, value: entry.value }] } as unknown as RowFilters
        await expect(createPostgresLookups(owner).search(items(), FIRST_PAGE, forged)).rejects.toThrow(/not spelled as its column holds it/)
        const read = defined(createPostgresRecords(owner)).read({ target: tenantItem(), key: [val('tenant_item', 'tenant_code', 'acme'), val('tenant_item', 'item_no', '1')], columns: [], filters: forged, through: [] })
        await expect(read).rejects.toThrow(/not spelled as its column holds it/)
      })
      continue
    }

    // Before 0028 the term was a parameter declared `unknown`, so the server
    // compared it in the column's collation: under parity.ci, which is case
    // insensitive, tenant `acme` read `ACME`'s rows too (C3c) — and SQL
    // Server, comparing differently, disagreed. Every path a filter scopes is
    // run: the lookup's page, its resolve and its membership, a read and an
    // update.
    test(`${entry.column} = '${entry.value}' selects exactly ${String(entry.keys.length)} named row(s), in every operation`, covers('postgres', filterCase(entry)), async () => {
      const filters = scoped(entry.column, entry.value)
      const expected = new Set(entry.keys.map((key) => tokenOf(...key)))
      const named = NAMED.map((key) => tokenOf(...key))
      const lookups = createPostgresLookups(owner)

      const page = await lookups.search(items(), FIRST_PAGE, filters)
      expect(new Set(page.rows.map((row) => row.token))).toEqual(expected)
      expect(page.hasMore).toBe(false)
      expect(new Set((await lookups.resolve(items(), named, filters)).map((row) => row.token))).toEqual(expected)
      expect(new Set(await lookups.rejects(items(), named, filters))).toEqual(new Set(named.filter((token) => !expected.has(token))))

      const records = defined(createPostgresRecords(owner))
      const before = await namedRows()
      for (const [tenant, item] of NAMED) {
        const key = [val('tenant_item', 'tenant_code', tenant), val('tenant_item', 'item_no', item)]
        const token = tokenOf(tenant, item)
        const read = await records.read({ target: tenantItem(), key, columns: [col('tenant_item', 'label')], filters, through: [] })
        expect(read.ok ? 'found' : read.code, token).toBe(expected.has(token) ? 'found' : 'not-found')
        const row = before.get(token)
        if (row === undefined) throw new Error(`${token} is not a named row`)
        const update = await records.update({
          target: tenantItem(),
          key,
          set: [val('tenant_item', 'label', row.label)],
          expectedVersion: row.version,
          filters, through: [],
          returning: [],
        })
        expect(update.ok ? 'written' : update.code, token).toBe(expected.has(token) ? 'written' : 'not-found')
      }
      // The update moved the version of the rows inside the filter, and of no other.
      const after = await namedRows()
      for (const token of named) {
        const moved = BigInt(after.get(token)?.version ?? '0') - BigInt(before.get(token)?.version ?? '0')
        expect(moved, token).toBe(expected.has(token) ? 1n : 0n)
      }
    })
  }

  // The first conjunct compares in the column's own type and collation, so
  // the primary key serves the filter; the "C" comparison only removes what
  // the collation let through (C4). A filter spelled with only the exact
  // comparison is right and reads all 20,004 rows on every keystroke. The
  // plan is EXPLAIN's: there is nothing else to read it from.
  test('the tenant filter is served by pk_tenant_item, with the exact comparison as a filter on what it found', async () => {
    const statement = searchStatement(items(), FIRST_PAGE, rowFilterTerms(scoped('tenant_code', 'acme')))
    const [row] = await owner.unsafe(`explain (format json) ${statement.text}`, statement.params as (string | null)[])
    const raw: unknown = (row as Record<string, unknown>)['QUERY PLAN']
    const plan = (typeof raw === 'string' ? JSON.parse(raw) : raw) as [{ Plan: PlanNode }]
    const nodes = flatten(plan[0].Plan)
    const index = nodes.find((node) => node['Index Name'] === 'pk_tenant_item')
    expect(index?.['Index Cond'], JSON.stringify(plan)).toMatch(/tenant_code/)
    expect(nodes.some((node) => /COLLATE "C"/.test(node.Filter ?? '')), JSON.stringify(plan)).toBe(true)
  })
})

describe('an exact filter with objects planted on the search path', () => {
  /**
   * The exact comparison names a collation and a type, and both are resolved
   * through the search path unless qualified: a `public."C"` that ignores case
   * would make the exact conjunct as lax as the first, and a `public.bpchar`
   * that refuses every value would fail every char(n) filter. A role with
   * CREATE on `public` can define either (every login role up to PostgreSQL
   * 14), and they win when the composition root's search_path names
   * pg_catalog last. The lookups suite plants the rest; these two are the
   * text filter's.
   */
  const PLANTED = `
    create collation public."C" (provider = icu, locale = 'und-u-ks-level2', deterministic = false);
    create domain public.bpchar as pg_catalog.text check (false);`

  test('change no filter case, whether pg_catalog is searched first or last', async () => {
    const cases = FILTER_PARITY.filter((entry) => 'keys' in entry)
    const ask = async (driver: Sql) => {
      const lookups = createPostgresLookups(driver)
      const answers: string[][] = []
      for (const entry of cases) answers.push((await lookups.search(items(), FIRST_PAGE, scoped(entry.column, entry.value))).rows.map((row) => row.token).sort())
      return answers
    }
    const expected = cases.map((entry) => ('keys' in entry ? entry.keys.map((key) => tokenOf(...key)).sort() : []))
    expect(await ask(owner)).toEqual(expected)

    await owner.begin(async (tx) => {
      await tx.unsafe('create role parity_planter; grant create on schema public to parity_planter')
      await tx.unsafe(`set local role parity_planter; ${PLANTED}`)
    })
    // Fresh drivers: a statement prepared before the planting keeps the names it resolved then.
    const catalogFirst = postgres(fixture.admin, { onnotice: () => {} })
    const catalogLast = postgres(fixture.admin, { onnotice: () => {}, connection: { search_path: 'public, pg_catalog' } })
    try {
      // The planted collation is what an unqualified "C" names on that path.
      const [shadowed] = await catalogLast<{ equal: boolean }[]>`select ('acme' collate "C") = ('ACME' collate "C") as equal`
      expect(shadowed?.equal).toBe(true)
      expect(await ask(catalogFirst)).toEqual(expected)
      expect(await ask(catalogLast)).toEqual(expected)
    } finally {
      await Promise.all([catalogFirst.end(), catalogLast.end()])
      await owner.unsafe('drop collation public."C"; drop domain public.bpchar; revoke create on schema public from parity_planter; drop role parity_planter')
    }
  })
})

describe('an unconstrained numeric, which only PostgreSQL has', () => {
  // A `numeric` with no scale keeps the scale each value was given, so 12.5,
  // 12.50 and 12.500 are three canonical values (0008) — and numeric
  // equality ignores scale, so a filter of '12.5' compared as numbers
  // admitted all three rows, where the filter promises the one whose value is
  // exactly '12.5'. SQL Server has no such column; every decimal there has a
  // scale, under which equal numbers are spelled alike.
  test("a filter admits only the row whose canonical value is the term's, scale included", async () => {
    await owner.unsafe(`
      create schema measured;
      create table measured.amount (id int not null constraint pk_amount primary key, amount numeric not null, version int not null default 0);
      insert into measured.amount (id, amount) values (1, 12.5), (2, 12.50), (3, 12.500);
      create table measured.amount_use (id int not null constraint pk_amount_use primary key,
        amount_id int not null constraint fk_amount_use_amount references measured.amount (id))`)
    const measured = await discoverPostgres(owner, { schemas: ['measured'] })
    const amount = findObject(measured, { schema: 'measured', name: 'amount' })
    if (amount === undefined) throw new Error('discovery found no measured.amount')
    expect(amount.columns.find((column) => column.name === 'amount')?.type).toEqual({ kind: 'decimal', precision: null, scale: null })
    const scoping = scopeRowFilters(amount, [{ column: 'amount', value: '12.5' }], 'measured')
    if (!scoping.ok) throw new Error(scoping.message)

    const { bindings } = generateForm(measured, { connection: 'test', root: { schema: 'measured', name: 'amount_use' }, formId: 'measured', title: 'Measured', lookups: [{ foreignKey: 'fk_amount_use_amount', display: ['amount'] }] })
    const field = bindings.fields.find((candidate) => candidate.kind === 'lookup')
    if (field === undefined) throw new Error('the generator made no lookup for fk_amount_use_amount')
    const config = buildLookupConfig(bindings, field.field, { snapshot: measured })
    const page = await createPostgresLookups(owner).search(config, FIRST_PAGE, scoping.filters)
    expect(page.rows).toEqual([{ token: tokenOf('1'), label: '12.5' }])

    const idType = amount.columns.find((column) => column.name === 'id')?.type
    if (idType === undefined) throw new Error('measured.amount has no id')
    const target: RecordTarget = { table: amount.ref, identity: [{ name: 'id', type: idType }], concurrency: null }
    const found: string[] = []
    for (const id of ['1', '2', '3']) {
      const read = await defined(createPostgresRecords(owner)).read({ target, key: [{ name: 'id', type: idType, value: id }], columns: [], filters: scoping.filters, through: [] })
      if (read.ok) found.push(id)
    }
    expect(found).toEqual(['1'])
  })
})

interface PlanNode {
  'Node Type': string
  'Index Name'?: string
  'Index Cond'?: string
  Filter?: string
  Plans?: PlanNode[]
}

function flatten(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(flatten)]
}

describe('a label is spelled once, from the canonical value (DISPLAY_PARITY)', () => {
  const kinds = (column: string): LookupConfig => lookupOver('display_use', 'fk_display_use_kinds', [column])

  async function labels(sql: Sql): Promise<Record<string, string>> {
    const lookups = createPostgresLookups(sql)
    const found: Record<string, string> = {}
    for (const column of Object.keys(DISPLAY_PARITY)) {
      const page = await lookups.search(kinds(column), FIRST_PAGE, EVERY_ROW)
      const [resolved] = await lookups.resolve(kinds(column), [tokenOf('1')], EVERY_ROW)
      // A search and a resolve that labelled one row two ways would show a person both.
      expect(resolved?.label, column).toBe(page.rows[0]?.label)
      found[column] = page.rows[0]?.label ?? '(no row)'
    }
    return found
  }

  // Before 0028 a label was `to_jsonb`'s text: an instant in the session's
  // TimeZone with its offset, a time with its fraction, a float in
  // `extra_float_digits` (C6-pg) — what the composition root configured, and
  // not what SQL Server showed for the same row. Read through the record
  // reader and spelled by `displayText`, no session setting reaches it. The
  // fixture's floats are ones those digits change: 0.1 + 0.2 reads 0.3 and
  // the real 1234567.875 reads 1.23457e+06 at 0. The setting is a string:
  // postgres.js drops a startup parameter whose value is falsy, so `0` as a
  // number never reached the server, and the session is asked what it has.
  test('every kind reads as the shared label, whatever TimeZone, DateStyle and float digits the session has', covers('postgres', ...Object.keys(DISPLAY_PARITY).map(displayCase)), async () => {
    const configured = postgres(fixture.admin, {
      onnotice: () => {},
      connection: { TimeZone: 'America/New_York', extra_float_digits: '0', DateStyle: 'SQL, DMY' },
    })
    try {
      const [settings] = await configured<{ digits: string; zone: string; style: string }[]>`
        select current_setting('extra_float_digits') as digits, current_setting('TimeZone') as zone, current_setting('DateStyle') as style`
      expect(settings).toEqual({ digits: '0', zone: 'America/New_York', style: 'SQL, DMY' })
      expect(await labels(configured)).toEqual(DISPLAY_PARITY)
      expect(await labels(owner)).toEqual(DISPLAY_PARITY)
    } finally {
      await configured.end()
    }
  })

  // An integer is searched as its canonical text, the digits a label shows.
  // Compared through any other conversion — a float, a locale's grouping — a
  // bigint past 2^53 would be found by a neighbour's digits or not at all.
  test('an integer column is searched as the digits its label shows', async () => {
    const lookups = createPostgresLookups(owner)
    const config = kinds('i')
    expect(config.search.map((column) => column.name)).toEqual(['i'])
    expect((await lookups.search(config, { search: '9007199254740993', offset: 0, limit: 50 }, EVERY_ROW)).rows).toEqual([{ token: tokenOf('1'), label: '9007199254740993' }])
    expect((await lookups.search(config, { search: '9007199254740992', offset: 0, limit: 50 }, EVERY_ROW)).rows).toEqual([])
  })
})

describe('an instant and a time are read cut to the shape (TEMPORAL_PARITY)', () => {
  // The row holds milliseconds of both, and the instant was written at
  // +02:00. Read faithfully, as this adapter read before 0040, neither is a
  // value its field accepts, so a host that sends every field back could not
  // save the record; rounded, .789 would carry into the next second and
  // minute. Under a session that would spell either differently -- another
  // TimeZone, another DateStyle -- the answer is the same. The session is
  // asked what it has first, as the label case above does: a setting the
  // driver dropped on the way would leave that half proving nothing.
  test('to the second in UTC and to the minute, cut and never rounded, whatever the session', covers('postgres', ...(Object.keys(TEMPORAL_PARITY) as (keyof typeof TEMPORAL_PARITY)[]).map(temporalCase)), async () => {
    const configured = postgres(fixture.admin, { onnotice: () => {}, connection: { TimeZone: 'Pacific/Chatham', DateStyle: 'SQL, DMY' } })
    try {
      const [settings] = await configured<{ zone: string; style: string }[]>`select current_setting('TimeZone') as zone, current_setting('DateStyle') as style`
      expect(settings).toEqual({ zone: 'Pacific/Chatham', style: 'SQL, DMY' })
      const request = {
        target: { table: { schema: 'parity', name: 'display_kinds' }, identity: [col('display_kinds', 'id')], concurrency: null },
        key: [val('display_kinds', 'id', '1')],
        columns: [col('display_kinds', 'tm'), col('display_kinds', 'ts')],
        filters: EVERY_ROW, through: [],
      }
      for (const sql of [owner, configured]) expect(await defined(createPostgresRecords(sql)).read(request)).toEqual({ ok: true, values: TEMPORAL_PARITY, version: null })
    } finally {
      await configured.end()
    }
  })
})

describe('a refusal is named alike on both engines (REFUSAL_PARITY)', () => {
  const guarded = () => versioned('guarded', ['id'])
  const insertGuarded = (sql: Sql, id: string, note: string) =>
    defined(createPostgresRecords(sql)).insert({ target: guarded(), values: [val('guarded', 'id', id), val('guarded', 'note', note)], returning: [col('guarded', 'id')] })
  const guardedRows = async (id: number) => [...(await owner`select note, version from parity.guarded where id = ${id}`)]

  // A trigger's RAISE was `check-violation`, which claims a constraint the
  // form could have checked and names none. It is the database refusing by a
  // rule of its own, and the same request will be refused again.
  test("a trigger's own error is refused, on insert and on update, and nothing is written", covers('postgres', refusalCase('guardedInsert'), refusalCase('guardedUpdate')), async () => {
    expect(failed(await insertGuarded(owner, '1', 'refuse')).code).toBe(REFUSAL_PARITY.guardedInsert)
    expect(await guardedRows(1)).toEqual([])
    await owner`insert into parity.guarded (id, note) values (2, 'fine')`
    const update = await defined(createPostgresRecords(owner)).update({
      target: guarded(),
      key: [val('guarded', 'id', '2')],
      set: [val('guarded', 'note', 'refuse')],
      expectedVersion: '0',
      filters: EVERY_ROW, through: [],
      returning: [],
    })
    expect(failed(update).code).toBe(REFUSAL_PARITY.guardedUpdate)
    expect(await guardedRows(2)).toEqual([{ note: 'fine', version: 0 }])
  })

  // SQLSTATE 38000 has no meaning this adapter knows (C11). It was
  // `unavailable`, which invites the person to try again; it will be
  // refused again.
  test('an error the adapter does not recognise is refused, not unavailable', covers('postgres', refusalCase('oddInsert')), async () => {
    const outcome = failed(await insertGuarded(owner, '3', 'odd'))
    expect(outcome.code).toBe(REFUSAL_PARITY.oddInsert)
    // The SQLSTATE is named; the trigger's own message, which could quote a value, is not.
    expect(outcome.message).toMatch(/38000/)
    expect(outcome.message).not.toMatch(/odd note/)
    expect(await guardedRows(3)).toEqual([])
  })

  // INSERT 0 0 with no error: taken as success it was a save that never
  // happened; as `check-violation` it claimed a constraint.
  test('an insert a trigger declines without an error is refused, and nothing is written', covers('postgres', refusalCase('declinedInsert')), async () => {
    const outcome = await defined(createPostgresRecords(owner)).insert({
      target: { table: { schema: 'parity', name: 'declined' }, identity: [col('declined', 'id')], concurrency: null },
      values: [val('declined', 'id', '1'), val('declined', 'note', 'never written')],
      returning: [col('declined', 'id')],
    })
    expect(failed(outcome).code).toBe(REFUSAL_PARITY.declinedInsert)
    expect([...(await owner`select id from parity.declined`)]).toEqual([])
  })

  // 428C9: the column has become generated since the bindings were made,
  // which is drift, as SQL Server's 544 is.
  test('an insert naming a generated identity is schema-changed', covers('postgres', refusalCase('generatedInsert')), async () => {
    const outcome = await defined(createPostgresRecords(owner)).insert({
      target: { table: { schema: 'parity', name: 'generated' }, identity: [col('generated', 'id')], concurrency: null },
      values: [val('generated', 'id', '1'), val('generated', 'note', 'named the identity')],
      returning: [],
    })
    expect(failed(outcome).code).toBe(REFUSAL_PARITY.generatedInsert)
    expect([...(await owner`select id from parity.generated`)]).toEqual([])
  })

  // The one refusal that passes: a deadlock the server chose this statement
  // to lose (40P01, C10). The holder waits ten seconds before it looks for a
  // deadlock, the adapter's session the default one, so the adapter is the
  // victim every time; and the holder asks for row 1 only once the adapter's
  // update is seen blocked on row 2, never after a timer, which raced on SQL
  // Server.
  test('a deadlock victim is unavailable, and its row is unchanged', covers('postgres', refusalCase('deadlockVictim')), async () => {
    const holder = postgres(fixture.admin, { max: 1, onnotice: () => {}, connection: { deadlock_timeout: '10s' } })
    const CONTENDED = versioned('contended', ['id'])
    try {
      const held = await holder.begin(async (tx) => {
        await tx`select id from parity.contended where id = 2 for update`
        const pending = defined(createPostgresRecords(owner)).update({
          target: CONTENDED,
          key: [val('contended', 'id', '1')],
          set: [val('contended', 'note', 'the victim')],
          expectedVersion: '0',
          filters: EVERY_ROW, through: [],
          returning: [],
        })
        await waitUntilBlocked(1)
        await tx`select id from parity.contended where id = 1 for update`
        return { pending }
      })
      const outcome = failed(await held.pending)
      expect(outcome.code).toBe(REFUSAL_PARITY.deadlockVictim)
      expect(outcome.message).toMatch(/40P01/)
      expect([...(await owner`select note, version from parity.contended where id = 1`)]).toEqual([{ note: 'one', version: 0 }])
    } finally {
      await holder.end()
    }
  })

  // The rest of the allowlist that can be provoked here: a statement
  // timeout (57014, C11b), a lock timeout (55P03) and a read-only
  // transaction (25006). Each passes, or is the deployment's to change, and
  // none wrote anything. With `refused` as the default, an entry missing from
  // the allowlist would tell a person a timeout will be refused again.
  test('a statement timeout, a lock timeout and a read-only session are unavailable, and wrote nothing', async () => {
    const timed = postgres(fixture.admin, { max: 1, onnotice: () => {}, connection: { statement_timeout: 100 } })
    const impatient = postgres(fixture.admin, { max: 1, onnotice: () => {}, connection: { lock_timeout: 100 } })
    const readOnly = postgres(fixture.admin, { max: 1, onnotice: () => {}, connection: { default_transaction_read_only: true } })
    try {
      const slow = failed(await insertGuarded(timed, '4', 'slow'))
      expect([slow.code, slow.message]).toEqual(['unavailable', expect.stringMatching(/57014/)])
      expect(await guardedRows(4)).toEqual([])

      await owner`insert into parity.guarded (id, note) values (5, 'locked')`
      const held = await owner.begin(async (tx) => {
        await tx`select id from parity.guarded where id = 5 for update`
        const outcome = await defined(createPostgresRecords(impatient)).update({
          target: guarded(),
          key: [val('guarded', 'id', '5')],
          set: [val('guarded', 'note', 'waited')],
          expectedVersion: '0',
          filters: EVERY_ROW, through: [],
          returning: [],
        })
        return { outcome }
      })
      expect([failed(held.outcome).code, failed(held.outcome).message]).toEqual(['unavailable', expect.stringMatching(/55P03/)])
      expect(await guardedRows(5)).toEqual([{ note: 'locked', version: 0 }])

      const refused = failed(await insertGuarded(readOnly, '6', 'fine'))
      expect([refused.code, refused.message]).toEqual(['unavailable', expect.stringMatching(/25006/)])
      expect(await guardedRows(6)).toEqual([])
    } finally {
      await Promise.all([timed.end(), impatient.end(), readOnly.end()])
    }
  })

  // Class 57 reaches the adapter as a SQLSTATE only for a statement that was
  // cancelled or timed out (57014). A terminated backend, a shutdown and
  // PostgreSQL 17's transaction_timeout (25P04) are FATAL: the server closes
  // the connection, postgres.js reports CONNECTION_CLOSED, and a write is
  // `unknown-outcome`, as any connection lost after the write was sent — not
  // the `unavailable` their SQLSTATEs would map to, which would claim nothing
  // was written. Here nothing was, and the adapter cannot know that.
  test('a terminated backend and a transaction timeout close the connection, and a write is unknown-outcome', async () => {
    const victim = postgres(fixture.admin, { max: 1, onnotice: () => {} })
    const bounded = postgres(fixture.admin, { max: 1, onnotice: () => {}, connection: { transaction_timeout: '200' } })
    try {
      const [session] = await victim<{ pid: number }[]>`select pg_catalog.pg_backend_pid() as pid`
      const pid = session?.pid ?? 0
      const pending = insertGuarded(victim, '7', 'slow')
      await waitUntilSleeping(pid)
      await owner`select pg_catalog.pg_terminate_backend(${pid})`
      const terminated = failed(await pending)
      expect([terminated.code, terminated.message]).toEqual(['unknown-outcome', expect.stringMatching(/CONNECTION_CLOSED/)])

      const timedOut = failed(await insertGuarded(bounded, '8', 'slow'))
      expect([timedOut.code, timedOut.message]).toEqual(['unknown-outcome', expect.stringMatching(/CONNECTION_CLOSED/)])
      expect(await guardedRows(7)).toEqual([])
      expect(await guardedRows(8)).toEqual([])
    } finally {
      // Bounded: on postgres.js 3.4.9, ending a pool whose connection the server closed under it did not return.
      await Promise.all([victim.end({ timeout: 1 }), bounded.end({ timeout: 1 })])
    }
  })
})

/** Waits until backend `pid` is inside a trigger's pg_sleep, so it is terminated mid-write and not before. */
async function waitUntilSleeping(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const [row] = await owner<{ n: number }[]>`select count(*)::int as n from pg_stat_activity where pid = ${pid} and wait_event = 'PgSleep'`
    if ((row?.n ?? 0) > 0) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`backend ${String(pid)} never reached the trigger's sleep`)
}

/** Waits until `count` backends are blocked by another, so a deadlock is a deadlock and not a sequence. */
async function waitUntilBlocked(count: number): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const [row] = await owner<{ n: number }[]>`select count(*)::int as n from pg_stat_activity where cardinality(pg_blocking_pids(pid)) > 0`
    if ((row?.n ?? 0) >= count) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`${String(count)} statements never queued behind the lock`)
}
