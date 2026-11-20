import type { NormalizedType } from '@formancy/data-core'
import { quoteTable } from './identifiers.js'

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
 *
 * An enum is the one type named from the snapshot rather than here (0170):
 * its schema and name, approved metadata, each quoted. Text has no cast to
 * an enum but through its input function, so a parameter must be cast to
 * the type itself -- left as text, an insert is refused with 42804 ("column
 * is of type … but expression is of type text") and a comparison with
 * 42883 -- and compared in it, an enum compares by its labels' order, as
 * it sorts, where its text would compare by the alphabet. A domain over
 * text or a whole number is cast to its base type, which the database
 * takes into the domain and holds to its checks; a domain over an enum is
 * cast to the enum. A qualified type name resolves only in a schema the
 * role may use (42501 otherwise), so discovery reads an enum in a schema
 * the account may not use as unsupported, and no value of it is bound
 * (`discovery/domains.ts`'s `LABELS`).
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
    case 'enum':
      return quoteTable(type.name)
    case 'binary':
    case 'rowversion':
    case 'unsupported':
      throw new Error(`A ${type.kind} value has no canonical text to bind from.`)
  }
}
