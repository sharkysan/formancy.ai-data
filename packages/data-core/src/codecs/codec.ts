import type { ColumnMeta } from '../metadata.js'
import { parseDecimal, parseInteger } from './numbers.js'
import { isDate, isInstant, isTime } from './temporal.js'

/** A value as the API carries it: JSON, with exact numbers as strings. */
export type ApiValue = string | number | boolean | null

export type CodecOutcome = { ok: true; value: ApiValue } | { ok: false; code: string; message: string }

/**
 * How one column's values are checked on their way to the database.
 *
 * `parse` validates and canonicalises a value arriving from the API. It works
 * from the column's metadata alone, never from a driver, so both adapters
 * receive the same canonical value and differ only in how they bind it.
 */
export interface Codec {
  status: 'editable' | 'read-only' | 'unsupported'
  /** Why a column is not editable; `null` when it is. */
  reason: string | null
  parse(value: unknown): CodecOutcome
}

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

function refuse(code: string, message: string): CodecOutcome {
  return { ok: false, code, message }
}

function notWritable(status: 'read-only' | 'unsupported', reason: string): Codec {
  return { status, reason, parse: () => refuse(status, reason) }
}

/**
 * The check for one value of this column's type, with null already handled.
 *
 * Text length is counted in UTF-16 code units — JavaScript's `length`, which is
 * what formancy's own `maxLength` counts in the browser, so the two agree. It
 * is never fewer than characters, so a value accepted here fits PostgreSQL's
 * `varchar(n)` (characters) and SQL Server's `nvarchar(n)` (code units). SQL
 * Server's single-byte `varchar` can still refuse a character its code page
 * lacks; the adapter translates that error rather than this guessing at code
 * pages.
 */
function valueParser(column: ColumnMeta): ((value: unknown) => CodecOutcome) | string {
  const type = column.type
  switch (type.kind) {
    case 'text':
      return (value) => {
        if (typeof value !== 'string') return refuse('type', 'Expected text.')
        // PostgreSQL cannot store NUL in text at all; refused on both engines
        // so the same value means the same thing on either.
        if (value.includes('\u0000')) return refuse('invalid-character', 'Text cannot contain a NUL character.')
        if (type.maxLength !== null && value.length > type.maxLength) {
          return refuse('too-long', `At most ${String(type.maxLength)} characters.`)
        }
        return { ok: true, value }
      }

    case 'boolean':
      return (value) => (typeof value === 'boolean' ? { ok: true, value } : refuse('type', 'Expected true or false.'))

    case 'integer':
      return (value) =>
        typeof value === 'number' || typeof value === 'string'
          ? parseInteger(value, type.min, type.max)
          : refuse('type', 'Expected a whole number.')

    case 'decimal':
      return (value) =>
        typeof value === 'string'
          ? parseDecimal(value, type.precision, type.scale)
          : // A JSON number has already been through a double by the time it
            // arrives, so its digits past the fifteenth are not the client's.
            refuse('type', 'Send an exact decimal as a string, such as "1234.56".')

    case 'float':
      return (value) =>
        typeof value === 'number' && Number.isFinite(value) ? { ok: true, value } : refuse('not-finite', 'Expected a finite number.')

    case 'date':
      return (value) =>
        typeof value === 'string' && isDate(value) ? { ok: true, value } : refuse('not-a-date', 'Expected a real date as YYYY-MM-DD.')

    case 'time':
      return (value) =>
        typeof value === 'string' && isTime(value) ? { ok: true, value } : refuse('not-a-time', 'Expected a time of day as HH:MM.')

    case 'timestamp':
      if (!type.withTimeZone) {
        return 'a timestamp without a time zone has no formancy field: formancy datetime is an instant, and converting would guess a zone'
      }
      return (value) =>
        typeof value === 'string' && isInstant(value)
          ? { ok: true, value }
          : refuse('not-an-instant', 'Expected an instant as YYYY-MM-DDTHH:MM:SSZ, in UTC.')

    case 'uuid':
      return (value) =>
        typeof value === 'string' && UUID.test(value) ? { ok: true, value: value.toLowerCase() } : refuse('not-a-uuid', 'Expected a UUID.')

    case 'rowversion':
      return 'a rowversion is a concurrency token the database writes'

    case 'binary':
    case 'unsupported':
      // codecFor answers these before asking; the switch stays exhaustive so a
      // new kind is a compile error here rather than a silent fall-through.
      return 'no tested codec exists for this type'
  }
}

/**
 * The codec for a column.
 *
 * Read-only when the database writes the value — an identity, a computed
 * column, a rowversion — or when no faithful write exists. Unsupported when no
 * tested codec exists for the type: binary and every type the snapshot could
 * not normalise.
 */
export function codecFor(column: ColumnMeta): Codec {
  if (column.type.kind === 'binary' || column.type.kind === 'unsupported') {
    return notWritable('unsupported', `${column.databaseType} has no tested codec`)
  }
  if (column.generated !== 'none') return notWritable('read-only', `the database writes this column (${column.generated})`)

  const parser = valueParser(column)
  if (typeof parser === 'string') return notWritable('read-only', parser)

  return {
    status: 'editable',
    reason: null,
    parse(value) {
      if (value === null) return column.nullable ? { ok: true, value: null } : refuse('required', 'A value is required.')
      // Absent is not null: a patch that leaves a field out leaves it unchanged,
      // and that decision belongs to the caller, not to a codec guessing.
      if (value === undefined) return refuse('type', 'No value was given.')
      return parser(value)
    },
  }
}
