import { lineNames, lineTokens, offerWords, readLine, written } from './filter-line.js'
import type { LineField, LineState } from './filter-line.js'

/*
 * What the filter line offers at the caret: what may come next where the
 * line stands, begun as the word under the caret begins. The line is
 * learned by using it, so a name is offered with its label, an operator
 * with the words the chips say it in, and a field's values where it says
 * them; free text is never guessed at.
 */

/** One thing that may be typed next: what is inserted, what the list shows, and what it means. */
export interface LineOption {
  insert: string
  label: string
  hint: string
}

/** What may be typed at the caret, and the characters from `from` to `to` that picking one replaces. */
export interface LineCompletion {
  from: number
  to: number
  options: LineOption[]
}

/** What each comparison says, of a day and of anything else. */
const SAYS: Readonly<Record<string, readonly [string, string]>> = {
  '=': ['is', 'is'],
  '>': ['is after', 'is over'],
  '>=': ['is on or after', 'is at least'],
  '<': ['is before', 'is under'],
  '<=': ['is on or before', 'is at most'],
  contains: ['contains', 'contains'],
  'is empty': ['has no value', 'has no value'],
  'is not empty': ['has a value', 'has a value'],
}

const AND: LineOption = { insert: 'and ', label: 'and', hint: 'and another condition that holds too' }

/** What may come next where the line stands. */
function offered(state: LineState, fields: readonly LineField[]): LineOption[] {
  switch (state.want) {
    case 'name': {
      const names = lineNames(fields)
      return fields.map((field) => {
        const name = names.get(field.field) ?? field.field
        return { insert: `${name} `, label: name, hint: field.label }
      })
    }
    case 'operator':
      return offerWords(state.field).map((word) => {
        const says = SAYS[word]
        return { insert: `${word} `, label: word, hint: (state.field.input === 'date' ? says?.[0] : says?.[1]) ?? word }
      })
    case 'is':
      return [
        ...(state.field.operators.includes('null') ? [{ insert: 'empty ', label: 'empty', hint: 'has no value' }] : []),
        ...(state.field.operators.includes('not-null') ? [{ insert: 'not empty ', label: 'not empty', hint: 'has a value' }] : []),
      ]
    case 'is-not':
      return state.field.operators.includes('not-null') ? [{ insert: 'empty ', label: 'empty', hint: 'has a value' }] : []
    case 'value':
      if (state.operator.text !== '=') return []
      if (state.field.input === 'boolean')
        return [
          { insert: 'yes ', label: 'yes', hint: 'true' },
          { insert: 'no ', label: 'no', hint: 'false' },
        ]
      return (state.field.values ?? []).map((entry) => ({ insert: `${written(entry.value)} `, label: entry.label, hint: entry.value }))
    case 'and':
      return [AND]
  }
}

/**
 * What may be typed at `caret` in `text`: the options that begin as the
 * word under the caret does up to it -- by what is inserted or listed, a
 * name by its field's label too -- replacing that whole word. Inside a quote,
 * or after something the line cannot read, nothing.
 */
export function completeFilterLine(text: string, caret: number, fields: readonly LineField[]): LineCompletion {
  const found = lineTokens(text)
  const current = found.find((token) => token.at < caret && caret <= token.end)
  const from = current?.at ?? caret
  const to = current?.end ?? caret
  const none = { from, to, options: [] }
  if (current?.kind === 'quoted') return none
  const read = readLine(
    found.filter((token) => token.end <= from),
    fields,
  )
  if (!read.ok) return none
  const typed = text.slice(from, caret).toLowerCase()
  const spaced = /\s/u.test(text.charAt(to))
  const options = offered(read.state, fields)
    .filter((option) =>
      [option.label, option.insert, ...(read.state.want === 'name' ? [option.hint] : [])].some((said) => said.toLowerCase().startsWith(typed)),
    )
    .map((option) => (spaced ? { ...option, insert: option.insert.trimEnd() } : option))
  return { from, to, options }
}
