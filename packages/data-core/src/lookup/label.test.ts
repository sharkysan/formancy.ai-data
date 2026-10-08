import { acceptRemoteOptions } from '@formancy/spec'
import { describe, expect, test } from 'vitest'
import { formatLabel, LABEL_SEPARATOR } from './label.js'

describe('formatLabel', () => {
  // The label is what a person recognises a row by. A comma would be ambiguous
  // with the data — "Smith, John, Zürich" — so the join is a separator names
  // rarely contain.
  test('joins the display values in order, with a separator data rarely holds', () => {
    expect(LABEL_SEPARATOR).toBe(' · ')
    expect(formatLabel(['Acme AG', 'Zürich'], ['1'])).toBe('Acme AG · Zürich')
    expect(formatLabel(['Smith, John'], ['7'])).toBe('Smith, John')
  })

  // A select option is one line of plain text. A name with a newline, a tab or
  // a run of spaces would render differently in every theme, and a control
  // character would render as nothing at all.
  test('trims each value and folds whitespace and control characters into single spaces', () => {
    expect(formatLabel(['  Acme\n  AG\t', 'Zü\u0000rich', 'a b'], ['1'])).toBe('Acme AG · Zü rich · a b')
  })

  // A NULL or blank display value has nothing to show. Joining it anyway
  // leaves a dangling separator that reads like a missing word.
  test('skips a NULL or blank display value rather than leaving an empty slot', () => {
    expect(formatLabel(['Acme AG', null, '   ', 'Zürich'], ['1'])).toBe('Acme AG · Zürich')
  })

  // formancy refuses a whole list of options when one label is empty, so one
  // nameless row would take every other row with it. And several rows labelled
  // the same placeholder could not be told apart, so the key is shown instead.
  test('a row with nothing to display is labelled by its key, and never by an empty string', () => {
    expect(formatLabel([null, ''], ['7', '1001'])).toBe('7 · 1001')
    expect(formatLabel([], ['42'])).toBe('42')
    expect(formatLabel([null], ['', ' '])).toBe('—')

    const awkward: Array<[Array<string | null>, string[]]> = [
      [[], ['']],
      [[null], ['\u0000']],
      [['\n'], ['\t']],
      [[' '], ['﻿']],
      [['x'], ['']],
    ]
    for (const [display, key] of awkward) {
      const label = formatLabel(display, key)
      expect(label.trim(), JSON.stringify([display, key])).not.toBe('')
      expect(acceptRemoteOptions([{ value: 'k1:1', label }])).toBeDefined()
    }
  })
})
