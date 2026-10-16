// The headers the examples page is served with on formancy.ai (0069), in
// one place: scripts/demo.mjs writes them as the `_headers` file Workers
// Static Assets read from the root of the assets directory, and the
// examples page's browser gate serves the page with the same file's text,
// parsed back. So the policy every browser check ran under is the one the
// deploy uploads, and neither can be edited without the other.
//
// From Cloudflare's documentation of the file, re-read on 2026-10-16
// (developers.cloudflare.com/workers/static-assets/headers/): a rule is a
// path on a line of its own, its headers indented below it as `Name: value`;
// `#` starts a comment; a `*` matches greedily, once per path; a request
// takes the headers of every rule whose path matches it, and one header
// named by two rules is joined with a comma; at most 100 rules, 2,000
// characters a line. The file itself is not served. "Headers defined in the
// `_headers` file override what Cloudflare ordinarily sends", and what it
// ordinarily sends includes a `Content-Type` Wrangler picks by the file's
// extension. The page does not say whether the rules reach a redirect the
// assets make of a path without its slash, or a 404.
//
// Measured on 2026-10-16, with no `_headers` in play: Workers static assets
// sent formancy.ai/report/THIRD-PARTY-NOTICES.txt as `Content-Type:
// text/plain`, with no charset. And read by hand at formancy.ai/data/examples/
// once the demo was live, the same day, with curl: the page came with the
// policy and its companions, the notices `text/plain; charset=utf-8` with
// them and Cloudflare's revalidating cache, a hashed chunk with the year's
// cache, a missing file's 404 with the policy and its companions, and the
// redirect of the path without its slash with none of them;
// scripts/demo-serve.mjs answers the redirect and a 404 as they were read.
// Nothing here reads what formancy.ai answers again: the gate holds the page
// to these headers as this module reads the file.

import { elements, rel, resolved, stylesheetLinks } from './addresses.mjs'
import { NOTICES_FILE } from './third-party-notices.mjs'

/**
 * The Content-Security-Policy, directive by directive. Each source is one
 * the built page uses, and policyProblems holds the hosts to what
 * index.html loads.
 *
 * `'self'` is formancy.ai's whole origin -- its site, its playground, the
 * report's Studio at /report/ and whatever is routed there later -- and not
 * this page's path: a source with a path would hold it to /data/examples/,
 * but the gate serves the page from 127.0.0.1, where such a policy would
 * refuse every file and could not be measured.
 */
export const POLICY = Object.freeze({
  // Anything a directive below does not name -- a frame, a worker, media, a
  // manifest -- the page has none of, so nothing.
  'default-src': ["'none'"],
  // The built chunks, from formancy.ai's origin, and nothing inline and
  // nothing evaluated. React needs neither, and Angular is compiled ahead of
  // time by the analog plugin, so no JIT compiler is bundled and nothing
  // builds a function from a string; the browser gate fails on every
  // violation the page reports.
  'script-src': ["'self'"],
  // The built stylesheet, from formancy.ai's origin, and Google Fonts'
  // stylesheet, which index.html links. No inline style: React and Angular
  // set a style through the CSSOM, which this directive does not govern, and
  // the page carries no style attribute or element.
  'style-src': ["'self'", 'https://fonts.googleapis.com'],
  // The font files Google's stylesheet names, from the host index.html
  // preconnects to for them.
  'font-src': ['https://fonts.gstatic.com'],
  // The page loads no image. The Blueprint theme draws the date and time
  // fields' icons as data: SVGs where Safari on a touch device draws no
  // picker icon of its own, and index.html's icon is `data:,`.
  'img-src': ['data:'],
  // The page fetches nothing: the snapshot is in the build. Vite's preload
  // fetches the Angular chunk from formancy.ai's origin in a browser without
  // modulepreload.
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  // The previews' forms validate in the page and are never sent anywhere.
  'form-action': ["'none'"],
  'frame-ancestors': ["'none'"],
})

/** The policy as the header's value. */
export const contentSecurityPolicy = (policy = POLICY) =>
  Object.entries(policy)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ')

/**
 * Every feature the page does not use, denied to it and to anything it
 * could embed. Only names Chromium recognises on every platform the gate
 * runs on: an unknown one is a console message on every load, which the gate
 * counts. `bluetooth` is not among them: Chromium 153 on Linux, in CI on
 * 2026-10-16, said "Unrecognized feature: 'bluetooth'" where Windows' did not.
 */
export const DENIED_FEATURES = Object.freeze([
  'accelerometer',
  'autoplay',
  'browsing-topics',
  'camera',
  'display-capture',
  'encrypted-media',
  'fullscreen',
  'geolocation',
  'gyroscope',
  'hid',
  'idle-detection',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'picture-in-picture',
  'publickey-credentials-get',
  'screen-wake-lock',
  'serial',
  'usb',
  'xr-spatial-tracking',
])

/** Where Vite writes every file it names with a hash of its content. */
export const HASHED = 'assets/'

/** A year, and never revalidated: right only for a name that changes with its content. */
export const LONG_CACHE = 'public, max-age=31536000, immutable'

/**
 * What the notices are sent as: text that says it is UTF-8, as 0046 serves
 * them from the web image. Cloudflare sends a `.txt` as bare `text/plain`,
 * whose encoding a browser guesses, and the examples page's notices are not
 * ASCII -- a bundled MIT text quotes the “Software” in curly quotes.
 */
export const NOTICES_TYPE = 'text/plain; charset=utf-8'

/**
 * The rules, for the page served under `base` (`/data/examples/`): every
 * file under it gets the policy and its companions, the hashed chunks a
 * year's cache, and the notices their encoding. The page itself keeps
 * Cloudflare's default cache, revalidated on every load, so a deploy is
 * seen at once.
 */
export function headerRules(base) {
  return [
    {
      path: `${base}*`,
      headers: {
        'Content-Security-Policy': contentSecurityPolicy(),
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': DENIED_FEATURES.map((feature) => `${feature}=()`).join(', '),
      },
    },
    { path: `${base}${HASHED}*`, headers: { 'Cache-Control': LONG_CACHE } },
    { path: `${base}${NOTICES_FILE}`, headers: { 'Content-Type': NOTICES_TYPE } },
  ]
}

/** The rules as a `_headers` file. */
export function headersFile(rules) {
  const lines = ['# Written by scripts/demo.mjs from scripts/demo-headers.mjs (0069).']
  for (const { path, headers } of rules) {
    lines.push('', path, ...Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`))
  }
  return `${lines.join('\n')}\n`
}

/** A `_headers` file's rules, as Cloudflare's documentation describes the format. */
export function parseHeadersFile(text) {
  const rules = []
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      rules.push({ path: line.trim(), headers: {} })
      continue
    }
    const at = line.indexOf(':')
    if (rules.length === 0 || at === -1) throw new Error(`not a header under a path: ${line}`)
    rules.at(-1).headers[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return rules
}

/** A rule's path as a pattern: one greedy splat, and no placeholder, which these rules never use. */
function pattern(path) {
  if (/:[A-Za-z_]/.test(path)) throw new Error(`${path} has a placeholder, which this module does not model`)
  if ((path.match(/\*/g) ?? []).length > 1) throw new Error(`${path} has more than one splat, which Cloudflare refuses`)
  return new RegExp(`^${path.replaceAll(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`)
}

/** What a request for `pathname` is answered with: every matching rule's headers, a name two rules share joined with a comma. */
export function headersFor(rules, pathname) {
  const headers = {}
  for (const { path, headers: given } of rules) {
    if (!pattern(path).test(pathname)) continue
    for (const [name, value] of Object.entries(given)) headers[name] = headers[name] === undefined ? value : `${headers[name]}, ${value}`
  }
  return headers
}

/**
 * The origins of the http(s) addresses in `list` other than the page's own,
 * resolved as the page at `address` resolves them -- a protocol-relative
 * `//host/…` included -- once each, sorted.
 */
const foreign = (list, address) => {
  const own = new URL(address).origin
  const urls = list.filter((value) => typeof value === 'string').map((value) => resolved(value, address))
  return [...new Set(urls.filter((url) => url !== null && /^https?:$/.test(url.protocol) && url.origin !== own).map((url) => url.origin))].sort()
}

/** The origins of the http(s) sources a directive names, once each, sorted. */
const origins = (list) => [...new Set(list.filter((source) => /^https?:\/\//.test(source)).map((source) => new URL(source).origin))].sort()

/** The directives the record decides, all of which the policy must have and no other. */
const DECIDED = Object.keys(POLICY)

/**
 * What is wrong with `policy` for the page `html`, served at `address`, and
 * the stylesheets it draws with: one sentence each, none when the policy
 * lets the page load everything it loads and names nothing it does not.
 * Derived from the page:
 *
 * - the policy has every directive the record decides and no other, and
 *   allows nothing inline, nothing evaluated and no host by wildcard;
 * - the page has no inline script, style element or style attribute, which
 *   the policy refuses;
 * - script-src names the hosts of the page's scripts, style-src those of
 *   its stylesheet links, and font-src those it preconnects to for a
 *   CORS-mode fetch (`crossorigin`), which is how a browser fetches a font
 *   -- each address resolved against `address`, however it is quoted, and
 *   every host but the page's own one the directive must name; no directive
 *   names a host the page does not load from;
 * - img-src allows `data:` exactly when the page or a stylesheet uses a
 *   data: URL.
 */
export function policyProblems(policy, { html, stylesheets, address }) {
  const problems = []
  for (const name of DECIDED) if (policy[name] === undefined) problems.push(`the policy has no ${name}, which the record decides`)
  for (const name of Object.keys(policy)) if (!DECIDED.includes(name)) problems.push(`the policy has ${name}, which the record does not decide`)
  // A keyword that lets inline or evaluated code run, a wildcard, or a whole
  // scheme -- `https:` is every host there is. `data:` is the one scheme the
  // page uses, held below to the data: URLs it has.
  const loose = (source) => /^'unsafe-|^'wasm-unsafe-eval'$|\*/.test(source) || (/^[a-z][a-z0-9+.-]*:$/.test(source) && source !== 'data:')
  for (const [name, sources] of Object.entries(policy)) {
    for (const source of sources.filter(loose)) problems.push(`${name} allows ${source}`)
  }

  const scripts = elements(html, 'script')
  const links = elements(html, 'link')
  if (scripts.some((attributes) => attributes.src === undefined)) problems.push('index.html has an inline script, which script-src refuses')
  if (/<style\b/i.test(html) || elements(html, '[a-z][\\w-]*').some((attributes) => attributes.style !== undefined)) problems.push('index.html has an inline style, which style-src refuses')

  const loads = {
    'script-src': foreign(scripts.map((attributes) => attributes.src), address),
    'style-src': foreign(stylesheetLinks(html), address),
    'font-src': foreign(links.filter((attributes) => rel(attributes).includes('preconnect') && attributes.crossorigin !== undefined).map((attributes) => attributes.href), address),
  }
  for (const [name, sources] of Object.entries(policy)) {
    const named = origins(sources)
    const wanted = loads[name] ?? []
    for (const host of wanted.filter((each) => !named.includes(each))) problems.push(`index.html loads from ${host}, and ${name} does not name it`)
    for (const host of named.filter((each) => !wanted.includes(each))) problems.push(`${name} names ${host}, which index.html does not load from`)
  }
  for (const [name, wanted] of Object.entries(loads)) {
    if (policy[name] === undefined) for (const host of wanted) problems.push(`index.html loads from ${host}, and ${name} does not name it`)
  }

  const usesData = links.some((attributes) => String(attributes.href ?? '').startsWith('data:')) || stylesheets.some((css) => /url\(\s*["']?data:/i.test(css))
  const allowsData = (policy['img-src'] ?? []).includes('data:')
  if (usesData && !allowsData) problems.push('the page or its stylesheets use a data: URL, and img-src does not allow data:')
  if (!usesData && allowsData) problems.push('img-src allows data:, and neither the page nor its stylesheets use a data: URL')
  return problems
}
