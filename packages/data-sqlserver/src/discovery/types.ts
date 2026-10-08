import type { NormalizedType } from '@formancy/data-core'

/** What sys.columns and sys.types say about one column's type. */
export interface TypeFacts {
  /** sys.types.name for the column's user_type_id; `null` when the type is hidden from this account. */
  typeName: string | null
  typeSchema: string | null
  isUserDefined: boolean | null
  /**
   * The system type behind it, from sys.types for the column's system_type_id.
   * `null` for CLR types -- geography, geometry, hierarchyid -- whose
   * system_type_id 240 names no row in sys.types.
   */
  systemName: string | null
  /** In bytes, and -1 for max. */
  maxLength: number
  precision: number
  scale: number
}

export interface ColumnType {
  /** As the database spells it, for a person reading a report. */
  databaseType: string
  type: NormalizedType
  /** The column's declared type is a user-defined type this account cannot see. */
  hidden: boolean
}

const UNSUPPORTED: NormalizedType = { kind: 'unsupported' }

type Normalize = (facts: TypeFacts) => NormalizedType

const length = (bytes: number, bytesPerUnit: number): number | null => (bytes === -1 ? null : bytes / bytesPerUnit)
const integer = (min: string, max: string): Normalize => () => ({ kind: 'integer', min, max })
const decimal: Normalize = (facts) => ({ kind: 'decimal', precision: facts.precision, scale: facts.scale })
const timestamp = (withTimeZone: boolean): Normalize => (facts) => ({ kind: 'timestamp', withTimeZone, precision: facts.scale })
const text =
  (bytesPerUnit: number, fixedLength: boolean): Normalize =>
  (facts) => ({ kind: 'text', maxLength: length(facts.maxLength, bytesPerUnit), fixedLength })
const binary: Normalize = (facts) => ({ kind: 'binary', maxLength: length(facts.maxLength, 1) })

/**
 * The system types this adapter has a normalised meaning for. Anything else --
 * xml, sql_variant, the CLR types, the deprecated text/ntext/image, a type a
 * later server adds -- is `unsupported`: reported, never dropped (0004).
 *
 * The lengths are the catalog's BYTES turned into the unit the type counts:
 * nchar and nvarchar store UTF-16 code units, two bytes each, so
 * nvarchar(200) is 400 in sys.columns and 200 here. char and varchar count
 * bytes, which are characters on a single-byte code page and are not under a
 * UTF-8 collation; 0007 says what that costs.
 *
 * Temporal precision is the catalog's scale for every temporal type, which is
 * the number of fractional-second digits the server writes. For datetime that
 * is 3 though it keeps 1/300 s, and for smalldatetime 0 though it keeps whole
 * minutes; the contract has no way to say either, and 0007 records the choice.
 *
 * A Map rather than an object, so that a CLR type somebody named `toString`
 * finds nothing here rather than Object.prototype.toString.
 */
const BY_SYSTEM_TYPE: ReadonlyMap<string, Normalize> = new Map<string, Normalize>([
  ['bit', () => ({ kind: 'boolean' })],
  ['tinyint', integer('0', '255')],
  ['smallint', integer('-32768', '32767')],
  ['int', integer('-2147483648', '2147483647')],
  ['bigint', integer('-9223372036854775808', '9223372036854775807')],
  ['decimal', decimal],
  ['numeric', decimal],
  // The catalog's own precision and scale: 19,4 and 10,4. The contract's
  // decimal cannot say that money stops at 922,337,203,685,477.5807; a value
  // past it is refused by the server, loudly.
  ['money', decimal],
  ['smallmoney', decimal],
  // float(1..24) is catalogued as real and float(25..53) as float.
  ['float', () => ({ kind: 'float', bits: 64 })],
  ['real', () => ({ kind: 'float', bits: 32 })],
  ['date', () => ({ kind: 'date' })],
  ['time', (facts) => ({ kind: 'time', precision: facts.scale })],
  ['datetime2', timestamp(false)],
  ['datetimeoffset', timestamp(true)],
  ['datetime', timestamp(false)],
  ['smalldatetime', timestamp(false)],
  ['char', text(1, true)],
  ['varchar', text(1, false)],
  ['nchar', text(2, true)],
  ['nvarchar', text(2, false)],
  ['uniqueidentifier', () => ({ kind: 'uuid' })],
  ['binary', binary],
  ['varbinary', binary],
  // rowversion's catalog name is its deprecated synonym, timestamp. It is a
  // counter, never a clock.
  ['timestamp', () => ({ kind: 'rowversion' })],
])

/** The suffix a system type is declared with, from the catalog's numbers. */
function suffix(systemName: string, facts: TypeFacts): string {
  switch (systemName) {
    case 'char':
    case 'varchar':
    case 'binary':
    case 'varbinary':
      return `(${facts.maxLength === -1 ? 'max' : String(facts.maxLength)})`
    case 'nchar':
    case 'nvarchar':
      return `(${facts.maxLength === -1 ? 'max' : String(facts.maxLength / 2)})`
    case 'decimal':
    case 'numeric':
      return `(${String(facts.precision)},${String(facts.scale)})`
    case 'time':
    case 'datetime2':
    case 'datetimeoffset':
      return `(${String(facts.scale)})`
    default:
      return ''
  }
}

/**
 * How a person would recognise the declared type: `nvarchar(200)`, an alias
 * type by its qualified name, `sysname` as itself, and `rowversion` rather
 * than the catalog's `timestamp`, which reads as a clock and is not one.
 */
function spell(facts: TypeFacts, systemName: string | null): string {
  if (facts.typeName === null) return systemName === null ? 'unknown' : systemName + suffix(systemName, facts)
  if (facts.isUserDefined === true) return facts.typeSchema === null ? facts.typeName : `${facts.typeSchema}.${facts.typeName}`
  if (facts.typeName === 'timestamp') return 'rowversion'
  if (facts.typeName !== systemName) return facts.typeName
  return facts.typeName + suffix(facts.typeName, facts)
}

/**
 * A column's type, normalised from what this account can see of it.
 *
 * The system type comes from the column's system_type_id, which is visible
 * even when the declared user-defined type is not: a type is a securable of
 * its own, and an account may read a table without any permission on the type
 * of one of its columns. Normalising from the declared type would lose that
 * column's meaning; joining to it would lose the column.
 */
export function normalizeType(facts: TypeFacts): ColumnType {
  const systemName = facts.systemName ?? facts.typeName
  const normalize = systemName === null ? undefined : BY_SYSTEM_TYPE.get(systemName)
  return {
    databaseType: spell(facts, systemName),
    type: normalize === undefined ? UNSUPPORTED : normalize(facts),
    hidden: facts.typeName === null,
  }
}
