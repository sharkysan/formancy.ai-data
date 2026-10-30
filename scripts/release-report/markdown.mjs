// How the release report writes a value in Markdown (0035): as code, in a
// table, as a list in prose, in seconds, a server's answer as a reader reads
// it, and a document given as evidence. Shared by the report's sections
// (render.mjs) and the limitations the run shows (derived-limitations.mjs),
// so the two say the same thing the same way.

export const code = (text) => `\`${text}\``
const cell = (text) => String(text ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ')
export const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`)].join('\n')
export const prose = (items) => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`)
export const seconds = (ms) => (ms === null || ms === undefined || Number.isNaN(ms) ? '' : `${(ms / 1000).toFixed(1)} s`)

/** `17.11`, or `16.0.4295.3 (CU20, Developer Edition (64-bit))`: an answer as a reader reads it. */
export const answer = (entry) => {
  const extra = [entry.updateLevel, entry.edition].filter((value) => value !== null && value !== undefined)
  return extra.length === 0 ? entry.version : `${entry.version} (${extra.join(', ')})`
}

/** A document as evidence: where it is stated and when it last changed. */
export function stated(item) {
  const history = item.history
  if (history === null || history === undefined) return `stated in ${code(item.value)}, whose history this checkout does not have`
  return `stated in ${code(item.value)}, last changed ${history.date.slice(0, 10)} at ${code(history.sha.slice(0, 7))}, ${String(history.behind)} commit(s) before this one`
}
