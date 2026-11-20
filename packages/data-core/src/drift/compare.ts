import { quotedValues } from '../generate/quoted.js'
import type { ColumnMeta, DomainMeta, NormalizedType } from '../metadata.js'

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

type EnumType = Extract<NormalizedType, { kind: 'enum' }>

/** The labels one enum has and the other does not: `gone`, those `before` had, and `added`, those `after` has (0170). */
export function labelChanges(before: EnumType, after: EnumType): { gone: string[]; added: string[] } {
  return { gone: before.labels.filter((label) => !after.labels.includes(label)), added: after.labels.filter((label) => !before.labels.includes(label)) }
}

/**
 * An enum against an enum (0170): another type is another type, cast to
 * another name; of the same type, a label gone -- RENAME VALUE takes the
 * old one away -- is one the database now refuses, and a label added is one
 * more value. Moved both ways, it is tightened, as a type is. The labels'
 * order is not a value accepted or refused, so labels moved about alone
 * are the same type: PostgreSQL moves none of a type's labels, and ADD
 * VALUE … BEFORE adds one.
 */
function enumVerdict(before: EnumType, after: EnumType): TypeVerdict {
  if (before.name.schema !== after.name.schema || before.name.name !== after.name.name) return 'changed'
  const { gone, added } = labelChanges(before, after)
  return verdict([gone.length > 0 ? -1 : 0, added.length > 0 ? 1 : 0])
}

export function compareTypes(before: NormalizedType, after: NormalizedType): TypeVerdict {
  if (before.kind === 'text' && after.kind === 'text') {
    // char pads with spaces and varchar does not: not a wider or narrower text.
    // Nor is a length in another unit (0026) — 20 bytes of UTF-8 against 20
    // characters of code page 1252 is neither more nor less.
    return before.fixedLength === after.fixedLength && before.lengthUnit === after.lengthUnit ? verdict([limit(before.maxLength, after.maxLength)]) : 'changed'
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
  if (before.kind === 'enum' && after.kind === 'enum') return enumVerdict(before, after)
  if (before.kind === 'binary' && after.kind === 'binary') {
    // binary(n) pads with zero bytes and varbinary(n) does not: what is read back differs.
    return before.fixedLength === after.fixedLength ? verdict([limit(before.maxLength, after.maxLength)]) : 'changed'
  }
  return before.kind === after.kind ? 'same' : 'changed'
}

export type ColumnChangeKind = 'column-type-changed' | 'column-generation-changed' | 'column-tightened' | 'column-loosened' | 'column-default-changed'

/** Most serious first. A column whose type changed and that became nullable is a changed type that also accepts null. */
const SERIOUSNESS: readonly ColumnChangeKind[] = [
  'column-type-changed',
  'column-generation-changed',
  'column-tightened',
  'column-loosened',
  'column-default-changed',
]

/**
 * Why a type is a different one. A text whose unit moved under one spelling
 * — a collation change — says so, rather than "from varchar(20) to
 * varchar(20)"; so does a type this release reads where the snapshot
 * before called it unsupported under the same spelling, as one taken
 * before 0170 calls every enum and every domain, and one read before and
 * unsupported now, as an enum is for an account that may no longer name it.
 */
function typeChange(before: ColumnMeta, after: ColumnMeta): string {
  if (before.type.kind === 'unsupported' && after.type.kind !== 'unsupported' && before.databaseType === after.databaseType) {
    return `its type, ${after.databaseType}, was unsupported and is now read as ${after.type.kind}`
  }
  // An enum whose schema the account may no longer use is unsupported for it (0170).
  if (before.type.kind !== 'unsupported' && after.type.kind === 'unsupported' && before.databaseType === after.databaseType) {
    return `its type, ${after.databaseType}, was read as ${before.type.kind} and is now unsupported`
  }
  if (
    before.type.kind === 'text' &&
    after.type.kind === 'text' &&
    before.type.lengthUnit !== after.type.lengthUnit &&
    before.databaseType === after.databaseType
  ) {
    return `its length now counts ${after.type.lengthUnit} where it counted ${before.type.lengthUnit}, though the database still spells it ${after.databaseType}`
  }
  return `its type changed from ${before.databaseType} to ${after.databaseType}`
}

/**
 * Whether the database spells two columns' types as one, or differently by
 * nothing the type is (0170). PostgreSQL's `format_type` leaves a type's
 * schema out exactly when the session's search_path makes it visible, so a
 * discovery under another path respells an enum's or a domain's column
 * while it is the type it was: an enum's name is in its normalised type,
 * which `compareTypes` compares, and a domain's names are its chain,
 * outermost first. A column whose chain is another -- a domain retyped to
 * another domain, or to none -- is told apart by its spelling, as before.
 */
function spelledAlike(before: ColumnMeta, after: ColumnMeta): boolean {
  if (before.databaseType === after.databaseType) return true
  const was = before.domains ?? []
  const is = after.domains ?? []
  if (was.length > 0 || is.length > 0) {
    const same = (domain: DomainMeta, index: number) => is[index]?.ref.schema === domain.ref.schema && is[index]?.ref.name === domain.ref.name
    return was.length === is.length && was.every(same)
  }
  return before.type.kind === 'enum' && after.type.kind === 'enum'
}

/**
 * Why a column's type is not the one it was, in any direction, or `null` when
 * the normalised type and the database's spelling of it are both unchanged.
 * For a column read by its published type, where wider is as different as
 * narrower; an enum's, whose spelling is its name, said by its labels.
 */
export function typeDifference(before: ColumnMeta, after: ColumnMeta): string | null {
  const verdict = compareTypes(before.type, after.type)
  if (verdict === 'same' && spelledAlike(before, after)) return null
  if (verdict === 'changed') return typeChange(before, after)
  if (verdict !== 'same' && before.type.kind === 'enum' && after.type.kind === 'enum') return narrowing(before, after)
  return `its type changed from ${before.databaseType} to ${after.databaseType}`
}

/**
 * How a type of the same kind moved: from one spelling to another, or, for
 * an enum, whose spelling stays its name, by the labels it lost and gained
 * (0170).
 */
function narrowing(before: ColumnMeta, after: ColumnMeta): string {
  if (before.type.kind === 'enum' && after.type.kind === 'enum') {
    const { gone, added } = labelChanges(before.type, after.type)
    const lost = gone.length === 0 ? [] : [`no longer has ${quotedValues(gone)}`]
    const gained = added.length === 0 ? [] : [`now has ${quotedValues(added)}${gone.length === 0 ? ' too' : ''}`]
    return `its type, ${after.databaseType}, ${[...lost, ...gained].join(' and ')}`
  }
  const moved = compareTypes(before.type, after.type) === 'tightened' ? 'narrowed' : 'widened'
  return `it ${moved} from ${before.databaseType} to ${after.databaseType}`
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
  if (type === 'tightened') found.push({ kind: 'column-tightened', reason: narrowing(before, after) })
  if (type === 'loosened') found.push({ kind: 'column-loosened', reason: narrowing(before, after) })
  if (type === 'same' && !spelledAlike(before, after)) {
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
