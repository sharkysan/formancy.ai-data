import type { NormalizedType, TextLengthUnit } from '@formancy/data-core'

/** A column's type as pg_attribute and pg_type state it. */
export interface CatalogType {
  /** `pg_type.typname`: `int4`, `varchar`, `bpchar`, never the SQL spelling. */
  name: string
  /** The namespace the type lives in. Only `pg_catalog`'s types are PostgreSQL's own. */
  schema: string
  /** `pg_attribute.atttypmod`, `-1` when nothing was declared. */
  modifier: number
}

const UNSUPPORTED: NormalizedType = { kind: 'unsupported' }

/**
 * PostgreSQL's `VARHDRSZ`. A length or a numeric's precision and scale are
 * stored in atttypmod with this four-byte header added, and a modifier below
 * it means none was declared.
 */
const HEADER = 4

function declaredLength(modifier: number): number | null {
  return modifier >= HEADER ? modifier - HEADER : null
}

/** time(p) and timestamp(p) store p itself; `-1` is "not declared", and 0 is a declared precision. */
function declaredPrecision(modifier: number): number | null {
  return modifier >= 0 ? modifier : null
}

/**
 * numeric(p, s), packed as `((p << 16) | s) + 4`.
 *
 * Since PostgreSQL 15 the scale may be negative -- numeric(2,-3) rounds to
 * thousands -- or larger than the precision, and is kept in the low eleven
 * bits as a two's complement. Read unsigned, -3 would be 2045. This is the
 * server's own decoding (numeric.c, `NUMERIC_TYPMOD_SCALE`), written in
 * TypeScript because the catalog has no column that holds the two numbers.
 */
function decimal(modifier: number): NormalizedType {
  if (modifier < HEADER) return { kind: 'decimal', precision: null, scale: null }
  const packed = modifier - HEADER
  return { kind: 'decimal', precision: (packed >> 16) & 0xffff, scale: ((packed & 0x7ff) ^ 1024) - 1024 }
}

/**
 * `bpchar`, blank-padded character. With a length it is char(n), padded to n.
 * Declared as bare `bpchar` it pads to nothing and still ignores trailing
 * blanks when compared -- neither a fixed-length text nor a variable one, so
 * it is not reported as either.
 */
function blankPadded(modifier: number, lengthUnit: TextLengthUnit): NormalizedType {
  const maxLength = declaredLength(modifier)
  return maxLength === null ? UNSUPPORTED : { kind: 'text', maxLength, lengthUnit, fixedLength: true }
}

/**
 * PostgreSQL's built-in types that have a normalised meaning, by `typname`.
 *
 * A map rather than a `switch`, so a type is one line and the absence of one
 * is the default. Anything not here is `unsupported`, a reported value
 * (0004). Notably absent:
 *
 * - `timetz`. The contract's `time` has no zone, and reporting a zoned time as
 *   `time` would drop the zone: the silent erasure of time semantics the plan
 *   forbids. It stays unsupported until `NormalizedType` can say it.
 * - `money` (formatted by `lc_monetary`), `interval`, `json`/`jsonb`, arrays,
 *   ranges, the geometric and network types: no codec has been written.
 */
const BUILT_IN = new Map<string, (modifier: number, textUnit: TextLengthUnit) => NormalizedType>([
  ['int2', () => ({ kind: 'integer', min: '-32768', max: '32767' })],
  ['int4', () => ({ kind: 'integer', min: '-2147483648', max: '2147483647' })],
  ['int8', () => ({ kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' })],
  ['numeric', decimal],
  // A length in atttypmod counts characters of the database encoding: in a
  // UTF8 database varchar(4) holds four emoji. The unit is the encoding's
  // (`textUnitOf`, 0026), and the codec counts in it.
  ['varchar', (modifier, lengthUnit) => ({ kind: 'text', maxLength: declaredLength(modifier), lengthUnit, fixedLength: false })],
  ['bpchar', blankPadded],
  ['text', (_modifier, lengthUnit) => ({ kind: 'text', maxLength: null, lengthUnit, fixedLength: false })],
  ['bool', () => ({ kind: 'boolean' })],
  ['date', () => ({ kind: 'date' })],
  ['time', (modifier) => ({ kind: 'time', precision: declaredPrecision(modifier) })],
  ['timestamp', (modifier) => ({ kind: 'timestamp', withTimeZone: false, precision: declaredPrecision(modifier) })],
  ['timestamptz', (modifier) => ({ kind: 'timestamp', withTimeZone: true, precision: declaredPrecision(modifier) })],
  ['uuid', () => ({ kind: 'uuid' })],
  // bytea is never padded: what is read is what was written (0026).
  ['bytea', () => ({ kind: 'binary', maxLength: null, fixedLength: false })],
  ['float4', () => ({ kind: 'float', bits: 32 })],
  ['float8', () => ({ kind: 'float', bits: 64 })],
])

/**
 * What a column of this type holds, in terms both engines can be compared on.
 *
 * Matched by name only within `pg_catalog`. Type names are unique within a
 * schema, so `pg_catalog.int4` is PostgreSQL's int4 and nothing else is: a
 * domain over numeric (which carries a CHECK its base type would drop), an
 * enum, or a composite somebody named `int4` in their own schema all live
 * elsewhere, and are unsupported. `textUnit` is what a text length counts in
 * this database, which its encoding decides.
 */
export function normalizeType(type: CatalogType, textUnit: TextLengthUnit): NormalizedType {
  if (type.schema !== 'pg_catalog') return UNSUPPORTED
  const normalize = BUILT_IN.get(type.name)
  return normalize === undefined ? UNSUPPORTED : normalize(type.modifier, textUnit)
}
