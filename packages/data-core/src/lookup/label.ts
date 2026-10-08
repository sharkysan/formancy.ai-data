/**
 * Between display values. Not a comma: names contain commas, and
 * "Smith, John, Zürich" does not say where one value ends.
 */
export const LABEL_SEPARATOR = ' · '

/** For a row with nothing to show and a key that is blank too. Never reached by a key with any visible character. */
const NOTHING = '—'

/** C0, DEL and C1. In `u` mode, so it reads code points. */
const CONTROL = /\p{Cc}/gu
/** One run of whitespace. Unanchored, so it is matched once per run and cannot backtrack across the string. */
const WHITESPACE = /\s+/g

/** One line of plain text: control characters and runs of whitespace become one space, and the ends are trimmed. */
function clean(value: string | null): string {
  if (value === null) return ''
  return value.replace(CONTROL, ' ').replace(WHITESPACE, ' ').trim()
}

function join(values: ReadonlyArray<string | null>): string {
  return values
    .map(clean)
    .filter((value) => value !== '')
    .join(LABEL_SEPARATOR)
}

/**
 * The plain-text label of one row: its display values, in order, joined.
 *
 * Never empty. formancy refuses a whole list of options when one label is
 * empty (`acceptRemoteOptions`), so one nameless row would take the page with
 * it. A row whose display values are all NULL or blank is labelled by its key
 * instead — which the browser already holds in the token, so nothing is
 * disclosed — and several such rows can still be told apart.
 *
 * A label is for recognising a row, not for identifying it: two customers may
 * both be "Acme AG", and only the token tells them apart.
 */
export function formatLabel(display: ReadonlyArray<string | null>, key: readonly string[]): string {
  const shown = join(display)
  if (shown !== '') return shown
  const identified = join(key)
  return identified === '' ? NOTHING : identified
}
