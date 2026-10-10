/*
 * How a number is printed on the performance page (0034): the same text for
 * the same value on every machine, in every locale and time zone. Node
 * built-ins only, so the repository's guards render the page without a build.
 */

/** A whole number with a comma between each group of three digits, by a fixed function, not `toLocaleString`. */
export function grouped(value: number): string {
  if (!Number.isSafeInteger(value)) throw new Error(`grouped takes a whole number, not ${String(value)}`)
  if (value < 0) return `-${grouped(-value)}`
  const digits = String(value)
  let text = ''
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) text += ','
    text += digits[i] as string
  }
  return text
}

/**
 * A measured value: `0`; `<0.001` below a thousandth; three significant
 * figures while they round below 1,000 (0.412, 4.12, 41.2, 412), where
 * `toPrecision` never writes an exponent; and from 1,000 a whole number with
 * commas: 999.4 is 999, 999.5 is 1,000, 1234 is 1,234.
 */
export function figure(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`a figure is a finite number, not ${String(value)}`)
  if (value === 0) return '0'
  if (value < 0) return `-${figure(-value)}`
  if (value < 0.001) return '<0.001'
  if (Number(value.toPrecision(3)) < 1000) return value.toPrecision(3)
  return grouped(Math.round(value))
}

/** A configured value: a whole number as written, with commas; anything else as a figure. */
export function setting(value: number): string {
  return Number.isSafeInteger(value) ? grouped(value) : figure(value)
}

/**
 * Bytes with the exact count beside them: `152.0 MiB (159,383,552 bytes)`,
 * below a MiB `44.6 KiB (45,626 bytes)`, below a KiB the count alone.
 */
export function bytes(value: number): string {
  if (value < 1024) return `${grouped(value)} bytes`
  if (value < 1_048_576) return `${(value / 1024).toFixed(1)} KiB (${grouped(value)} bytes)`
  return `${(value / 1_048_576).toFixed(1)} MiB (${grouped(value)} bytes)`
}
