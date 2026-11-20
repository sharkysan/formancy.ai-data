/*
 * How the generator's sentences quote a value a column holds (0152): in
 * curly quotes, so blanks are seen and a value ends where its quote does.
 * A module of its own, importing nothing, so a select of a check's values
 * (`listed.ts`) and of an enum's labels (`controls.ts`, 0170) say theirs
 * alike without either importing the other.
 */

/** A value as a sentence quotes it, as the generator's other notes quote one, so blanks are seen. */
export function quotedValue(value: string): string {
  return `“${value}”`
}

/** Values as a sentence lists them: “a”, “b” and “c”. */
export function quotedValues(values: readonly string[]): string {
  const quoted = values.map(quotedValue)
  return quoted.length < 2 ? quoted.join('') : `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1) as string}`
}
