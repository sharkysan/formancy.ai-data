import type { NormalizedType } from '@formancy/data-core'

/** PostgreSQL's integer types, by the range discovery reports for them (`discovery/types.ts`). */
const INTEGERS = new Map<string, string>([
  ['-32768..32767', 'pg_catalog.int2'],
  ['-2147483648..2147483647', 'pg_catalog.int4'],
  ['-9223372036854775808..9223372036854775807', 'pg_catalog.int8'],
])

/**
 * The PostgreSQL type a value of this kind is converted to from text, named
 * exactly: an integer key compared as `numeric` would compare correctly and
 * never use the index on it, and `char(n)` compared as `text` ignores the
 * index too. Named in pg_catalog, by the catalog's own names, so no type on
 * the search path can stand in for it (`catalog.ts`).
 *
 * Each name is a constant here; nothing from a request is spliced. A kind
 * with no conversion from canonical text — binary, a rowversion, anything
 * unsupported — or an integer range no PostgreSQL type has is a programming
 * error: discovery on this engine never reports one.
 */
export function sqlTypeOf(type: NormalizedType): string {
  switch (type.kind) {
    case 'text':
      // Blank-padded comparison semantics, and the index on a char(n) column.
      return type.fixedLength ? 'pg_catalog.bpchar' : 'pg_catalog.text'
    case 'integer': {
      const name = INTEGERS.get(`${type.min}..${type.max}`)
      if (name === undefined) throw new Error(`No PostgreSQL integer type holds ${type.min} to ${type.max}.`)
      return name
    }
    case 'decimal':
      return 'pg_catalog.numeric'
    case 'boolean':
      return 'pg_catalog.bool'
    case 'float':
      return type.bits === 32 ? 'pg_catalog.float4' : 'pg_catalog.float8'
    case 'date':
      return 'pg_catalog.date'
    case 'time':
      return 'pg_catalog.time'
    case 'timestamp':
      return type.withTimeZone ? 'pg_catalog.timestamptz' : 'pg_catalog.timestamp'
    case 'uuid':
      return 'pg_catalog.uuid'
    case 'binary':
    case 'rowversion':
    case 'unsupported':
      throw new Error(`A ${type.kind} value has no canonical text to bind from.`)
  }
}
