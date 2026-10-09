import type { ColumnMeta } from '../metadata.js'
import { canonicalFloat32, parseDecimal, parseInteger } from './numbers.js'
import { isDate, isInstant, isTime } from './temporal.js'
import { parseText } from './text.js'

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
 * A 32-bit float, after the finite check: refused where a real would store
 * infinity or a zero nobody wrote — SQL Server stores 1e-50 as 0 silently,
 * where PostgreSQL refuses it — and otherwise the shortest decimal naming the
 * float the column stores, which is what both adapters read back (0026).
 */
function parseFloat32(value: number): CodecOutcome {
  const stored = Math.fround(value)
  if (!Number.isFinite(stored)) {
    return refuse('out-of-range', 'Too large for a 32-bit floating-point number, which holds up to about 3.4e38.')
  }
  if (stored === 0 && value !== 0) {
    return refuse('out-of-range', 'Too close to zero for a 32-bit floating-point number, which would store it as 0.')
  }
  return { ok: true, value: canonicalFloat32(value) }
}

/**
 * The check for one value of this column's type, with null already handled.
 *
 * Text is counted in the column's own `lengthUnit` (0026, `parseText`): the
 * browser's `maxLength` counts UTF-16 code units, which is the server's rule
 * for nvarchar only, and the generator says per field how the two relate.
 */
function valueParser(column: ColumnMeta): ((value: unknown) => CodecOutcome) | string {
  const type = column.type
  switch (type.kind) {
    case 'text':
      return (value) => (typeof value === 'string' ? parseText(type, value) : refuse('type', 'Expected text.'))

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
      return (value) => {
        if (typeof value !== 'number' || !Number.isFinite(value)) return refuse('not-finite', 'Expected a finite number.')
        return type.bits === 32 ? parseFloat32(value) : { ok: true, value }
      }

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
