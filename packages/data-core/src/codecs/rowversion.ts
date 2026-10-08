/**
 * A concurrency token as text: the 8 bytes of a SQL Server `rowversion`, or
 * the decimal string of an application-maintained version column.
 *
 * Hex for rowversion, lower case, sixteen characters. Not base64: base64 has
 * two alphabets and padding, so one value has several spellings and a
 * comparison of tokens as strings would sometimes say "changed" when nothing
 * did. Hex has exactly one spelling per value.
 */
const ROWVERSION = /^[0-9a-f]{16}$/

export function encodeRowversion(bytes: Uint8Array): string {
  if (bytes.length !== 8) throw new Error(`a rowversion is 8 bytes, not ${String(bytes.length)}`)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The 8 bytes behind a token, or `undefined` for anything that is not exactly one. */
export function decodeRowversion(token: string): Uint8Array | undefined {
  if (!ROWVERSION.test(token)) return undefined
  const bytes = new Uint8Array(8)
  for (let index = 0; index < 8; index += 1) bytes[index] = Number.parseInt(token.slice(index * 2, index * 2 + 2), 16)
  return bytes
}
