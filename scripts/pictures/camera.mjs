// The camera every README picture is taken with (0038): one context's
// settings, the app served, the fonts waited for, the clip measured from the
// parts, the shot taken until it settles, and the WebP encoded -- the same for
// all three apps, so no picture is taken another way.
//
// Node built-ins only. An app script passes in its own Playwright objects --
// the browser, the context, the page, a locator per part -- because Playwright
// is the apps' dependency, not the repository root's.
//
// What it reads from the DOM rather than the accessibility tree, and why
// (CLAUDE.md asks tests to find things by role and name; these are the reads
// that tree cannot answer, because it has no geometry and no fonts):
//
//   - boxes: `locator.boundingBox()` of each part, for the clip, which is
//     their union, and again after the shot, to show they did not move;
//   - scroll: `window.scrollTo(0, 0)` before measuring, because a box is in
//     the viewport's coordinates and a full-page clip in the page's, and the
//     two agree only at the top; and the page's scroll size, so no box is
//     past it;
//   - blur: the focused element is blurred before a shot unless the scene
//     keeps it, so no focus ring is pictured by accident;
//   - the bench: every element drawn near the parts -- its box, its box
//     shadow, whether it has a border, a background or text -- so the
//     margin around them stops short of anything else on the page;
//   - the intrusion check: every visible text node, and every input,
//     textarea, select, img, svg and canvas, whose painted box meets the
//     clip, is asked whether a part contains it -- so what the record holds
//     is everything a person reads in the picture;
//   - fonts: `document.fonts`, for whether every family has arrived; the
//     version in each font file's URL comes from the context's responses,
//     not the DOM;
//   - changes: a MutationObserver on the document while a picture is shot,
//     so a page that keeps changing is not pictured in one moment of it.
//
// One more is session.mjs's: `aria-busy` inside the parts, for a lookup's
// answer still out, which the accessibility snapshot does not carry.
//
// The app's stylesheet digest is read from its source files, as its gate
// inlines them, not from the DOM: `stylesheet()` below.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { strings } from './aria-text.mjs'

/** §3 of the design, for every scene: what a context is opened with. Nothing here reads the colour scheme; light is Playwright's default, said. */
export const SETTINGS = Object.freeze({ deviceScaleFactor: 2, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce', colorScheme: 'light', height: 900 })

/** How many shots a state may take to settle before the camera refuses it. */
export const SETTLE_LIMIT = 10

/**
 * The most bench a picture keeps around its parts, in CSS px on each side. A
 * part with no frame or padding of its own ran into the picture's edge
 * without it -- the examples' papers at 0 px, the studio's Connect heading at
 * 0.5 px, the Presentation rows at 0 and 1 px (measured on the pictures,
 * 2026-10-10) -- and looked cut out of the page. A side keeps less where
 * something else is drawn nearer (`bench`): at 16 px on every side, each
 * studio step showed a 4 px sliver of the Steps panel beside it, and the
 * Regenerated and Versions panels the glow of the button above them
 * (2026-10-10). What the bench adds is inside the clip, so the intrusion
 * check covers it.
 */
export const MARGIN = 16

/** WebP quality: 0.9, measured against 0.8 and 0.95 on one DPR-2 frame (0038). */
const QUALITY = 0.9

/**
 * The widest `max-width` breakpoint of `css`, in CSS pixels, read the way the
 * apps' browser gates read theirs. A picture is taken past it, in the wide
 * layout; `file` names the stylesheet in the refusal.
 */
export function widestBreakpoint(css, file) {
  const breakpoints = [...css.matchAll(/@media\s*\(\s*max-width:\s*([\d.]+)rem\s*\)/g)].map((match) => Number(match[1]) * 16)
  if (breakpoints.length === 0) throw new Error(`found no max-width breakpoint in ${file}, so no width can be shown to be past them all`)
  return Math.max(...breakpoints)
}

/**
 * An app's stylesheet as one text, the way its browser gate reads it: `entry`
 * in `directory` with each `@import './…css';` replaced by the file it names.
 * Refuses an import it does not understand rather than reading less than the
 * page loads.
 */
export function stylesheet(directory, entry) {
  const text = readFileSync(join(directory, entry), 'utf8').replaceAll(/@import\s+'(\.\/[^']+\.css)';/g, (_, path) => readFileSync(join(directory, path), 'utf8'))
  if (/@import/.test(text.replaceAll(/\/\*[\s\S]*?\*\//g, ''))) throw new Error(`${entry} has an @import the camera does not inline`)
  return text
}

/** Every fonts.gstatic.com URL a context's pages fetched, by context: where `fonts()` reads the versions. */
const fontFiles = new WeakMap()

/**
 * A context with the settings every picture is taken in, `width` wide;
 * refuses a width at or below the stylesheet's widest breakpoint. It notes
 * every font file its pages fetch: Chromium lists no resource timing entry
 * for a font a cross-origin stylesheet asked for (measured, Chromium
 * 153.0.8010.12, 2026-10-09), so the response is where its URL is seen.
 */
export async function context(browser, { width, breakpoint }) {
  if (!(width > breakpoint)) throw new Error(`a picture is taken past the widest breakpoint, ${String(breakpoint)}px, and ${String(width)}px is not past it`)
  const { height, ...rest } = SETTINGS
  const opened = await browser.newContext({ viewport: { width, height }, ...rest })
  const urls = new Set()
  fontFiles.set(opened, urls)
  opened.on('response', (response) => {
    if (response.url().startsWith('https://fonts.gstatic.com/') && response.ok()) urls.add(response.url())
  })
  return opened
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }

/**
 * The built app at `origin` (an `http://<app>.invalid` address nothing
 * resolves), answered inside `opened`: files from `dist`, and `/v1/` from
 * `inject`, the data server's own `server.inject`, when the app has one.
 * Nothing listens on a port, so nothing on a shared machine can reach the
 * plane, and the page is same-origin with its server as a host's is.
 */
export async function serve(opened, { origin, dist, inject }) {
  await opened.route(`${origin}/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.startsWith('/v1/')) {
      if (inject === undefined) return route.abort('connectionrefused')
      const body = request.postDataBuffer()
      const reply = await inject({ method: request.method(), url: `${url.pathname}${url.search}`, headers: await request.allHeaders(), ...(body === null ? {} : { payload: body }) })
      return route.fulfill({ status: reply.statusCode, contentType: String(reply.headers['content-type'] ?? 'application/json'), body: reply.rawPayload })
    }
    // `normalize` then a prefix check: a path with `..` must not leave dist.
    let file = join(dist, normalize(decodeURIComponent(url.pathname)))
    if (file !== dist && !file.startsWith(`${dist}${sep}`)) return route.fulfill({ status: 403 })
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    if (!existsSync(file)) return route.fulfill({ status: 404, contentType: 'text/plain', body: `no ${url.pathname}` })
    return route.fulfill({ status: 200, contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) })
  })
}

/** The font families the page asks Google Fonts for, from the `family=` parameters of the css2 links in `indexHtml`. */
export function families(indexHtml) {
  const found = new Set()
  for (const [, href] of indexHtml.matchAll(/href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)"/g)) {
    for (const family of new URL(href.replaceAll('&amp;', '&')).searchParams.getAll('family')) found.add(family.split(':')[0])
  }
  if (found.size === 0) throw new Error('index.html names no Google Fonts family, so there is nothing to wait for and a fallback face would be pictured unnoticed')
  return [...found]
}

/** A family's directory in a fonts.gstatic.com URL: "IBM Plex Sans" is ibmplexsans. */
const directory = (family) => family.toLowerCase().replaceAll(/\s+/g, '')

/**
 * Each of `names`' version, from the `/s/<family>/v<N>/` of the font files
 * in `urls`. Refuses a file of one of the families without a version, two
 * versions of one family, and a family no file was seen for: the record
 * says which font was pictured, or nothing is recorded.
 */
export function fontVersions(urls, names) {
  const versions = {}
  for (const url of urls) {
    const path = new URL(url).pathname
    const family = names.find((name) => path.startsWith(`/s/${directory(name)}/`))
    if (family === undefined) continue
    const version = new RegExp(`^/s/${directory(family)}/(v\\d+)/`).exec(path)?.[1]
    if (version === undefined) throw new Error(`the font file ${path} names no version, so the record could not say which ${family} was pictured`)
    if (versions[family] !== undefined && versions[family] !== version) throw new Error(`two versions of ${family} were loaded, ${versions[family]} and ${version}`)
    versions[family] = version
  }
  const unversioned = names.filter((family) => versions[family] === undefined)
  if (unversioned.length > 0) throw new Error(`no fonts.gstatic.com file was seen for ${unversioned.join(', ')}, so its version cannot be recorded`)
  return Object.fromEntries(names.map((family) => [family, versions[family]]))
}

/**
 * Waits, at most `within` ms, until `document.fonts` has settled with at
 * least one face of every family in `names` loaded and none still loading;
 * refuses naming the family that has not arrived. `document.fonts.ready`
 * alone once resolved with IBM Plex Sans not loaded at all (measured,
 * 2026-10-09), and it is itself raced against the bound, because a face
 * whose file never answers keeps it pending. Returns each family's version.
 */
export async function fonts(page, names, { within }) {
  const deadline = Date.now() + within
  for (;;) {
    const state = await page.evaluate(
      async ({ wanted, wait }) => {
        const ready = await Promise.race([document.fonts.ready.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), wait))])
        const faces = [...document.fonts]
        const named = (status) => new Set(faces.filter((face) => face.status === status).map((face) => face.family.replaceAll('"', '')))
        const [loading, loaded, failed] = [named('loading'), named('loaded'), named('error')]
        return { ready, loading: wanted.filter((family) => loading.has(family)), missing: wanted.filter((family) => !loaded.has(family)), failed: wanted.filter((family) => failed.has(family)) }
      },
      { wanted: names, wait: Math.max(0, deadline - Date.now()) },
    )
    if (state.ready && state.loading.length === 0 && state.missing.length === 0) break
    if (Date.now() > deadline) {
      const [family] = [...state.missing, ...state.loading]
      const how = state.failed.includes(family) ? 'failed to load' : 'had not loaded'
      throw new Error(`the font ${family} ${how} after ${String(within)} ms, and a picture in a fallback face would look like a different product`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const urls = fontFiles.get(page.context())
  if (urls === undefined) throw new Error("the page's context was not opened by the camera's context(), so the font files it fetched were not seen")
  return fontVersions(urls, names)
}

/** Blur the focused element unless the scene keeps it, and park the pointer where it hovers nothing a part holds. */
export async function still(page, { keepFocus = false } = {}) {
  if (!keepFocus) await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined))
  await page.mouse.move(0, 0)
}

/** `text` with every secret in it replaced, for a refusal that quotes the page. */
const redact = (text, secrets) => secrets.filter((secret) => secret !== '').reduce((said, secret) => said.replaceAll(secret, '[a secret]'), text)

/** `area` grown by `margin` -- one number, or `{ top, right, bottom, left }` -- and stopped at the edges of `size`, the page. */
export function padded(area, margin, size) {
  const sides = typeof margin === 'number' ? { top: margin, right: margin, bottom: margin, left: margin } : margin
  const left = Math.max(0, area.x - sides.left)
  const top = Math.max(0, area.y - sides.top)
  const right = Math.min(size.width, area.x + area.width + sides.right)
  const bottom = Math.min(size.height, area.y + area.height + sides.bottom)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * How much of `margin` each side of `area` keeps: all of it, or less where
 * something drawn beside the area belongs to no part and holds none -- a
 * neighbouring panel's edge, a button's glow -- whole CSS px short of it, so
 * the bench never shows a sliver of something else. "Drawn" is a border, a
 * background, text, a control or an image, and a coloured box shadow by how
 * far it reaches; a black one is the bench darkened, and is not counted (the
 * Steps panel's reaches 30 px, and only its border was seen in the
 * pictures). Something beside two sides -- a corner -- is kept out by the
 * side that loses less. Opposite sides keep the same, the less of the two:
 * a pane beside another's glow kept 16 px on one side and none on the other,
 * and looked cut off at the edge it touched (host-typeahead, 2026-10-10). An
 * element over the area itself is the intrusion check's to say. Run in the
 * page, at scroll 0.
 */
function bench({ area, parts, margin }) {
  const related = (element) => parts.some((part) => part === element || part.contains(element) || element.contains(part))
  const transparent = (color) => color === 'transparent' || /^rgba\(.*,\s*0\)$/.test(color)
  // How far each coloured outer box shadow reaches past the border box, side by side.
  const reach = (shadow) => {
    const out = { top: 0, right: 0, bottom: 0, left: 0 }
    if (shadow === 'none') return out
    for (const one of shadow.split(/,(?![^(]*\))/)) {
      const color = /rgba?\([^)]*\)/.exec(one)?.[0] ?? ''
      if (/\binset\b/.test(one) || /^rgba?\(0, 0, 0\b/.test(color) || transparent(color)) continue
      const [x = 0, y = 0, blur = 0, spread = 0] = [...one.replace(color, '').matchAll(/(-?[\d.]+)px/g)].map((match) => Number(match[1]))
      out.top = Math.max(out.top, blur + spread - y)
      out.bottom = Math.max(out.bottom, blur + spread + y)
      out.left = Math.max(out.left, blur + spread - x)
      out.right = Math.max(out.right, blur + spread + x)
    }
    return out
  }
  const sides = ['Top', 'Right', 'Bottom', 'Left']
  const draws = (element, style) =>
    ['input', 'textarea', 'select', 'img', 'svg', 'canvas'].includes(element.localName) ||
    !transparent(style.backgroundColor) ||
    style.backgroundImage !== 'none' ||
    sides.some((side) => parseFloat(style[`border${side}Width`]) > 0 && style[`border${side}Style`] !== 'none' && !transparent(style[`border${side}Color`])) ||
    [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.data.trim() !== '')
  const [left, top, right, bottom] = [area.x, area.y, area.x + area.width, area.y + area.height]
  const kept = { top: margin, right: margin, bottom: margin, left: margin }
  for (const element of document.body.querySelectorAll('*')) {
    if (related(element) || !element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
    const style = getComputedStyle(element)
    const glow = reach(style.boxShadow)
    if (!draws(element, style) && Object.values(glow).every((length) => length <= 0)) continue
    const box = element.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) continue
    // The room left on each side the element is beyond, its glow included.
    const rooms = [
      ...(box.bottom <= top ? [['top', top - (box.bottom + glow.bottom)]] : []),
      ...(box.top >= bottom ? [['bottom', box.top - glow.top - bottom]] : []),
      ...(box.right <= left ? [['left', left - (box.right + glow.right)]] : []),
      ...(box.left >= right ? [['right', box.left - glow.left - right]] : []),
    ]
    if (rooms.length === 0) continue
    const [side, room] = rooms.reduce((best, next) => (next[1] > best[1] ? next : best))
    kept[side] = Math.min(kept[side], room)
  }
  const across = Math.max(0, Math.floor(Math.min(kept.left, kept.right)))
  const down = Math.max(0, Math.floor(Math.min(kept.top, kept.bottom)))
  return { top: down, right: across, bottom: down, left: across }
}

/** Each part's box, at scroll 0, in page coordinates, and the page's size; refuses a part that is not drawn or is past the page. */
async function boxes(page, parts) {
  await page.evaluate(() => window.scrollTo(0, 0))
  const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))
  const found = {}
  for (const [name, locator] of Object.entries(parts)) {
    const box = await locator.boundingBox()
    if (box === null || box.width === 0 || box.height === 0) throw new Error(`the part ${name} has no size: it is not drawn`)
    if (box.x < 0 || box.y < 0 || box.x + box.width > size.width + 0.5 || box.y + box.height > size.height + 0.5) {
      throw new Error(`the part ${name} reaches past the page (${JSON.stringify(box)} on ${String(size.width)}x${String(size.height)})`)
    }
    found[name] = box
  }
  return { found, size }
}

/** The clip of `parts` as measured now: their union with the bench `bench` leaves around it, inside the page. */
async function measured(page, parts) {
  const { found, size } = await boxes(page, parts)
  const area = union(found)
  const handles = await Promise.all(Object.values(parts).map((locator) => locator.elementHandle()))
  try {
    return padded(area, await page.evaluate(bench, { area, parts: handles, margin: MARGIN }), size)
  } finally {
    await Promise.all(handles.map((handle) => handle.dispose()))
  }
}

/** The union of `found`'s boxes, rounded outward to whole CSS pixels. */
function union(found) {
  const all = Object.values(found)
  const left = Math.floor(Math.min(...all.map((box) => box.x)))
  const top = Math.floor(Math.min(...all.map((box) => box.y)))
  const right = Math.ceil(Math.max(...all.map((box) => box.x + box.width)))
  const bottom = Math.ceil(Math.max(...all.map((box) => box.y + box.height)))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * What is drawn inside `clip` and belongs to no part: visible text, and the
 * elements that show something without text. Run in the page.
 */
function intruders({ clip, parts }) {
  const inside = (node) => parts.some((part) => part.contains(node))
  // What of `rect` is painted: cut by every ancestor that clips what overflows it.
  const painted = (element, rect) => {
    let [left, top, right, bottom] = [rect.left, rect.top, rect.right, rect.bottom]
    for (let ancestor = element; ancestor !== null && ancestor !== document.documentElement; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor)
      if (style.overflowX === 'visible' && style.overflowY === 'visible' && style.clipPath === 'none' && style.clip === 'auto') continue
      const box = ancestor.getBoundingClientRect()
      ;[left, top, right, bottom] = [Math.max(left, box.left), Math.max(top, box.top), Math.min(right, box.right), Math.min(bottom, box.bottom)]
    }
    return { left, top, right, bottom }
  }
  // At least 2 by 2 pixels and meeting the clip: a visually hidden element is one pixel, clipped.
  const meets = (box) => box.right - box.left >= 2 && box.bottom - box.top >= 2 && box.right > clip.x && box.left < clip.x + clip.width && box.bottom > clip.y && box.top < clip.y + clip.height
  const shown = (element) => element.checkVisibility({ opacityProperty: true, visibilityProperty: true })
  const found = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const parent = node.parentElement
    if (node.data.trim() === '' || parent === null || inside(node) || !shown(parent)) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    if ([...range.getClientRects()].some((rect) => meets(painted(parent, rect)))) found.push(`the text "${node.data.trim().slice(0, 80)}"`)
  }
  for (const element of document.body.querySelectorAll('input, textarea, select, img, svg, canvas')) {
    if (inside(element) || (element instanceof HTMLInputElement && element.type === 'hidden') || !shown(element)) continue
    if (meets(painted(element, element.getBoundingClientRect()))) found.push(`a ${element.tagName.toLowerCase()} "${(element.getAttribute('aria-label') ?? element.getAttribute('name') ?? '').slice(0, 40)}"`)
  }
  return found
}

/**
 * The clip of a picture made of `parts` (`{ name: locator }`): the union of
 * their boxes, measured at scroll 0, with the bench around it.
 * Refuses when anything drawn inside it -- the margin included -- belongs to
 * no part, since that would be text the record does not hold, and quotes it,
 * with `secrets` taken out.
 */
export async function clip(page, parts, { scene, secrets = [] } = {}) {
  const area = await measured(page, parts)
  const handles = await Promise.all(Object.values(parts).map((locator) => locator.elementHandle()))
  try {
    const stray = await page.evaluate(intruders, { clip: area, parts: handles })
    if (stray.length > 0) {
      throw new Error(`${scene === undefined ? '' : `${scene}: `}the clip of ${Object.keys(parts).join(', ')} shows what no part holds, so the record would not say it: ${redact(stray.slice(0, 6).join('; '), secrets)}`)
    }
  } finally {
    await Promise.all(handles.map((handle) => handle.dispose()))
  }
  return area
}

/**
 * Starts counting, in the page, every change to the DOM -- a node added or
 * removed, a text changed, an attribute given another value -- except the
 * caret colour Playwright sets on every text box for a shot and puts back.
 * Each change is kept as its kind, element and attribute name, never a
 * value, since a value can be a token. Run in the page.
 */
function watchChanges() {
  window.__picturesChanges?.observer.disconnect()
  const caretless = (style) => (style ?? '').replaceAll(/caret-color\s*:[^;]*;?/g, '').replaceAll(/\s+/g, '')
  const seen = []
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        const now = record.target.getAttribute(record.attributeName)
        if (now === record.oldValue) continue
        if (record.attributeName === 'style' && caretless(now) === caretless(record.oldValue)) continue
      }
      const element = record.target instanceof Element ? record.target : record.target.parentElement
      seen.push(`${record.type === 'characterData' ? 'text' : record.type} of a ${element?.localName ?? 'node'}${record.type === 'attributes' ? `'s ${record.attributeName}` : ''}`)
    }
  })
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true })
  window.__picturesChanges = { observer, seen }
}

/**
 * The picture of `area`: shot until two shots in a row are the same bytes
 * and nothing in the page changed from before the first began until the
 * second was taken, at most SETTLE_LIMIT shots, and refused after that. A
 * single shot right after a click was measured catching a page still drawing
 * (2026-10-09); and two equal shots alone let a background toggled every
 * 16 ms through in one of its two colours, in each of five captures
 * (measured by review, 2026-10-10), because two shots can fall in the same
 * phase. So the DOM is watched too: a page that keeps changing does not
 * settle, whatever phase the shots caught. What it cannot see is a change
 * outside the DOM -- a canvas redrawn, a video -- which no page here has, and
 * which two shots in one phase would hide.
 */
export async function shoot(page, area, { keepFocus = false } = {}) {
  await still(page, { keepFocus })
  await page.evaluate(watchChanges)
  const changes = () => page.evaluate(() => window.__picturesChanges.seen.splice(0))
  try {
    let previous
    let quietBefore = false
    let last
    for (let shots = 1; shots <= SETTLE_LIMIT; shots += 1) {
      const png = await page.screenshot({ clip: area, fullPage: true, animations: 'disabled', caret: 'hide' })
      // Every change since the read after the shot before: during this shot, and between the two.
      const changed = await changes()
      const quiet = changed.length === 0
      if (previous !== undefined && previous.equals(png) && quietBefore && quiet) return { png, shots }
      last = changed.at(-1) ?? last
      previous = png
      quietBefore = quiet
    }
    const why = last === undefined ? 'no two shots in a row were the same' : `the page kept changing while it was shot (the last change: the ${last})`
    throw new Error(`the picture did not settle in ${String(SETTLE_LIMIT)} shots: ${why}`)
  } finally {
    await page.evaluate(() => {
      window.__picturesChanges?.observer.disconnect()
      delete window.__picturesChanges
    })
  }
}

/**
 * `bytes` of type `from` re-encoded by Chromium's canvas as `to`, in a blank
 * page of the same browser. Refuses when the canvas answers with another
 * type, which is what it does, silently, for one it cannot encode.
 */
export async function encode(browser, bytes, { from, to, quality }) {
  const page = await browser.newPage()
  try {
    const url = await page.evaluate(
      async ({ data, type, q }) => {
        const image = new Image()
        image.src = data
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        canvas.getContext('2d').drawImage(image, 0, 0)
        return canvas.toDataURL(type, q)
      },
      { data: `data:${from};base64,${bytes.toString('base64')}`, type: to, q: quality },
    )
    if (!url.startsWith(`data:${to};`)) throw new Error(`Chromium's canvas did not encode ${to}: it answered ${url.slice(5, url.indexOf(';'))}, as it does for a type it cannot encode`)
    return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
  } finally {
    await page.context().close()
  }
}

/** A shot as the WebP the README shows: quality 0.9, no alpha option (measured to change nothing). */
export const webp = (browser, png) => encode(browser, png, { from: 'image/png', to: 'image/webp', quality: QUALITY })

/** A committed WebP decoded back to PNG, for a reviewer to open at 100%. */
export const decodedPng = (browser, picture) => encode(browser, picture, { from: 'image/webp', to: 'image/png', quality: 1 })

/**
 * Each part's accessibility snapshot, by part name: the text the record
 * holds and `--check` compares. Refuses an empty one, and one that holds any
 * of `secrets` -- the tokens, passwords and connection URLs the app's plane
 * holds -- raw or decoded; the refusal names the scene and the part, never
 * the value.
 */
export async function text(parts, { scene, secrets = [] }) {
  const said = {}
  for (const [name, locator] of Object.entries(parts)) {
    const snapshot = await locator.ariaSnapshot()
    if (snapshot.trim() === '') throw new Error(`${scene}: the part ${name} says nothing, so nothing would hold its picture`)
    const readable = [snapshot, ...strings(snapshot)]
    if (secrets.some((secret) => secret !== '' && readable.some((line) => line.includes(secret)))) {
      throw new Error(`${scene}: the part ${name} shows one of the plane's secrets -- a token, a password or a connection URL -- so it is neither recorded nor printed`)
    }
    said[name] = snapshot
  }
  return said
}

/**
 * One scene's picture, as capture takes it: the fonts arrived, the page
 * still, the clip measured and checked, the shot settled, each part's text,
 * and the parts' boxes measured again so a picture whose parts moved while
 * it was taken is refused.
 */
export async function take(page, parts, { scene, families: names, within, secrets = [], keepFocus = false }) {
  const versions = await fonts(page, names, { within })
  await still(page, { keepFocus })
  const area = await clip(page, parts, { scene, secrets })
  const { png, shots } = await shoot(page, area, { keepFocus })
  const said = await text(parts, { scene, secrets })
  const after = await measured(page, parts)
  if (JSON.stringify(after) !== JSON.stringify(area)) throw new Error(`${scene}: the parts moved while the picture was taken, from ${JSON.stringify(area)} to ${JSON.stringify(after)}`)
  return { png, shots, clip: area, text: said, fonts: versions }
}

/** sha256 of a text or a buffer, hex. */
export const digest = (data) => createHash('sha256').update(data).digest('hex')

/** What the pictures were taken on: one look for every record (0038). `playwright` is the app's installed version. */
export function look(browser, { playwright, fonts: versions }) {
  return { platform: `${process.platform}-${process.arch}`, playwright, chromium: browser.version(), fonts: versions }
}
