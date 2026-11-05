import type { ListFilterTerm } from '../runtime.js'
import { conditionsOf, lineTokens, parseFilterLine, quoted, shownValue, written } from './filter-line.js'
import type { LineField, LineToken } from './filter-line.js'

/*
 * A column header's filter box (0132): the filter line's condition on one
 * field, typed without the field's name, since the column says it. The box
 * is read by the line's own reader with the field's key put in front -- and
 * after an `and` that starts a second bound -- so it refuses what the line
 * refuses, in its words. A box that starts with no operator holds one
 * value, whatever it holds: found anywhere in a text field that offers
 * contains, and equal to anything else.
 */

/**
 * Whether the token at `index` starts a condition's operator: `=`, `>` and
 * the rest, `contains`, or `is` before `empty` or `not` -- a note that
 * starts with the word "is" is a note.
 */
function startsOperator(found: readonly LineToken[], index: number): boolean {
  const token = found[index]
  if (token === undefined) return false
  if (token.kind === 'operator') return true
  const word = token.kind === 'word' ? token.value.toLowerCase() : null
  const next = found[index + 1]
  return word === 'contains' || (word === 'is' && next?.kind === 'word' && ['empty', 'not'].includes(next.value.toLowerCase()))
}

/** What a bare value means in a box on `field`. */
const bare = (field: LineField): string => (field.input === 'text' && field.operators.includes('contains') ? 'contains' : '=')

/**
 * A box's text as the condition it puts on its column -- null for an empty
 * box, which is none -- or the line's refusal of it.
 */
export function headerCondition(text: string, field: LineField): { ok: true; term: ListFilterTerm | null } | { ok: false; message: string } {
  const found = lineTokens(text)
  const [first] = found
  if (first === undefined) return { ok: true, term: null }
  let line: string
  if (startsOperator(found, 0)) {
    // The key in front, and again after each `and` a second bound starts with.
    line = `${field.field} `
    let from = 0
    for (const [index, token] of found.entries()) {
      const before = found[index - 1]
      if (before?.kind !== 'word' || before.value.toLowerCase() !== 'and' || !startsOperator(found, index)) continue
      line += `${text.slice(from, token.at)}${field.field} `
      from = token.at
    }
    line += text.slice(from)
  } else {
    const one = found.length === 1 && first.kind === 'quoted' ? first.text : written(text.trim())
    line = `${field.field} ${bare(field)} ${one}`
  }
  const read = parseFilterLine(line, [field])
  if (!read.ok) return { ok: false, message: read.message }
  return { ok: true, term: read.filter[0] ?? null }
}

/**
 * What a box shows of the condition its column has: a bare value where the
 * box reads it back as that condition -- quoted where it would read as an
 * operator, or lose a space -- and otherwise the line's words without the
 * name. Empty for none.
 */
export function headerText(term: ListFilterTerm | undefined, field: LineField): string {
  if (term === undefined) return ''
  const value =
    term.op === 'contains' && bare(field) === 'contains' ? term.text : term.op === 'equals' && bare(field) === '=' ? shownValue(field, term.value) : null
  if (value !== null) {
    const plain = value !== '' && value === value.trim() && !value.startsWith('"') && !startsOperator(lineTokens(value), 0)
    return plain ? value : quoted(value)
  }
  return conditionsOf(term, '', field)
    .map((condition) => condition.trimStart())
    .join(' and ')
}
