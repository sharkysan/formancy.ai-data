/**
 * The string a formancy `select` stores for a database-backed lookup: one
 * referenced key, every column of it, in one token.
 *
 * A composite key is several values and a select stores one string, so the
 * values have to be joined — and a naive join is ambiguous: `['a,b']` and
 * `['a', 'b']` joined by a comma are the same string, and a save would
 * reference whichever row the database found first. This encoding is
 * unambiguous for every input and has exactly one spelling per key, so two
 * tokens can be compared as strings.
 *
 * ```
 * token   = "k1:" value *( "," value )
 * value   = *( literal / escape )
 * literal = A-Z / a-z / 0-9 / "-" / "." / "_"
 * escape  = "~" 4( 0-9 / A-F )      ; one UTF-16 unit, upper-case hex
 * ```
 *
 * Every other character is escaped, so a token is printable ASCII: one length
 * in bytes, UTF-16 units and code points, nothing invisible, no bidi control
 * that could make an archive view lie, and nothing a URL or a log needs to
 * escape again. Integers, decimals, UUIDs and plain codes read as themselves.
 *
 * A token is a REFERENCE and never a permission (0012). It says which row was
 * meant; whether the person may reference that row is decided again, on the
 * server, every time it is used.
 */

/** formancy stores a select's answer in 1 to 200 characters (`acceptRemoteOptions`); the tests hold this to it. */
export const KEY_TOKEN_MAX_LENGTH = 200

/** The version prefix. A decoder keeps reading `k1:` for as long as a stored answer can hold one. */
const PREFIX = 'k1:'
const SEPARATOR = ','
const ESCAPE = '~'
/** `~` and four hex digits. */
const ESCAPE_LENGTH = 5
const HEX4 = /^[0-9A-F]{4}$/
/** A prefix that looks like a version: `k`, digits, a colon. Anchored at the start and nowhere else. */
const VERSIONED = /^k[0-9]+:/
/** A UTF-16 surrogate without its pair. In `u` mode a paired one is a single astral code point and does not match. */
const LONE_SURROGATE = /\p{Cs}/u

export type KeyTokenErrorCode =
  /** encode: a key with no columns. */
  | 'empty-key'
  /** encode: a value that is not a string; decode: a token that is not a string. */
  | 'not-text'
  /** A value holding an unpaired UTF-16 surrogate, given or decoded. */
  | 'ill-formed-text'
  /** Longer than formancy stores. */
  | 'too-long'
  /** decode: no version prefix at all. */
  | 'not-a-token'
  /** decode: a version prefix this release does not read. */
  | 'unsupported-version'
  /** decode: a character or escape the encoder would never have written. */
  | 'malformed'

export interface KeyTokenRefusal {
  ok: false
  code: KeyTokenErrorCode
  /** A sentence for an operator. It never echoes a character of the input, only its position and code. */
  message: string
}

export type KeyTokenEncoding = { ok: true; token: string } | KeyTokenRefusal
export type KeyTokenDecoding = { ok: true; values: string[] } | KeyTokenRefusal

function refuse(code: KeyTokenErrorCode, message: string): KeyTokenRefusal {
  return { ok: false, code, message }
}

/** Whether a UTF-16 unit is written as itself. */
function isLiteral(unit: number): boolean {
  return (
    (unit >= 0x30 && unit <= 0x39) || // 0-9
    (unit >= 0x41 && unit <= 0x5a) || // A-Z
    (unit >= 0x61 && unit <= 0x7a) || // a-z
    unit === 0x2d || // -
    unit === 0x2e || // .
    unit === 0x5f // _
  )
}

function hex(unit: number): string {
  return unit.toString(16).toUpperCase().padStart(4, '0')
}

function escapeValue(value: string): string {
  let out = ''
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    out += isLiteral(unit) ? value.charAt(index) : `${ESCAPE}${hex(unit)}`
  }
  return out
}

/**
 * The token for a key: each column's canonical API string — a decimal string
 * for a number, the text itself for text — in the key's column order.
 *
 * Refuses rather than truncates. A key whose token would exceed what formancy
 * stores cannot be offered at all, and a shortened token would name a
 * different key, or none.
 */
export function encodeKeyToken(values: readonly string[]): KeyTokenEncoding {
  if (!Array.isArray(values)) return refuse('not-text', 'A key is a list of column values.')
  if (values.length === 0) return refuse('empty-key', 'A key has at least one column, and this one has none.')

  // Measured before anything is built, so an oversized value costs a count and not a copy.
  let length = PREFIX.length + values.length - 1
  for (const [index, value] of values.entries()) {
    const position = String(index + 1)
    if (typeof value !== 'string') {
      return refuse('not-text', `Key value ${position} is not text; a token carries each column's canonical string.`)
    }
    if (LONE_SURROGATE.test(value)) {
      return refuse(
        'ill-formed-text',
        `Key value ${position} holds an unpaired UTF-16 surrogate, which PostgreSQL cannot store and UTF-8 cannot carry.`,
      )
    }
    for (let unit = 0; unit < value.length; unit += 1) length += isLiteral(value.charCodeAt(unit)) ? 1 : ESCAPE_LENGTH
  }
  if (length > KEY_TOKEN_MAX_LENGTH) {
    return refuse(
      'too-long',
      `This key needs ${String(length)} characters as a token, and formancy stores a select's answer in at most ${String(KEY_TOKEN_MAX_LENGTH)}. It is refused rather than truncated.`,
    )
  }

  return { ok: true, token: `${PREFIX}${values.map(escapeValue).join(SEPARATOR)}` }
}

/**
 * The key a token names, read strictly: anything the encoder would have
 * spelled differently is refused, so every token this accepts is the one
 * `encodeKeyToken` produces for its key, and two tokens that differ never
 * name the same key.
 *
 * A token arrives from a browser, so this is a parser of untrusted input. It
 * refuses an oversized token before reading it, and its messages give a
 * position and a code unit, never a character from the input.
 */
export function decodeKeyToken(token: string): KeyTokenDecoding {
  if (typeof token !== 'string') return refuse('not-text', 'A key token is a string.')
  if (token.length > KEY_TOKEN_MAX_LENGTH) {
    return refuse('too-long', `A key token is at most ${String(KEY_TOKEN_MAX_LENGTH)} characters, and this one has ${String(token.length)}.`)
  }
  if (!token.startsWith(PREFIX)) {
    return VERSIONED.test(token)
      ? refuse('unsupported-version', 'This key token is from a version of the encoding this release does not read.')
      : refuse('not-a-token', `This is not a key token: it does not start with ${PREFIX}`)
  }

  const values: string[] = []
  let current = ''
  for (let index = PREFIX.length; index < token.length; index += 1) {
    const unit = token.charCodeAt(index)
    const position = String(index + 1)
    if (token.charAt(index) === SEPARATOR) {
      values.push(current)
      current = ''
    } else if (isLiteral(unit)) {
      current += token.charAt(index)
    } else if (token.charAt(index) === ESCAPE) {
      const digits = token.slice(index + 1, index + ESCAPE_LENGTH)
      if (!HEX4.test(digits)) {
        return refuse('malformed', `The escape at position ${position} is not ~ followed by four upper-case hex digits.`)
      }
      const escaped = Number.parseInt(digits, 16)
      if (isLiteral(escaped)) {
        return refuse('malformed', `The escape at position ${position} spells U+${digits}, which a token writes as itself.`)
      }
      current += String.fromCharCode(escaped)
      index += ESCAPE_LENGTH - 1
    } else {
      return refuse('malformed', `U+${hex(unit)} at position ${position} is not part of a key token.`)
    }
  }
  values.push(current)

  for (const [index, value] of values.entries()) {
    if (LONE_SURROGATE.test(value)) {
      return refuse('ill-formed-text', `Key value ${String(index + 1)} decodes to an unpaired UTF-16 surrogate.`)
    }
  }
  return { ok: true, values }
}
