import type { ColumnMeta } from '../metadata.js'

/**
 * The most a field's help text holds: formancy's `Text`, one to 300
 * characters, counted as code points, as its validator counts them.
 */
export const HELP_TEXT_LIMIT = 300

/** A field's help text, or why a comment that was there gives it none. */
export type HelpText = { kind: 'comment'; text: string } | { kind: 'too-long'; length: number } | { kind: 'none' }

/**
 * A field's help text (0118): the comment of the one column it stands for,
 * its surrounding whitespace trimmed. None for a field over several columns
 * -- a composite lookup, whose columns' comments say several things -- or a
 * column without a comment, or one of whitespace alone. A comment longer
 * than help text holds is left out and said, never cut: a cut sentence can
 * say the opposite of the whole one.
 */
export function helpTextFor(columns: readonly ColumnMeta[]): HelpText {
  const [column, ...others] = columns
  if (column === undefined || others.length > 0) return { kind: 'none' }
  const text = (column.comment ?? '').trim()
  if (text === '') return { kind: 'none' }
  const length = [...text].length
  return length > HELP_TEXT_LIMIT ? { kind: 'too-long', length } : { kind: 'comment', text }
}

/** The note a comment too long for help text gives its field. */
export function tooLongNote(length: number): string {
  return `Its column comment is ${length} characters, more than the ${HELP_TEXT_LIMIT} a field’s help text holds, so the field has none.`
}
