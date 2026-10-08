import type { ObjectRef } from '@formancy/data-core'

/** sysname is nvarchar(128): no SQL Server identifier is longer, and QUOTENAME returns NULL past it. */
const MAX_IDENTIFIER_LENGTH = 128

/**
 * One identifier, bracket-quoted with every `]` doubled, which is what
 * QUOTENAME does: inside brackets nothing else is special, so a name with a
 * dot, a space, a quote or a reserved word is one identifier and never SQL.
 *
 * Names come from approved metadata (CLAUDE.md, "Secrets and identifiers"),
 * so one that no catalog could hold — empty, longer than sysname, or carrying
 * a NUL — is a programming error, and refused before any SQL is built.
 */
export function quoteName(name: string): string {
  if (typeof name !== 'string' || name.length === 0 || name.length > MAX_IDENTIFIER_LENGTH || name.includes('\u0000')) {
    throw new Error(`An identifier is 1 to ${String(MAX_IDENTIFIER_LENGTH)} characters without NUL, as SQL Server's catalog holds it`)
  }
  return `[${name.replaceAll(']', ']]')}]`
}

/**
 * A table or view, quoted one part at a time from its two fields. Never from
 * a dotted string: `sales.order` split at the dot is a guess, and a name that
 * contains a dot is legal once quoted (0015).
 */
export function quoteTable(ref: ObjectRef): string {
  return `${quoteName(ref.schema)}.${quoteName(ref.name)}`
}
