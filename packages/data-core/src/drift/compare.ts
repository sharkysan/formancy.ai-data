import type { ColumnMeta, NormalizedType } from '../metadata.js'

/**
 * How one column type relates to another, by the values it accepts.
 *
 * `tightened`: some value accepted before is refused now. `loosened`: every
 * value accepted before still is, and more are. `changed`: not more or less of
 * the same thing at all. A type that moved both ways — wider below, narrower
 * above — is `tightened`, because a value the form accepts can now be refused.
 */
export type TypeVerdict = 'same' | 'changed' | 'tightened' | 'loosened'

/** Whether `after` holds less, the same, or more than `before`, for one bound. */
type Direction = -1 | 0 | 1

/** A declared limit; `null` is none, which holds more than any limit. */
function limit(before: number | null, after: number | null): Direction {
  const was = before ?? Number.POSITIVE_INFINITY
  const now = after ?? Number.POSITIVE_INFINITY
  return now < was ? -1 : now > was ? 1 : 0
}

/** Integer bounds as `BigInt`: a 64-bit bound is not a JavaScript number, and rounding one would call two ranges equal. */
function range(before: { min: string; max: string }, after: { min: string; max: string }): Direction[] {
  const wasMin = BigInt(before.min)
  const nowMin = BigInt(after.min)
  const wasMax = BigInt(before.max)
  const nowMax = BigInt(after.max)
  const lower: Direction = nowMin < wasMin ? 1 : nowMin > wasMin ? -1 : 0
  const upper: Direction = nowMax > wasMax ? 1 : nowMax < wasMax ? -1 : 0
  return [lower, upper]
}

/** Whole and fractional digits, which is what a decimal's precision and scale bound. A `null` scale is zero, as the generator reads it. */
function digits(type: { precision: number | null; scale: number | null }): [number | null, number | null] {
  if (type.precision === null) return [null, null]
  const scale = type.scale ?? 0
  return [type.precision - scale, scale]
}

function verdict(directions: readonly Direction[]): TypeVerdict {
  if (directions.includes(-1)) return 'tightened'
  return directions.includes(1) ? 'loosened' : 'same'
}

export function compareTypes(before: NormalizedType, after: NormalizedType): TypeVerdict {
  if (before.kind === 'text' && after.kind === 'text') {
    // char pads with spaces and varchar does not: not a wider or narrower text.
    // Nor is a length in another unit (0026) — 20 bytes of UTF-8 against 20
    // characters of code page 1252 is neither more nor less.
    return before.fixedLength === after.fixedLength && before.lengthUnit === after.lengthUnit
      ? verdict([limit(before.maxLength, after.maxLength)])
      : 'changed'
  }
  if (before.kind === 'integer' && after.kind === 'integer') return verdict(range(before, after))
  if (before.kind === 'decimal' && after.kind === 'decimal') {
    const [wasWhole, wasFraction] = digits(before)
    const [nowWhole, nowFraction] = digits(after)
    return verdict([limit(wasWhole, nowWhole), limit(wasFraction, nowFraction)])
  }
  if (before.kind === 'float' && after.kind === 'float') return verdict([limit(before.bits, after.bits)])
  if (before.kind === 'time' && after.kind === 'time') return verdict([limit(before.precision, after.precision)])
  if (before.kind === 'timestamp' && after.kind === 'timestamp') {
    // An instant and a wall clock are different values, not more or less precise ones.
    return before.withTimeZone === after.withTimeZone ? verdict([limit(before.precision, after.precision)]) : 'changed'
  }
  if (before.kind === 'binary' && after.kind === 'binary') {
    // binary(n) pads with zero bytes and varbinary(n) does not: what is read back differs.
    return before.fixedLength === after.fixedLength ? verdict([limit(before.maxLength, after.maxLength)]) : 'changed'
  }
  return before.kind === after.kind ? 'same' : 'changed'
}

export type ColumnChangeKind = 'column-type-changed' | 'column-generation-changed' | 'column-tightened' | 'column-loosened' | 'column-default-changed'

/** Most serious first. A column whose type changed and that became nullable is a changed type that also accepts null. */
const SERIOUSNESS: readonly ColumnChangeKind[] = ['column-type-changed', 'column-generation-changed', 'column-tightened', 'column-loosened', 'column-default-changed']

/** Why a type is a different one. A text whose unit moved under one spelling — a collation change — says so, rather than "from varchar(20) to varchar(20)". */
function typeChange(before: ColumnMeta, after: ColumnMeta): string {
  if (before.type.kind === 'text' && after.type.kind === 'text' && before.type.lengthUnit !== after.type.lengthUnit && before.databaseType === after.databaseType) {
    return `its length now counts ${after.type.lengthUnit} where it counted ${before.type.lengthUnit}, though the database still spells it ${after.databaseType}`
  }
  return `its type changed from ${before.databaseType} to ${after.databaseType}`
}

/** Why the way the database generates a column is different, named both ways. */
function generationChange(before: ColumnMeta, after: ColumnMeta): string {
  if (after.generated === 'none') return `the database no longer generates it (it was ${before.generated})`
  if (before.generated === 'none') return `the database now generates it (${after.generated})`
  return `the database generates it as ${after.generated} where it was ${before.generated}`
}

/**
 * What changed about one column, as one change named by its most serious
 * difference, with every difference as a reason. `null` when nothing a form
 * binds changed: comments and catalog positions are not compared.
 */
export function classify(before: ColumnMeta, after: ColumnMeta): { kind: ColumnChangeKind; reasons: string[] } | null {
  const found: Array<{ kind: ColumnChangeKind; reason: string }> = []

  const type = compareTypes(before.type, after.type)
  if (type === 'changed') found.push({ kind: 'column-type-changed', reason: typeChange(before, after) })
  if (type === 'tightened') found.push({ kind: 'column-tightened', reason: `it narrowed from ${before.databaseType} to ${after.databaseType}` })
  if (type === 'loosened') found.push({ kind: 'column-loosened', reason: `it widened from ${before.databaseType} to ${after.databaseType}` })
  if (type === 'same' && before.databaseType !== after.databaseType) {
    // nvarchar to varchar: every normalised property kept, every character outside the code page lost.
    found.push({
      kind: 'column-type-changed',
      reason: `the database spells its type ${after.databaseType} where it said ${before.databaseType}, a difference the normalised type does not capture`,
    })
  }

  if (before.generated !== after.generated) found.push({ kind: 'column-generation-changed', reason: generationChange(before, after) })

  if (before.nullable !== after.nullable) {
    found.push(after.nullable ? { kind: 'column-loosened', reason: 'it now accepts null' } : { kind: 'column-tightened', reason: 'it no longer accepts null' })
  }

  if (before.hasDefault && !after.hasDefault) {
    // A default is how a create may leave a NOT NULL column out. For a column
    // that may be null, or that the database generates, losing it only changes
    // what an omitted value becomes.
    found.push(
      !after.nullable && after.generated === 'none'
        ? { kind: 'column-tightened', reason: 'it lost its default, so a create must give it a value' }
        : { kind: 'column-default-changed', reason: 'it lost its default' },
    )
  } else if (!before.hasDefault && after.hasDefault) {
    found.push({ kind: 'column-loosened', reason: 'it gained a default' })
  } else if (before.defaultExpression !== after.defaultExpression) {
    found.push({ kind: 'column-default-changed', reason: 'its default changed' })
  }

  if (found.length === 0) return null
  const named = found.reduce((best, entry) => (SERIOUSNESS.indexOf(entry.kind) < SERIOUSNESS.indexOf(best.kind) ? entry : best))
  return { kind: named.kind, reasons: found.map((entry) => entry.reason) }
}

/**
 * Whether two columns are defined alike: the evidence for a possible rename,
 * which is offered to a person and never acted on. The names are not
 * compared, so a rename is never inferred from them.
 */
export function sameDefinition(left: ColumnMeta, right: ColumnMeta): boolean {
  return (
    left.databaseType === right.databaseType &&
    compareTypes(left.type, right.type) === 'same' &&
    left.nullable === right.nullable &&
    left.hasDefault === right.hasDefault &&
    left.generated === right.generated
  )
}
