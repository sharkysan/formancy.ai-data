/**
 * Exact numbers, as strings, never through a JavaScript number.
 *
 * A JSON number is parsed into a double before anything here sees it, and a
 * double holds fifteen to seventeen significant digits. `numeric(18,4)` holds
 * eighteen, and `bigint` nineteen. So decimals are accepted only as strings,
 * and integers as numbers only while they are safe integers.
 */

export type NumberOutcome = { ok: true; value: string } | { ok: false; code: string; message: string }

/**
 * What the generated form's pattern accepts, and a little more: optional sign,
 * digits, an optional fraction, and the two shapes `.5` and `12.` a person
 * types. Never an exponent, a plus sign, whitespace or a thousands separator.
 *
 * The codec must accept everything the browser accepted — or the server would
 * refuse what the form let through — and may accept more, because the browser
 * refuses first.
 */
const DECIMAL = /^(-?)([0-9]*)(?:\.([0-9]*))?$/

/**
 * A decimal string, canonicalised for a column of this precision and scale.
 *
 * Canonical means what the database returns when it is read back: no leading
 * zeros, no negative zero, and the fraction padded to the column's scale, so
 * `12.5` written to `numeric(14,2)` is `12.50` — the same string a later read
 * produces, and not a change a review screen would show.
 *
 * Never rounds. A fractional digit beyond the scale is refused: rounding is a
 * business rule, and silently applying one is how a ledger stops balancing.
 */
export function parseDecimal(text: string, precision: number | null, scale: number | null): NumberOutcome {
  const match = DECIMAL.exec(text)
  const [, sign = '', whole = '', fraction = ''] = match ?? []
  if (match === null || (whole === '' && fraction === '')) {
    return { ok: false, code: 'not-a-decimal', message: 'Enter a number such as 1234.56, without spaces, signs other than a leading minus, or exponents.' }
  }

  const digits = whole.replace(/^0+/, '')
  if (scale !== null && fraction.length > scale) {
    return { ok: false, code: 'too-many-fraction-digits', message: `At most ${String(scale)} digits after the decimal point.` }
  }
  // An unconstrained numeric keeps the scale it was given, as PostgreSQL does;
  // a constrained one is padded to its scale, as both engines return it.
  const fractionDigits = scale === null ? fraction : fraction.padEnd(scale, '0')

  if (precision !== null) {
    const allowed = precision - (scale ?? 0)
    if (digits.length > allowed) {
      return { ok: false, code: 'too-many-integer-digits', message: `At most ${String(allowed)} digits before the decimal point.` }
    }
  }

  const integerPart = digits === '' ? '0' : digits
  const isZero = /^0*$/.test(integerPart) && /^0*$/.test(fractionDigits)
  const body = fractionDigits === '' ? integerPart : `${integerPart}.${fractionDigits}`
  return { ok: true, value: isZero ? body : `${sign}${body}` }
}

/** A canonical integer string: no leading zeros, no plus, no negative zero. */
const INTEGER = /^-?(0|[1-9][0-9]*)$/

/**
 * An integer within the column's range, given as a number or a string.
 *
 * A number is accepted only if it is a safe integer: past 2^53 a number has
 * already been rounded by JSON.parse, so it is not the value the client meant.
 * A string is accepted in canonical form only, and compared with BigInt.
 */
export function parseInteger(value: number | string, min: string, max: string): NumberOutcome {
  let text: string
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      return {
        ok: false,
        code: 'not-an-integer',
        message: Number.isInteger(value)
          ? 'This number is too large to send as a JSON number without losing digits; send it as a string.'
          : 'Enter a whole number.',
      }
    }
    // -0 is a JavaScript artefact, not a different integer.
    text = String(value === 0 ? 0 : value)
  } else {
    if (!INTEGER.test(value) || value === '-0') {
      return { ok: false, code: 'not-an-integer', message: 'Enter a whole number, without spaces, a plus sign, leading zeros or a decimal point.' }
    }
    text = value
  }
  const big = BigInt(text)
  if (big < BigInt(min) || big > BigInt(max)) {
    return { ok: false, code: 'out-of-range', message: `Enter a whole number from ${min} to ${max}.` }
  }
  return { ok: true, value: text }
}
