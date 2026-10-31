// The addresses a page and its stylesheets name, read as a browser reads
// them: every `src` and `href` of the markup however it is quoted, the
// stylesheets it links, and every `url()` and `@import` of a stylesheet.
//
// One reader for the checks that ask where a page loads from -- the demo's
// policy (scripts/demo-headers.mjs), the faces a build carries
// (scripts/fonts.mjs), the getting-started gate's page check and the static
// guard that no page names another host (0072) -- so that two of them never
// read one page two ways. Node built-ins only: the getting-started gate
// imports it from a checkout with nothing installed.

/**
 * An attribute as HTML writes it: a name, and a value double-quoted,
 * single-quoted or unquoted, or none.
 */
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

/**
 * Each `tag` element of `html` (a pattern), as its attributes: lowercased
 * names, `true` for one with no value. A `>` inside a quoted value does not
 * end the tag.
 */
export function elements(html, tag) {
  return [...html.matchAll(new RegExp(`<${tag}\\b((?:[^>"']|"[^"]*"|'[^']*')*)>`, 'gi'))].map((match) =>
    Object.fromEntries([...match[1].matchAll(ATTRIBUTE)].map(([, name, double, single, bare]) => [name.toLowerCase(), double ?? single ?? bare ?? true])),
  )
}

/** Every `src` and `href` of every element of `html`, as `{ name, value }`, in order. */
export function references(html) {
  return elements(html, '[a-z][\\w-]*').flatMap((attributes) =>
    ['src', 'href'].filter((name) => typeof attributes[name] === 'string').map((name) => ({ name, value: attributes[name] })),
  )
}

/** The words of a link's `rel`, lowercased. */
export const rel = (attributes) =>
  String(attributes.rel ?? '')
    .toLowerCase()
    .split(/\s+/)

/** The `href` of every `<link rel="stylesheet">` of `html`, as written, in order. */
export function stylesheetLinks(html) {
  return elements(html, 'link')
    .filter((attributes) => rel(attributes).includes('stylesheet') && typeof attributes.href === 'string')
    .map((attributes) => attributes.href)
}

/** `value` resolved as the page at `address` resolves it, or null for one that is no URL. */
export function resolved(value, address) {
  try {
    return new URL(value, address)
  } catch {
    return null
  }
}

/** The address of every `@import` of a stylesheet, quoted or as a `url()`, as written. */
export function styleImports(css) {
  return [...css.matchAll(/@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"([^"]*)"|'([^']*)')/gi)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5],
  )
}

/** Every `url(...)` and quoted `@import` of a stylesheet, as written. */
export function styleReferences(css) {
  const found = []
  for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi)) found.push(match[1] ?? match[2] ?? match[3])
  for (const match of css.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi)) found.push(match[1] ?? match[2])
  return found
}
