import type { ColumnAccess, DatabaseKind, MetadataSnapshot, RowSecurity } from '@formancy/data-core'
import { findObject, gapCovers } from '@formancy/data-core'
import { FIXTURE_MODEL } from './model.js'

/** Which columns of an object an account may do one thing with: all, none, or these. */
export type ExpectedCapability = 'all' | 'none' | readonly string[]

export interface ExpectedObjectFacts {
  select?: ExpectedCapability
  insert?: ExpectedCapability
  update?: ExpectedCapability
  /** Defaults to `none`. Per engine where the engines differ. */
  rowSecurity?: RowSecurity | Partial<Record<DatabaseKind, RowSecurity>>
}

export interface ExpectedObjectAccess extends ExpectedObjectFacts {
  /** Where the grants differ by engine, merged over the facts above. */
  byKind?: Partial<Record<DatabaseKind, ExpectedObjectFacts>>
}

/**
 * What one restricted account of the fixture may do, by object name in
 * `sales` (0027). An object left out may do nothing, with no row security:
 * the files grant what is listed and nothing else.
 */
export type ExpectedAccess = Readonly<Record<string, ExpectedObjectAccess>>

/** `formancy_reader`: sales.order and nothing else. PostgreSQL's row_security_active answers for customer though the reader may not read it (B1); SQL Server shows the reader no customer at all. */
export const READER_ACCESS: ExpectedAccess = {
  order: { select: 'all' },
  customer: { rowSecurity: { postgres: 'applies' } },
}

/**
 * `formancy_writer`, through the role `formancy_forms`: the order form's
 * account. It reads and inserts orders, updates four of their columns — and
 * on PostgreSQL the application-maintained row_version, which SQL Server
 * writes itself — and reads three columns of customer, whose policy shows it
 * tenant 1 only.
 */
export const WRITER_ACCESS: ExpectedAccess = {
  order: {
    select: 'all',
    insert: 'all',
    update: ['status', 'notes', 'group', 'approved_by'],
    byKind: { postgres: { update: ['status', 'notes', 'group', 'approved_by', 'row_version'] } },
  },
  customer: { select: ['tenant_id', 'customer_no', 'name'], rowSecurity: 'applies' },
}

const CAPABILITIES: ReadonlyArray<keyof ColumnAccess> = ['select', 'insert', 'update']

function grants(capability: ExpectedCapability | undefined, column: string): boolean {
  return capability === 'all' || (Array.isArray(capability) && capability.includes(column))
}

function resolve(entry: ExpectedObjectAccess | undefined, kind: DatabaseKind): Required<Omit<ExpectedObjectFacts, 'rowSecurity'>> & { rowSecurity: RowSecurity } {
  const facts = { ...entry, ...entry?.byKind?.[kind] }
  const rowSecurity = facts.rowSecurity ?? 'none'
  return {
    select: facts.select ?? 'none',
    insert: facts.insert ?? 'none',
    update: facts.update ?? 'none',
    rowSecurity: typeof rowSecurity === 'string' ? rowSecurity : (rowSecurity[kind] ?? 'none'),
  }
}

/**
 * How a restricted account's snapshot differs from what the fixture grants
 * it, as sentences — the companion of `snapshotDisagreements`, which holds
 * the owner to the model's structure.
 *
 * Three rules, for every object of the model:
 * 1. one the account may use is described, with every column the model has
 *    and exactly the capabilities granted;
 * 2. one it may not use is described, every column with none, or is absent behind an
 *    `objects` gap on its schema or the scope — never absent with nothing said;
 * 3. its row security is the expected one, or `unknown` with a `row-security`
 *    gap covering it.
 */
export function accessDisagreements(snapshot: MetadataSnapshot, expected: ExpectedAccess): string[] {
  const out: string[] = []
  for (const model of FIXTURE_MODEL) {
    const where = `${model.ref.schema}.${model.ref.name}`
    const facts = resolve(expected[model.ref.name], snapshot.kind)
    for (const capability of CAPABILITIES) {
      const listed = facts[capability]
      if (Array.isArray(listed)) {
        for (const name of listed) if (!model.columns.some((column) => column.name === name)) out.push(`the expectation for ${where} names ${name}, which the model does not have`)
      }
    }
    const usable = CAPABILITIES.some((capability) => facts[capability] !== 'none')
    const actual = findObject(snapshot, model.ref)
    if (actual === undefined) {
      if (usable) out.push(`${where} is missing, though the account may use it`)
      else if (!snapshot.gaps.some((gap) => gap.aspect === 'objects' && gap.subject.kind !== 'object' && gapCovers(gap, model.ref))) {
        out.push(`${where} is missing and no objects gap says why`)
      }
      continue
    }
    // Every column, as the model has them: an adapter reading a
    // privilege-filtered catalog leaves out what its account may not read,
    // and the columns it does describe then agree with the grants.
    const names = actual.columns.map((column) => column.name)
    const wanted = model.columns.map((column) => column.name)
    if (names.join() !== wanted.join()) out.push(`${where} columns are [${names.join(', ')}], expected [${wanted.join(', ')}]`)
    for (const column of actual.columns) {
      for (const capability of CAPABILITIES) {
        const wanted = grants(facts[capability], column.name)
        if (column.access[capability] !== wanted) out.push(`${where}.${column.name} ${capability} is ${String(column.access[capability])}, expected ${String(wanted)}`)
      }
    }
    if (actual.rowSecurity !== facts.rowSecurity) {
      if (actual.rowSecurity !== 'unknown') out.push(`${where} row security is ${actual.rowSecurity}, expected ${facts.rowSecurity}`)
      else if (!snapshot.gaps.some((gap) => gap.aspect === 'row-security' && gapCovers(gap, model.ref))) out.push(`${where} row security is unknown and no row-security gap says why`)
    }
  }
  return out
}
