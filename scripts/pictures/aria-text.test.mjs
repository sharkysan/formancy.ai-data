import { describe, expect, test } from 'vitest'
import { decode, occursIn, strings } from './aria-text.mjs'

/**
 * The decoder a README picture's quotes are checked through (0038). A caption
 * quotes what a person reads; the record holds Playwright's accessibility
 * snapshot, which is YAML-escaped text. Matched against the escaped form, a
 * quote with a quotation mark or a colon in it would miss although the page
 * shows it, or hit a run that only exists in the escaping.
 *
 * Each line says where it came from: printed by `locator.ariaSnapshot()`
 * (Playwright 1.63.0, Chromium 153.0.8010.12) on a scene's part during the
 * pictures' first measurement, 2026-10-09, or made by hand for a shape no
 * pictured page has.
 */

describe('decode', () => {
  // A plain value is the text as written: decoding it must not touch it.
  test('reads a plain value as written', () => {
    // studio-drift, part Drift.
    expect(decode('    - status: 3 changes, 1 blocking.')).toEqual([{ depth: 2, role: 'status', name: undefined, value: '3 changes, 1 blocking.' }])
  })

  // Playwright quotes a value that holds a colon before a space, a quotation
  // mark or a control character, and escapes `\"` and `\xHH`; JSON knows the
  // first and not the second. A decoder that left them would make “The label
  // "Remarks"” unquotable, and a \x escape a line it cannot read.
  test('reads a double-quoted value, with an escaped quotation mark and a \\x escape', () => {
    // studio-carried, part Carried.
    expect(decode('      - paragraph: "The label \\"Remarks\\" you chose for notes was dropped: column notes is not in the regenerated form."')).toEqual([
      { depth: 3, role: 'paragraph', name: undefined, value: 'The label "Remarks" you chose for notes was dropped: column notes is not in the regenerated form.' },
    ])
    // Made by hand: no pictured page has a DEL character. The escaped
    // backslash before "x41" keeps that "x41" text, not an escape.
    expect(decode('- text: "a\\x7fb \\\\x41"')).toEqual([{ depth: 0, role: 'text', name: undefined, value: 'a\u007fb \\x41' }])
  })

  // A key with ": " in it is single-quoted, with '' for an apostrophe. Read
  // without stripping them, the name would be lost to the YAML.
  test("reads a single-quoted key, with '' standing for '", () => {
    // host-refused, part React.
    expect(decode(`        - 'link "Customer: This is not one of the options this form offers."':`)).toEqual([
      { depth: 4, role: 'link', name: 'Customer: This is not one of the options this form offers.', value: undefined },
    ])
    // Made by hand: the same shape with an apostrophe in the name.
    expect(decode(`- 'button "Ada''s: draft" [pressed]': Saved`)).toEqual([{ depth: 0, role: 'button', name: "Ada's: draft", value: 'Saved' }])
  })

  // A name is JSON.stringify's output, so an escaped quotation mark in it is
  // the mark itself, and the attributes after it are not part of it.
  test('reads a name with an escaped quotation mark, and its attributes apart from it', () => {
    // studio-carried, part Carried: curly marks, which JSON leaves alone.
    expect(decode('      - button "Give “Remarks”"')).toEqual([{ depth: 3, role: 'button', name: 'Give “Remarks”', value: undefined }])
    // Made by hand: no pictured name has a straight quotation mark.
    expect(decode('- heading "Say \\"hi\\"" [level=3]:')).toEqual([{ depth: 0, role: 'heading', name: 'Say "hi"', value: undefined }])
  })

  // A link's address and a placeholder are properties, not text a heading or
  // a field says; they are read, under their own key, rather than refused.
  test('reads a property line', () => {
    // host-refused, part React.
    expect(decode('          - /url: "#f:pg-order-react:customer:control"')).toEqual([{ depth: 5, role: '/url', name: undefined, value: '#f:pg-order-react:customer:control' }])
  })

  // A line the format above does not describe would otherwise be skipped, and
  // a quote it holds would be "missing" for a reason nobody could see.
  test.each([
    ['no list marker', 'status: Saved.'],
    ['an odd indentation', ' - status: Saved.'],
    ['an unclosed value', '- status: "Saved.'],
    ['a key that is not a role', '- Saved.'],
    ['an unclosed single-quoted key', `- 'option "None: x"`],
    ['trailing text after a name', '- button "Save" now'],
  ])('refuses a line with %s', (_, line) => {
    expect(() => decode(line)).toThrow(/line 1 is not an accessibility snapshot line/)
  })
})

describe('occursIn', () => {
  // host-loaded, part React, shortened: the lines are as printed.
  const snapshot = ['- region "React":', '  - heading "React" [level=2]', '  - form "Order, React":', '    - textbox "Amount*": "99999999999999.9999"', '    - paragraph:', '      - text: blocking', '      - code: column-dropped'].join('\n')

  // A quote is held by what one element says: a run that only exists when two
  // lines are read together is not something a person reads in one place.
  test('finds a quote inside one name or value, and not across two', () => {
    expect(occursIn('99999999999999.9999', snapshot)).toBe(true)
    expect(occursIn('Order, React', snapshot)).toBe(true)
    expect(occursIn('column-dropped', snapshot)).toBe(true)
    expect(occursIn('blocking column-dropped', snapshot)).toBe(false)
  })

  // The escaping is not text: a quote of a quotation mark finds the mark, and
  // the backslash Playwright put before it finds nothing.
  test('matches the decoded text, not the escaping', () => {
    const escaped = '- paragraph: "The label \\"Remarks\\" you chose"'
    expect(occursIn('The label "Remarks"', escaped)).toBe(true)
    expect(occursIn('\\"Remarks', escaped)).toBe(false)
  })
})

describe('strings', () => {
  // The camera searches these for a secret: a token typed into a field is a
  // value, and one in a name is a name, so both must be in the list.
  test('lists every decoded name and value, in order', () => {
    expect(strings('- textbox "Record token": k1:9007199254740993\n- button "Load"')).toEqual(['Record token', 'k1:9007199254740993', 'Load'])
  })
})
