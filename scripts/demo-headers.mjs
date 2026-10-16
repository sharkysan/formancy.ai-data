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
// characters a line. The file itself is not served. The page for Pages,
// whose format it says is the same, adds that a header the file names
// overrides what Cloudflare sends by default, `Cache-Control` among them.
// None of this was measured against Cloudflare: the gate holds the page to
// these headers as this module reads the file, and nothing here reads what
// formancy.ai answers.

/**
 * The Content-Security-Policy, directive by directive. Each source is one
 * the built page uses, and policyProblems holds the hosts to what
 * index.html loads.
 */
export const POLICY = Object.freeze({
  // Anything a directive below does not name: the page's own files only.
  'default-src': ["'self'"],
  // The built chunks, and nothing inline and nothing evaluated. React needs
  // neither, and Angular is compiled ahead of time by the analog plugin, so
  // no JIT compiler is bundled and nothing builds a function from a string;
  // the browser gate fails on every violation the page reports.
  'script-src': ["'self'"],
  // The built stylesheet, and Google Fonts' stylesheet, which index.html
  // links. No inline style: React and Angular set a style through the CSSOM,
  // which this directive does not govern, and the page carries no style
  // attribute or element.
  'style-src': ["'self'", 'https://fonts.googleapis.com'],
  // The font files Google's stylesheet names, from the host index.html
  // preconnects to for them.
  'font-src': ['https://fonts.gstatic.com'],
  // The page loads no image. The Blueprint theme draws the date and time
  // fields' icons as data: SVGs where Safari on a touch device draws no
  // picker icon of its own, and index.html's icon is `data:,`.
  'img-src': ['data:'],
  // The page fetches nothing: the snapshot is in the build. Vite's preload
  // fetches the Angular chunk from the page's own origin in a browser
  // without modulepreload.
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
 * could embed. Only names Chromium recognises: an unknown one is a console
 * message on every load, which the gate counts.
 */
export const DENIED_FEATURES = Object.freeze([
  'accelerometer',
  'autoplay',
  'bluetooth',
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
 * The rules, for the page served under `base` (`/data/examples/`): every
 * response under it gets the policy and its companions, and the hashed
 * chunks a year's cache. The page itself keeps Cloudflare's default,
 * revalidated on every load, so a deploy is seen at once.
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
  return new RegExp(`^${path.replaceAll(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '.*')}$`)
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

/** Each `tag` element of `html` (a pattern), as its attributes: lowercased names, `true` for one with no value. */
function elements(html, tag) {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'gi'))].map((match) =>
    Object.fromEntries([...match[1].matchAll(/([\w-]+)(?:\s*=\s*"([^"]*)")?/g)].map(([, name, value]) => [name.toLowerCase(), value ?? true])),
  )
}

/** The origins of the absolute http(s) addresses in `list`, once each, sorted. */
const origins = (list) => [...new Set(list.filter((address) => typeof address === 'string' && /^https?:\/\//.test(address)).map((address) => new URL(address).origin))].sort()

/** The directives the record decides, all of which the policy must have and no other. */
const DECIDED = Object.keys(POLICY)

/**
 * What is wrong with `policy` for the page `html` and the stylesheets it
 * draws with: one sentence each, none when the policy lets the page load
 * everything it loads and names nothing it does not. Derived from the page:
 *
 * - the policy has every directive the record decides and no other, and
 *   allows nothing inline, nothing evaluated and no host by wildcard;
 * - the page has no inline script, style element or style attribute, which
 *   the policy refuses;
 * - script-src names the hosts of the page's scripts, style-src those of
 *   its stylesheet links, and font-src those it preconnects to for a
 *   CORS-mode fetch (`crossorigin`), which is how a browser fetches a font;
 *   no directive names a host the page does not load from;
 * - img-src allows `data:` exactly when the page or a stylesheet uses a
 *   data: URL.
 */
export function policyProblems(policy, { html, stylesheets }) {
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

  const rel = (attributes) => String(attributes.rel ?? '').toLowerCase().split(/\s+/)
  const loads = {
    'script-src': origins(scripts.map((attributes) => attributes.src)),
    'style-src': origins(links.filter((attributes) => rel(attributes).includes('stylesheet')).map((attributes) => attributes.href)),
    'font-src': origins(links.filter((attributes) => rel(attributes).includes('preconnect') && attributes.crossorigin !== undefined).map((attributes) => attributes.href)),
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
