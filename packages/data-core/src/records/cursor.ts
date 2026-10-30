import type { ApiValue } from '../codecs/codec.js'
import { decodeKey, encodeKey } from '../lookup/token.js'
import type { KeySpelling } from '../lookup/token.js'
import { identityKey, keyText } from './token.js'
import type { RecordKeyDecoding } from './token.js'
import type { RecordColumn } from './types.js'

/*
 * A list's cursor (0108): the key of the last row a page showed, which the
 * next page continues after. Spelled as a record token is (0012) -- one
 * grammar, so no value has two spellings -- under a prefix of its own, so a
 * cursor is never read as a token, nor a token as a cursor.
 *
 * Without a select's bound of 200 characters: every row a page shows is one
 * the next page may have to continue after, a row whose key is too long for
 * a token included. A cursor has no bound of its own; it travels in a
 * request body, which the server bounds at a megabyte.
 *
 * Like a token it is a reference and never a permission. The page it asks
 * for finds that row again under the person's read filter and every
 * through, in the page's own statement, and a cursor naming a row they may
 * not read is answered as one naming a row that is gone.
 */

const CURSOR: KeySpelling = {
  prefix: 'c1:',
  maxLength: Number.POSITIVE_INFINITY,
  versioned: /^c[0-9]+:/,
  name: 'list cursor',
  tooLong: () => 'A list cursor has no bound of its own.',
}

/**
 * The cursor of the row whose values these are: its identity values as a
 * read returned them, spelled. Thrown, never refused: `listable` lists only a
 * form whose key a row holds NOT NULL, so a row without its key is an
 * adapter that read it wrongly.
 */
export function listCursor(identity: readonly string[], values: Readonly<Record<string, ApiValue>>): string {
  const key = keyText(identity, values)
  if (!key.ok) throw new Error(`A listed row has no key to continue after: ${key.message}`)
  const encoded = encodeKey(CURSOR, key.values)
  if (!encoded.ok) throw new Error(`A listed row's key cannot be a cursor: ${encoded.message}`)
  return encoded.token
}

/** The key a cursor names, each value spelled as its identity column holds it -- as `decodeRecordKey` reads a token -- or why not. */
export function decodeListCursor(identity: readonly RecordColumn[], cursor: string): RecordKeyDecoding {
  return identityKey(identity, () => decodeKey(CURSOR, cursor))
}
