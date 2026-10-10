// What a README picture's parts say, read back from the text the record holds
// (0038): Playwright's accessibility snapshot, `locator.ariaSnapshot()`.
//
// That text is YAML, written by Playwright's renderAriaSnapshotAsYaml
// (playwright-core 1.63.0, lib/coreBundle.js, with yamlEscapeKeyIfNeeded and
// yamlEscapeValueIfNeeded above it). One line per node:
//
//   - <key>            a node with nothing to say
//   - <key>: <value>   a node and its text
//   - <key>:           a node whose children follow, indented by two
//
// where <key> is `text`, a property (`/url`, `/placeholder`), or a role with
// an optional name and attributes: `button "Save" [disabled]`. The name is
// JSON.stringify's output. The whole key is single-quoted when YAML needs it
// (a ": " inside, say), with '' standing for '. A value is plain, or
// double-quoted with \\ \" \b \f \n \r \t and \xHH.
//
// Decoded here, so a caption's quote is matched against what a person reads
// and not against the escaping. Node only, no import, and pure: the camera
// checks quotes through it before it writes, and readme.test.mjs after.

const LINE = /^((?: {2})*)- (.*)$/
/**
 * A role, then a JSON string or a name Playwright writes as it is because it
 * starts and ends with a slash (a lone "/" too), then attributes such as
 * [level=2] or [checked=mixed].
 */
const KEY = /^([a-z][a-z-]*)(?: ("(?:[^"\\]|\\.)*"|\/(?:.*\/)?))?((?: \[[a-z-]+(?:=[^\]]*)?\])*)$/
const PROPERTY = /^\/[a-z]+$/
const QUOTED = /^"((?:[^"\\]|\\.)*)"$/

class Unreadable extends Error {}

/** A single-quoted key: the text between the quotes with '' made ', and what follows the closing quote. */
function singleQuoted(rest) {
  let key = ''
  for (let index = 1; index < rest.length; index += 1) {
    if (rest[index] !== "'") {
      key += rest[index]
      continue
    }
    if (rest[index + 1] === "'") {
      key += "'"
      index += 1
      continue
    }
    return { key, after: rest.slice(index + 1) }
  }
  throw new Unreadable('the quoted key is never closed')
}

/** A double-quoted value: JSON's escapes, and Playwright's \xHH, which JSON does not know. */
function value(text) {
  if (!text.startsWith('"')) return text
  const quoted = QUOTED.exec(text)
  if (quoted === null) throw new Unreadable('the quoted value is never closed')
  // One escape at a time, so the "x41" of an escaped backslash followed by x41 stays text.
  const json = quoted[1].replace(/\\(x([0-9a-fA-F]{2})|[\s\S])/g, (whole, escape, hex) => (hex === undefined ? whole : `\\u00${hex}`))
  return JSON.parse(`"${json}"`)
}

function line(text, depth) {
  let key
  let after
  if (text.startsWith("'")) ({ key, after } = singleQuoted(text))
  else {
    // An unquoted key holds no ": " and does not end in ":", or YAML would have quoted it.
    const colon = text.indexOf(': ')
    if (colon !== -1) [key, after] = [text.slice(0, colon), text.slice(colon)]
    else if (text.endsWith(':')) [key, after] = [text.slice(0, -1), ':']
    else [key, after] = [text, '']
  }
  let said
  if (after === ':' || after === '') said = undefined
  else if (after.startsWith(': ')) said = value(after.slice(2))
  else throw new Unreadable('the key is followed by something that is not a value')

  if (key === 'text' || PROPERTY.test(key)) return { depth, role: key, name: undefined, value: said }
  const parsed = KEY.exec(key)
  if (parsed === null) throw new Unreadable('the key is not a role, a name and attributes')
  const [, role, name] = parsed
  return { depth, role, name: name === undefined ? undefined : name.startsWith('"') ? JSON.parse(name) : name, value: said }
}

/**
 * Every line of `snapshot`, decoded: its depth, its role (`text` for text,
 * `/url` for a property), its name and its value, each undefined where the
 * line has none. Throws a sentence naming the line for one it cannot read,
 * never skipping it.
 */
export function decode(snapshot) {
  return snapshot
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map((text, index) => {
      try {
        const parsed = LINE.exec(text)
        if (parsed === null) throw new Unreadable('it does not start with "- " at an even indentation')
        return line(parsed[2], parsed[1].length / 2)
      } catch (error) {
        if (!(error instanceof Unreadable) && !(error instanceof SyntaxError)) throw error
        throw new Error(`line ${String(index + 1)} is not an accessibility snapshot line: ${error.message}`)
      }
    })
}

/** Whether `quote` is a run inside one decoded name or value of `snapshot`: what one element says, not two read together. */
export function occursIn(quote, snapshot) {
  return decode(snapshot).some((entry) => [entry.name, entry.value].some((text) => typeof text === 'string' && text.includes(quote)))
}

/** Every decoded name and value of `snapshot`, in order: what the camera searches for a secret. */
export function strings(snapshot) {
  return decode(snapshot).flatMap((entry) => [entry.name, entry.value].filter((text) => typeof text === 'string'))
}
