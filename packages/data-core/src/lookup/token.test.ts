import { acceptRemoteOptions } from '@formancy/spec'
import { describe, expect, test } from 'vitest'
import { decodeKeyToken, encodeKeyToken, KEY_TOKEN_MAX_LENGTH } from './token.js'

/** The token for `values`, or a failure naming the refusal that came back instead. */
function token(values: readonly string[]): string {
  const encoded = encodeKeyToken(values)
  if (!encoded.ok) throw new Error(`${values.join('|')} was refused: ${encoded.message}`)
  return encoded.token
}

/** The values in `encoded`, or a failure naming the refusal that came back instead. */
function values(encoded: string): string[] {
  const decoded = decodeKeyToken(encoded)
  if (!decoded.ok) throw new Error(`${encoded} was refused: ${decoded.message}`)
  return decoded.values
}

/**
 * Keys chosen to break a naive join: the separator, the escape, the prefix, a
 * quote, nothing at all, a value that is itself a token, and text from outside
 * ASCII — including a character that needs two UTF-16 units.
 */
const AWKWARD: ReadonlyArray<readonly string[]> = [
  ['42'],
  ['-9223372036854775808'],
  ['12.50'],
  ['0f8fad5b-d9cb-469f-a165-70867728950e'],
  [''],
  ['', ''],
  ['a', ''],
  ['', 'a'],
  ['a,b'],
  ['a', 'b'],
  ['a:b'],
  ['k1:a,b'],
  ['k1:'],
  ['k2:x'],
  ['~'],
  ['~0041'],
  ['A'],
  ['"quoted"', "it's"],
  ['100%', 'a b', ' padded '],
  ['Zürich', 'größe', 'İstanbul'],
  ['東京'],
  ['😀'],
  ['line\nbreak', 'tab\there', 'nul\u0000inside'],
  ['7', '1001', 'CH', '2026-10-08'],
]

describe('encodeKeyToken and decodeKeyToken', () => {
  // A token that decoded to a different key would point a saved answer at a
  // different row than the one the person picked. Every awkward shape has to
  // come back exactly as it went in.
  test('every key decodes to exactly what was encoded', () => {
    for (const key of AWKWARD) expect(values(token(key))).toEqual(key)
  })

  // Two keys sharing a token is the ambiguity the encoding exists to remove:
  // ['a,b'] and ['a', 'b'] joined by a comma are one string, and a save would
  // reference whichever row the database found first.
  test('different keys never share a token', () => {
    const tokens = AWKWARD.map(token)
    expect(new Set(tokens).size).toBe(AWKWARD.length)
  })

  // The common keys stay readable in a log or an admin's archive view, and
  // every token is plain printable ASCII: no invisible character, no bidi
  // control, and one length whether counted in bytes, UTF-16 units or code points.
  test('a token is printable ASCII, and an integer or composite key reads as itself', () => {
    expect(token(['42'])).toBe('k1:42')
    expect(token(['7', '1001'])).toBe('k1:7,1001')
    expect(token(['0f8fad5b-d9cb-469f-a165-70867728950e'])).toBe('k1:0f8fad5b-d9cb-469f-a165-70867728950e')
    expect(token(['a,b'])).toBe('k1:a~002Cb')
    expect(token(['Zürich'])).toBe('k1:Z~00FCrich')
    for (const key of AWKWARD) expect(token(key)).toMatch(/^k1:[A-Za-z0-9._~,-]*$/)
  })

  // formancy stores a select's answer in 1 to 200 characters. A token one
  // longer would be refused at submission, after the person chose it; a
  // truncated one would name a different key. The bound is held against
  // formancy's own check rather than against a copy of its number.
  test('refuses a key whose token would exceed what formancy stores, and formancy agrees on the boundary', () => {
    const longest = 'x'.repeat(KEY_TOKEN_MAX_LENGTH - 'k1:'.length)
    expect(token([longest])).toHaveLength(KEY_TOKEN_MAX_LENGTH)
    expect(acceptRemoteOptions([{ value: token([longest]), label: 'longest' }])).toBeDefined()
    expect(acceptRemoteOptions([{ value: `${token([longest])}x`, label: 'one more' }])).toBeUndefined()

    const over = encodeKeyToken([`${longest}x`])
    expect(over).toMatchObject({ ok: false, code: 'too-long' })
    expect(over.ok ? '' : over.message).toMatch(/201 characters.*at most 200/)

    // Escaping counts: thirty-nine ü fit, forty do not, though both are short
    // strings; an emoji is two UTF-16 units, so nineteen fit and twenty do not.
    expect(encodeKeyToken(['ü'.repeat(39)]).ok).toBe(true)
    expect(encodeKeyToken(['ü'.repeat(40)])).toMatchObject({ ok: false, code: 'too-long' })
    expect(encodeKeyToken(['😀'.repeat(19)]).ok).toBe(true)
    expect(encodeKeyToken(['😀'.repeat(20)])).toMatchObject({ ok: false, code: 'too-long' })
  })

  // A key with no columns is not a key, and a value that is not text was never
  // a canonical API string: encoding String(value) would guess at its spelling.
  test('refuses an empty key and a value that is not text', () => {
    expect(encodeKeyToken([])).toMatchObject({ ok: false, code: 'empty-key' })
    expect(encodeKeyToken([42 as unknown as string])).toMatchObject({ ok: false, code: 'not-text' })
    expect(encodeKeyToken('42' as unknown as string[])).toMatchObject({ ok: false, code: 'not-text' })
  })

  // A lone UTF-16 surrogate can sit in a SQL Server nvarchar, but PostgreSQL
  // cannot store it and UTF-8 cannot carry it: a reference to it would mean
  // different things on the two engines. A paired one is an ordinary character.
  test('refuses text with an unpaired surrogate, and accepts a paired one', () => {
    expect(encodeKeyToken(['\ud83d'])).toMatchObject({ ok: false, code: 'ill-formed-text' })
    expect(encodeKeyToken(['ok', '\ude00x'])).toMatchObject({ ok: false, code: 'ill-formed-text' })
    expect(encodeKeyToken(['\ude00\ud83d'])).toMatchObject({ ok: false, code: 'ill-formed-text' })
    expect(values(token(['😀']))).toEqual(['😀'])
  })
})

describe('decodeKeyToken', () => {
  // Each of these spells a key some other way than the encoder would. Accepting
  // any of them gives one key two tokens, so a membership check comparing
  // tokens would refuse a row that is there, or a stored answer would stop
  // matching the option that offered it.
  test('refuses every spelling the encoder would not produce', () => {
    const malformed = [
      'k1:a~002cb', // lower-case hex
      'k1:~0041', // an escape for a character written as itself
      'k1:~41', // a short escape
      'k1:~00G1', // not hex
      'k1:a~', // an escape cut off
      'k1:a b', // a raw space
      'k1:a:b', // a raw colon
      'k1:100%', // a raw percent
      'k1:Zürich', // raw text outside ASCII
      'k1:a\u0000', // a raw control character
    ]
    for (const spelling of malformed) expect(decodeKeyToken(spelling), spelling).toMatchObject({ ok: false, code: 'malformed' })
  })

  // A token from a newer release is not garbage, and saying which version it
  // is tells an operator to upgrade rather than to look for corruption.
  test('tells an unknown version from something that is not a token at all', () => {
    expect(decodeKeyToken('k2:42')).toMatchObject({ ok: false, code: 'unsupported-version' })
    expect(decodeKeyToken('k01:42')).toMatchObject({ ok: false, code: 'unsupported-version' })
    for (const spelling of ['', '42', 'K1:42', 'k1', 'k:42', 'kx:42']) {
      expect(decodeKeyToken(spelling), spelling).toMatchObject({ ok: false, code: 'not-a-token' })
    }
  })

  // A token formancy could not have stored is not one a person chose. Refused
  // before it is read, so its length bounds the work.
  test('refuses a token longer than formancy stores, and anything that is not a string', () => {
    expect(decodeKeyToken(`k1:${'x'.repeat(KEY_TOKEN_MAX_LENGTH)}`)).toMatchObject({ ok: false, code: 'too-long' })
    expect(decodeKeyToken(42 as unknown as string)).toMatchObject({ ok: false, code: 'not-text' })
  })

  // Escapes are per UTF-16 unit, so a token can spell half a character. The
  // encoder never does; the decoder must not hand an adapter one.
  test('refuses a token whose escapes spell an unpaired surrogate', () => {
    expect(decodeKeyToken('k1:~D83D')).toMatchObject({ ok: false, code: 'ill-formed-text' })
    expect(decodeKeyToken('k1:a,~DE00~D83D')).toMatchObject({ ok: false, code: 'ill-formed-text' })
    expect(values('k1:~D83D~DE00')).toEqual(['😀'])
  })

  // The property that makes a token comparable as a string: whatever the
  // decoder accepts, the encoder spells identically. Enumerated over pieces
  // that are each nearly right — a lower-case escape, an escaped literal, a
  // stray prefix — so the accepted set is not only the easy cases.
  test('every accepted token is the canonical spelling of its key', () => {
    const pieces = ['', 'a', 'Z9', ',', '~002C', '~002c', '~0041', '~00FC', '~D83D', '~DE00', '~', '~00', ':', 'k1:', ' ', 'ü']
    const accepted = new Set<string>()
    const refused = new Set<string>()
    const visit = (body: string, depth: number): void => {
      for (const prefix of ['k1:', 'k2:', '']) {
        const candidate = `${prefix}${body}`
        const decoded = decodeKeyToken(candidate)
        if (decoded.ok) {
          accepted.add(candidate)
          expect(encodeKeyToken(decoded.values), candidate).toEqual({ ok: true, token: candidate })
        } else {
          refused.add(candidate)
        }
      }
      if (depth === 0) return
      for (const piece of pieces) visit(`${body}${piece}`, depth - 1)
    }
    visit('', 3)
    // Not vacuous: the hard cases were reached on both sides.
    for (const reached of ['k1:', 'k1:,', 'k1:,,', 'k1:~002C', 'k1:a,~00FC', 'k1:~D83D~DE00', 'k1:Z9~002CZ9']) expect(accepted).toContain(reached)
    for (const reached of ['k1:~002c', 'k1:~0041', 'k1:~D83D', 'k1:~00', 'k1:k1:', 'k2:a', 'a']) expect(refused).toContain(reached)
  })

  // The reverse direction, over keys built from the same troublesome pieces in
  // every arity up to three: nothing the encoder emits is refused by the decoder.
  test('every token the encoder emits decodes to its key', () => {
    const parts = ['', 'a', ',', '~', ':', 'k1:', '~002C', 'ü', '😀', ' ']
    for (const first of parts) {
      for (const second of parts) {
        for (const key of [[first], [first, second], [first, second, first]]) expect(values(token(key))).toEqual(key)
      }
    }
  })
})
