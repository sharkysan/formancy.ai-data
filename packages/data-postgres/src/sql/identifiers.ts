import type { ObjectRef } from '@formancy/data-core'

/**
 * The longest identifier PostgreSQL keeps, in bytes: `NAMEDATALEN - 1` in a
 * default build.
 *
 * A longer one is not refused. The server truncates it to this many bytes,
 * says so in a NOTICE, and goes on to address whatever object has the
 * truncated name — a different table, if one exists. No catalog can hand out
 * such a name, so one arriving here did not come from approved metadata.
 */
export const MAX_IDENTIFIER_BYTES = 63

const UTF8 = new TextEncoder()

/**
 * One identifier, quoted: wrapped in double quotes, with each double quote
 * inside it doubled. Nothing else needs escaping inside a quoted identifier,
 * and a dot is part of the name, which is why the driver's own `sql(name)`
 * helper — which splits on dots — is never used for one (0015).
 *
 * Throws on a name no catalog could have produced: a programming error, not a
 * database answer.
 */
export function quoteIdentifier(name: string): string {
  if (typeof name !== 'string' || name === '') throw new Error('An identifier is a non-empty string taken from approved metadata.')
  if (name.includes('\u0000')) throw new Error('An identifier cannot contain NUL: no PostgreSQL catalog holds one.')
  const bytes = UTF8.encode(name).length
  if (bytes > MAX_IDENTIFIER_BYTES) {
    throw new Error(
      `An identifier of ${String(bytes)} bytes is longer than PostgreSQL's ${String(MAX_IDENTIFIER_BYTES)} bytes. The server would truncate it and address whatever the truncated name names, so it is refused.`,
    )
  }
  return `"${name.replaceAll('"', '""')}"`
}

/** A table, quoted one part at a time from the two fields that name it. */
export function quoteTable(ref: ObjectRef): string {
  return `${quoteIdentifier(ref.schema)}.${quoteIdentifier(ref.name)}`
}
