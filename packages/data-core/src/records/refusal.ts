/*
 * A refusal the deployment words for the person (0156): a trigger, or a
 * routine a write runs, raises an error whose message starts with exactly
 * `formancy: refused: `, and the rest of that message is shown to the person
 * who saved, as the reason the database refused it. Optionally
 * `formancy: refused [column]: ` names a column, so the reason goes beside
 * the field bound to it.
 *
 * One reading for both adapters: which error carries a message at all is
 * each engine's -- PostgreSQL's RAISE, SQL Server's user error -- and is
 * decided in each adapter's records/errors.ts; what such a message says, and
 * whether its shape is one this module passes on, is decided here once, so
 * the two engines cannot pass on two different things.
 *
 * Fail closed on shape: a message this does not read as a reason is the
 * engine's ordinary refusal, in the server's own words, as it was before
 * the prefix existed.
 */

/** What a deployment's refusal starts with, exactly: lower case, one space after each colon. */
export const REFUSAL_PREFIX = 'formancy: refused: '

/** What a refusal that names a column starts with, before the column and `]: `. */
const COLUMN_OPENS = 'formancy: refused ['
const COLUMN_CLOSES = ']: '

/**
 * The longest message, the prefix included, whose reason is passed on, in
 * UTF-16 code units -- how SQL Server's nvarchar counts, and a JavaScript
 * string's length. One short of the 2,047 that SQL Server's THROW and
 * RAISERROR carry whole: each cuts a longer message to its first 2,044 code
 * units and `...`, which is 2,047 too, so a message that arrives at 2,047
 * may be the start of a longer sentence, and only one shorter cannot.
 * Measured, not read: the SQL Server failures suite THROWs and RAISERRORs a
 * message of each length through the write batch's shape and reads what
 * arrives -- Microsoft's documentation gives THROW's message as
 * nvarchar(2048). PostgreSQL carries longer ones, and is held to the same
 * bound so a deployment's sentence reaches a person alike on both.
 */
export const REFUSAL_LONGEST = 2046

/**
 * A control character anywhere: one line of text, or nothing. A C0 or C1
 * control -- a line break, a tab, an escape -- and two that `\p{Cc}` leaves
 * out: a line or paragraph separator, which breaks the line as a line feed
 * does, and a bidirectional embedding, override or isolate, which holds over
 * the text after it, so a reason could reorder the page's own sentence
 * beside it. Not every format character: a joiner, which an emoji sequence
 * is made of, passes.
 */
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}\u202a-\u202e\u2066-\u2069]/u

/**
 * What a message the engine raised says, as this module reads it:
 *
 * - `none`: it does not start with the prefix. The engine's refusal as
 *   before, in the server's words.
 * - `declined`: the deployment's reason, as written after the prefix, and
 *   the column it names, if it names one.
 * - `unshaped`: it starts with the prefix and is not passed on, and `why`
 *   says why, for a log: longer than `REFUSAL_LONGEST`, a control character,
 *   no reason after the prefix, or a column with no `]: ` closing it or
 *   nothing between the brackets. Never the reason itself, which may hold a
 *   value (0011).
 */
export type DeploymentRefusal =
  | { kind: 'none' }
  | { kind: 'declined'; reason: string; column?: string }
  | { kind: 'unshaped'; why: 'too long' | 'a control character' | 'no reason' | 'an unclosed column' | 'an empty column' }

/**
 * Reads `message` as a deployment's refusal (0156). The prefix is matched
 * exactly, never loosely: a message that only resembles it is `none`, the
 * same refusal it was before this release, so no existing trigger's error
 * changes what a person reads.
 */
export function deploymentRefusal(message: string): DeploymentRefusal {
  const bracketed = message.startsWith(COLUMN_OPENS)
  if (!bracketed && !message.startsWith(REFUSAL_PREFIX)) return { kind: 'none' }
  if (message.length > REFUSAL_LONGEST) return { kind: 'unshaped', why: 'too long' }
  if (CONTROL.test(message)) return { kind: 'unshaped', why: 'a control character' }
  let column: string | undefined
  let reason: string
  if (bracketed) {
    const closes = message.indexOf(COLUMN_CLOSES, COLUMN_OPENS.length)
    if (closes < 0) return { kind: 'unshaped', why: 'an unclosed column' }
    if (closes === COLUMN_OPENS.length) return { kind: 'unshaped', why: 'an empty column' }
    column = message.slice(COLUMN_OPENS.length, closes)
    reason = message.slice(closes + COLUMN_CLOSES.length)
  } else {
    reason = message.slice(REFUSAL_PREFIX.length)
  }
  if (reason.trim() === '') return { kind: 'unshaped', why: 'no reason' }
  return column === undefined ? { kind: 'declined', reason } : { kind: 'declined', reason, column }
}
