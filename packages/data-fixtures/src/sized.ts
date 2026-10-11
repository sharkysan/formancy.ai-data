import { createHash } from 'node:crypto'

/*
 * The sized `sales.customer` (0034): a million generated customers in the
 * order form's own lookup target, so a lookup that loaded the referenced
 * table, read past its tenant or asked for more than a page fails by a factor
 * of thousands rather than by a timing.
 *
 * Pure: the loaders (`sized-load.ts`) insert exactly these rows into both
 * engines, and every expectation -- a first page, a search's matches, the
 * keys a resolve asks for, the digest a result records -- is computed from
 * the same functions. One generator, so the two engines cannot be loaded
 * with different data and agree by accident.
 *
 * Names are built so that code-point order (PostgreSQL on musl) and
 * case-insensitive order (SQL Server's CI collation) agree on every name a
 * tenant-1 lookup compares: every word is ASCII letters in Title Case, and
 * the legal forms, the only words with a capital past their first letter,
 * each start with a different one. `sized.test.ts` holds that over the
 * tenant; both engines' integration suites hold it on the real servers.
 */

/** One customer as the read-back and the lookups see it: the key and the name. */
export interface SizedRow {
  tenantId: number
  customerNo: number
  name: string
}

/**
 * What is generated, as constants: how many rows, where each tenant's numbers
 * start, and the row-index-to-name bijection `c = (i × multiplier + offset)
 * mod rows`. 7919 is prime and does not divide 10^6, so every `c` is
 * different and so is every name; name order has nothing to do with key order.
 */
export const SIZED_CUSTOMERS = {
  /** Names the generator; a change to anything below is a new id. */
  id: 'sales.customer sized 1',
  rows: 1_000_000,
  multiplier: 7919,
  offset: 13,
  /** Rows 0 … 99,999 are tenant 1, the measured clerk's; the rest are tenant 2. Each numbered from 1,000,001. */
  tenants: [
    { tenantId: 1, rows: 100_000, firstCustomerNo: 1_000_001 },
    { tenantId: 2, rows: 900_000, firstCustomerNo: 1_000_001 },
  ],
  /** Every generated row's other columns. Country alternates by row index, CH on even rows. */
  creditLimit: null,
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
} as const

/** 100 stems × 50 trades × 40 cities × 5 forms = 10^6 names. */
const STEMS = [
  'Adler', 'Ahorn', 'Alpen', 'Amsel', 'Anker', 'Arve', 'Bach', 'Baer', 'Berg', 'Birke',
  'Blum', 'Brugg', 'Brunner', 'Buche', 'Burg', 'Dach', 'Delta', 'Distel', 'Dorf', 'Eber',
  'Eiche', 'Elch', 'Enzian', 'Erle', 'Esche', 'Falke', 'Feld', 'Fels', 'Fink', 'Fluss',
  'Fuchs', 'Garten', 'Gemse', 'Ginster', 'Glocke', 'Gold', 'Graf', 'Grund', 'Hafen', 'Hain',
  'Hase', 'Hecht', 'Heide', 'Hirsch', 'Hof', 'Horn', 'Hummel', 'Insel', 'Kiefer', 'Kirsch',
  'Klee', 'Kranich', 'Krone', 'Kugel', 'Lachs', 'Lerche', 'Lilie', 'Linde', 'Lotus', 'Luchs',
  'Marder', 'Matten', 'Meise', 'Mond', 'Moos', 'Mueller', 'Nord', 'Ost', 'Otter', 'Pappel',
  'Quelle', 'Rabe', 'Rhein', 'Ried', 'Rose', 'Salm', 'Sand', 'Schwan', 'Seeland', 'Silber',
  'Sonne', 'Specht', 'Stern', 'Storch', 'Strom', 'Sued', 'Tal', 'Tanne', 'Taube', 'Turm',
  'Ulme', 'Ufer', 'Viola', 'Wald', 'Weide', 'Wiesel', 'Wolf', 'Zeder', 'Zink', 'Zypresse',
] as const
const TRADES = [
  'Agrar', 'Bau', 'Beratung', 'Baeckerei', 'Chemie', 'Daten', 'Druck', 'Elektro', 'Energie', 'Export',
  'Finanz', 'Garage', 'Gartenbau', 'Gas', 'Glas', 'Handel', 'Holzbau', 'Immobilien', 'Import', 'Kaese',
  'Kaffee', 'Keramik', 'Kunststoff', 'Logistik', 'Malerei', 'Mechanik', 'Medien', 'Metallbau', 'Metzgerei', 'Moebel',
  'Optik', 'Papier', 'Pharma', 'Reisen', 'Robotik', 'Sanitaer', 'Schreinerei', 'Software', 'Solar', 'Spedition',
  'Technik', 'Textil', 'Tiefbau', 'Transport', 'Treuhand', 'Uhren', 'Verlag', 'Versicherung', 'Wasser', 'Wein',
] as const
const CITIES = [
  'Aarau', 'Baden', 'Basel', 'Bern', 'Biel', 'Brig', 'Buchs', 'Chur', 'Davos', 'Emmen',
  'Frauenfeld', 'Freiburg', 'Genf', 'Glarus', 'Horgen', 'Kloten', 'Kriens', 'Lausanne', 'Liestal', 'Locarno',
  'Lugano', 'Luzern', 'Martigny', 'Montreux', 'Murten', 'Olten', 'Rapperswil', 'Sarnen', 'Schwyz', 'Sion',
  'Solothurn', 'Stans', 'Sursee', 'Thun', 'Uster', 'Uznach', 'Visp', 'Wil', 'Winterthur', 'Zug',
] as const
/** Each starts with its own capital, so two forms never first differ in a letter's case. */
const FORMS = ['AG', 'EG', 'GmbH', 'KG', 'SA'] as const

/**
 * The fixture's own two customers, as `fixtures/*.sql` inserts them. Stated
 * again here because the sized table is those rows and the generated ones;
 * if the two ever disagree, the read-back fails naming the key.
 */
export const FIXTURE_CUSTOMERS: readonly SizedRow[] = [
  { tenantId: 1, customerNo: 1001, name: 'Muster AG' },
  { tenantId: 2, customerNo: 1001, name: 'Other Tenant GmbH' },
]

/**
 * The name the bijection gives row index `i`: `c` written in the mixed radix
 * of the four lists' lengths, one word per digit, stem first. The lists
 * multiply to 10^6, so every `c` below it has its own four words.
 */
function nameOf(i: number): string {
  let c = (i * SIZED_CUSTOMERS.multiplier + SIZED_CUSTOMERS.offset) % SIZED_CUSTOMERS.rows
  const words: string[] = []
  for (const list of [STEMS, TRADES, CITIES, FORMS] as const) {
    words.push(list[c % list.length] as string)
    c = Math.floor(c / list.length)
  }
  return words.join(' ')
}

/** Generated row `i`, 0 to 999,999, in key order: tenant 1's 100,000 first. */
export function sizedCustomer(i: number): SizedRow {
  if (!Number.isInteger(i) || i < 0 || i >= SIZED_CUSTOMERS.rows) throw new Error(`a sized row index is 0 to ${String(SIZED_CUSTOMERS.rows - 1)}, not ${String(i)}`)
  let start = 0
  for (const tenant of SIZED_CUSTOMERS.tenants) {
    if (i < start + tenant.rows) return { tenantId: tenant.tenantId, customerNo: tenant.firstCustomerNo + (i - start), name: nameOf(i) }
    start += tenant.rows
  }
  /* c8 ignore next -- the tenants' rows add up to SIZED_CUSTOMERS.rows, which the range check above holds i under */
  throw new Error(`row ${String(i)} is in no tenant`)
}

/** Generated row `i`'s country code: CH on even rows, DE on odd. */
export function sizedCountry(i: number): 'CH' | 'DE' {
  return i % 2 === 0 ? 'CH' : 'DE'
}

/** The generated rows `from` (inclusive) to `to` (exclusive), in key order. */
export function* sizedCustomerRows(from = 0, to: number = SIZED_CUSTOMERS.rows): Generator<SizedRow> {
  for (let i = from; i < to; i += 1) yield sizedCustomer(i)
}

const before = (a: SizedRow, b: SizedRow): boolean => a.tenantId < b.tenantId || (a.tenantId === b.tenantId && a.customerNo < b.customerNo)

/** The whole sized table, generated rows and `FIXTURE_CUSTOMERS` merged, in key order: what the read-back expects. */
export function* sizedTableRows(): Generator<SizedRow> {
  // FIXTURE_CUSTOMERS is written in key order; sized.test.ts holds it.
  const fixture = FIXTURE_CUSTOMERS
  let next = 0
  for (const row of sizedCustomerRows()) {
    while (next < fixture.length && before(fixture[next] as SizedRow, row)) yield fixture[next++] as SizedRow
    yield row
  }
  while (next < fixture.length) yield fixture[next++] as SizedRow
}

/**
 * The searches the suites and the measurement type: `common` fills a page in
 * tenant 1 and has more, `unique` is one full name found once in the whole
 * table, `absent` is in no name. `sized.test.ts` holds each to that.
 */
export function sizedTerms(): { common: string; unique: string; absent: string } {
  return { common: 'bau', unique: sizedCustomer(50_000).name, absent: 'zzq' }
}

/**
 * The lookup page both engines must answer for `tenant`'s rows: names that
 * contain `search` case-insensitively, ordered by the lower-cased name in
 * code-point order, the first `limit`; `hasMore` when more matched, and how
 * many did. The adapters end their order with the key; names are unique
 * case-insensitively (sized.test.ts), so the key never decides here.
 */
export function sizedLookupPage(tenant: number, search: string, limit: number): { rows: SizedRow[]; hasMore: boolean; matched: number } {
  const needle = search.toLowerCase()
  const matches: Array<{ row: SizedRow; folded: string }> = []
  for (const row of sizedTableRows()) {
    if (row.tenantId !== tenant) continue
    const folded = row.name.toLowerCase()
    if (folded.includes(needle)) matches.push({ row, folded })
  }
  matches.sort((a, b) => (a.folded < b.folded ? -1 : 1))
  return { rows: matches.slice(0, limit).map((match) => match.row), hasMore: matches.length > limit, matched: matches.length }
}

/**
 * The rows a lookup on the sized table reads, as both adapters' sized suites
 * expect them and the measurement's page prints them: one source, so an
 * expectation changed in a suite changes the page with it. A tenant-filtered
 * search or first page reads every row of tenant 1, the measured clerk's; one
 * on a form with no tenant filter reads the table; a resolve or a membership
 * check reads at most one row per key. The counts come from the generator,
 * and `sized.test.ts` counts them again over the rows themselves.
 */
export function sizedRowsRead(): { tenant: number; table: number; perKey: number } {
  const generated = SIZED_CUSTOMERS.tenants.find((tenant) => tenant.tenantId === 1)?.rows ?? 0
  return { tenant: generated + FIXTURE_CUSTOMERS.filter((row) => row.tenantId === 1).length, table: SIZED_CUSTOMERS.rows + FIXTURE_CUSTOMERS.length, perKey: 1 }
}

/** `n` tenant-1 keys spread over its range, `customer_no` 1,000,001 + 1,000·j; 1 to 100, a resolve request's most. */
export function sizedResolveKeys(n: number): Array<{ tenantId: number; customerNo: number }> {
  if (!Number.isInteger(n) || n < 1 || n > 100) throw new Error(`sizedResolveKeys takes 1 to 100 keys, not ${String(n)}`)
  return Array.from({ length: n }, (_, j) => ({ tenantId: 1, customerNo: 1_000_001 + 1000 * j }))
}

/** `sizedDigest` a row at a time, for a read-back that should not hold a million rows to hash them. */
export function sizedDigester(): { add(row: SizedRow): void; digest(): string } {
  const hash = createHash('sha256')
  return {
    add: (row) => hash.update(`${String(row.tenantId)}\t${String(row.customerNo)}\t${row.name}\n`),
    digest: () => hash.digest('hex'),
  }
}

/** A SHA-256 of rows as `tenant TAB number TAB name LF`, in the order given: what a result records of the table it measured. */
export function sizedDigest(rows: Iterable<SizedRow>): string {
  const digester = sizedDigester()
  for (const row of rows) digester.add(row)
  return digester.digest()
}

/**
 * Generated rows `from` to `to` as one JSON document, `[{t, n, m, c}, …]`:
 * tenant, number, name and country. Both loaders insert from it, PostgreSQL
 * through `jsonb_to_recordset` and SQL Server through `openjson`, so the
 * engines are fed one text from one generator.
 */
export function sizedChunk(from: number, to: number): string {
  const rows: Array<{ t: number; n: number; m: string; c: string }> = []
  for (let i = from; i < to; i += 1) {
    const row = sizedCustomer(i)
    rows.push({ t: row.tenantId, n: row.customerNo, m: row.name, c: sizedCountry(i) })
  }
  return JSON.stringify(rows)
}

/** What a read-back found: the rows, per tenant, and their digest. */
export interface SizedReadBack {
  rows: number
  perTenant: Record<number, number>
  digest: string
}

/**
 * Rows read back from a database, compared one by one, in key order, with
 * `sizedTableRows`: `take` throws at the first difference, naming its key,
 * and `finish` throws if rows the generator expects never came. A count, or
 * a digest compared at the end, could not say which row was wrong.
 */
export function sizedReadBack(): { take(row: SizedRow): void; finish(): SizedReadBack } {
  const expected = sizedTableRows()
  const digester = sizedDigester()
  const perTenant: Record<number, number> = {}
  let rows = 0
  const keyOf = (row: SizedRow): string => `(${String(row.tenantId)}, ${String(row.customerNo)})`
  return {
    take(row) {
      const next = expected.next()
      if (next.done === true) throw new Error(`sales.customer holds ${keyOf(row)} after the last row the generator expects`)
      const want = next.value
      if (row.tenantId !== want.tenantId || row.customerNo !== want.customerNo) throw new Error(`sales.customer holds ${keyOf(row)} where the generator expects ${keyOf(want)}`)
      if (row.name !== want.name) throw new Error(`sales.customer ${keyOf(row)} is named ${JSON.stringify(row.name)}, the generator expects ${JSON.stringify(want.name)}`)
      digester.add(row)
      perTenant[row.tenantId] = (perTenant[row.tenantId] ?? 0) + 1
      rows += 1
    },
    finish() {
      const next = expected.next()
      if (next.done !== true) throw new Error(`sales.customer ends before ${keyOf(next.value)}, which the generator expects`)
      return { rows, perTenant, digest: digester.digest() }
    },
  }
}
