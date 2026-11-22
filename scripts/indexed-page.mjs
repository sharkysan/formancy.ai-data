// What a page tells a search engine (0177).
//
// Every app's index.html asks to be left out of the index, and so does
// every build of it, because a build is served wherever somebody runs it:
// in an operator's composed stack, by `pnpm demo` or a preview, by a gate
// on a loopback address. The examples page and the live demo are the
// module's only public pages, each built for one address on formancy.ai
// and served at no other, and the deploy that puts a build there is the
// one place that knows the address. So the deploy alone writes the page
// that asks to be indexed: without the robots meta, with its description
// -- the build's own, or the one the deploy gives -- and naming that
// address as the page's canonical one. A browser fetches neither a
// description nor a canonical link, so what the browser gates measured of
// the build is what a visitor is sent.
//
// Node built-ins only, through scripts/addresses.mjs, the one reader of a
// page's markup.

import { rel, tags } from './addresses.mjs'

/** An attribute's value as HTML writes it between double quotes. */
const escaped = (value) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** An attribute's value as written, with what `escaped` writes read back. */
const unescaped = (value) => value.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')

/** The `<meta>` elements of `html` whose name is `name`. */
const metas = (html, name) => tags(html, 'meta').filter(({ attributes }) => String(attributes.name ?? '').toLowerCase() === name)

/** What each robots meta of `html` says, in order. */
export const robotsOf = (html) => metas(html, 'robots').map(({ attributes }) => String(attributes.content ?? ''))

/** The address each canonical link of `html` names, in order. */
export const canonicalsOf = (html) =>
  tags(html, 'link')
    .filter(({ attributes }) => rel(attributes).includes('canonical'))
    .map(({ attributes }) => String(attributes.href ?? ''))

/** What the description meta of `html` says, or undefined where it has none. */
export function descriptionOf(html) {
  const [first] = metas(html, 'description')
  return first === undefined ? undefined : unescaped(String(first.attributes.content ?? ''))
}

/** `html` without `element`, and without its line where nothing else is on it. */
function without(html, { index, text }) {
  const start = html.lastIndexOf('\n', index - 1) + 1
  const end = index + text.length
  const next = html.indexOf('\n', end)
  const stop = next === -1 ? html.length : next + 1
  const alone = html.slice(start, index).trim() === '' && html.slice(end, stop).trim() === ''
  return alone ? html.slice(0, start) + html.slice(stop) : html.slice(0, index) + html.slice(end)
}

/**
 * The built page `html` as it is served at `address`, which is the only
 * place it is served: the one `<meta name="robots" content="noindex">`
 * every page's source carries gone with its line, the description meta
 * kept -- or written with `description` where one is given -- and a
 * `<link rel="canonical">` naming `address` on the line after it. Nothing
 * else of the page changes. Throws, with a sentence, on a head that is not
 * the one every source writes -- no such robots meta or more than one, a
 * robots meta that says more, no description or two, a canonical link
 * already -- and on an address that is not https as a browser writes it,
 * which a search engine would take for another page.
 */
export function indexedPage(html, { address, description }) {
  let url
  try {
    url = new URL(address)
  } catch {
    url = undefined
  }
  if (url?.protocol !== 'https:' || url.href !== address || url.hash !== '')
    throw new Error(`${String(address)} is not an https address as a browser writes it, which a canonical link names as given`)
  const robots = metas(html, 'robots')
  if (robots.length !== 1 || robots[0].attributes.content !== 'noindex')
    throw new Error(
      `the page has ${robots.map(({ text }) => text).join(', ') || 'no robots meta'}, and the deploy drops exactly one <meta name="robots" content="noindex">, which every page's source carries`,
    )
  const described = metas(html, 'description')
  if (described.length !== 1)
    throw new Error(
      `the page has ${String(described.length)} description metas, and the deploy keeps or writes exactly one <meta name="description">, which a search shows`,
    )
  if (canonicalsOf(html).length > 0)
    throw new Error('the page names a canonical address already, and the deploy names the one it is served at, so a search engine would have two')
  const [kept] = described
  const indent = /[ \t]*$/.exec(html.slice(0, kept.index))?.[0] ?? ''
  const meta = description === undefined ? kept.text : `<meta name="description" content="${escaped(description)}" />`
  const head = `${meta}\n${indent}<link rel="canonical" href="${escaped(address)}" />`
  const edits = [
    { index: robots[0].index, apply: (text) => without(text, robots[0]) },
    { index: kept.index, apply: (text) => text.slice(0, kept.index) + head + text.slice(kept.index + kept.text.length) },
  ]
  // The later edit first, so the earlier one's place is still where it was.
  return edits.sort((a, b) => b.index - a.index).reduce((text, edit) => edit.apply(text), html)
}
