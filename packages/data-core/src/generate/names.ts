import { schemaHash } from '@formancy/spec'
import type { ObjectRef } from '../metadata.js'

/**
 * CEL's reserved words, and the key formancy reserves for a repeater row.
 *
 * A field key becomes a variable in logic expressions, so a column called `in`
 * or `null` would make a field no rule could ever refer to. `_id` is refused
 * by formancy's validator outright.
 */
const RESERVED = new Set([
  '_id',
  'as',
  'break',
  'const',
  'continue',
  'else',
  'false',
  'for',
  'function',
  'if',
  'import',
  'in',
  'let',
  'loop',
  'namespace',
  'null',
  'package',
  'return',
  'true',
  'var',
  'void',
  'while',
])

/** formancy's key rule: a letter or underscore, then letters, digits or underscores, at most 64. */
const KEY_LENGTH = 64

/** A field key for a column or relationship name, before collisions are resolved. */
export function fieldKeyFor(name: string): string {
  let key = name.replaceAll(/[^A-Za-z0-9_]/g, '_')
  if (key === '' || /^[0-9]/.test(key)) key = `_${key}`
  if (RESERVED.has(key)) key = `${key}_`
  return key.slice(0, KEY_LENGTH)
}

/**
 * Hands out keys so that no two fields share one.
 *
 * Two columns can sanitise to the same key — `Order Date` and `order_date` —
 * and a relationship can want a key a column already has. The second one asks
 * gets `_2`, then `_3`, in the order fields are generated, which is the
 * columns' catalog order, so the result is the same every time.
 */
export function createKeyAllocator(): (wanted: string) => string {
  const taken = new Set<string>()
  return (wanted) => {
    let key = wanted
    for (let suffix = 2; taken.has(key); suffix += 1) {
      const tail = `_${String(suffix)}`
      key = `${wanted.slice(0, KEY_LENGTH - tail.length)}${tail}`
    }
    taken.add(key)
    return key
  }
}

/** formancy's option-source rule: lower case, digits and hyphens, starting with a letter, at most 64. */
const SOURCE_LENGTH = 64

/**
 * The option-source name for a lookup.
 *
 * Unique per deployment, because that is where it is resolved: the connection,
 * the schema, the table and the constraint together name exactly one
 * relationship. A name that would be longer than formancy allows keeps its
 * readable start and ends in a hash of the whole, so two long names that share
 * a prefix still differ.
 */
export function sourceNameFor(connection: string, root: ObjectRef, foreignKey: string): string {
  const raw = `${connection}-${root.schema}-${root.name}-${foreignKey}`
  let name = raw
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
  if (!/^[a-z]/.test(name)) name = `s-${name}`
  if (name.length <= SOURCE_LENGTH) return name
  const hash = schemaHash(raw).slice(0, 8)
  return `${name.slice(0, SOURCE_LENGTH - hash.length - 1).replace(/-+$/, '')}-${hash}`
}

/**
 * A label from an identifier: `customer_no` reads "Customer no", `createdAt`
 * reads "Created at". A starting point for a person or the optional AI pass to
 * improve, and marked as inferred in the notes for that reason.
 */
export function labelFor(name: string): string {
  const words = name
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase())
  const text = words.join(' ')
  return text === '' ? name : `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}
