// What the host gate measures in the browser, as numbers and computed results:
// sideways overflow, axe, the contrast axe cannot decide inside a grid, and
// where the keyboard is.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { ACCESSIBILITY_TAGS } from '@formancy/conformance'

/** How long Angular may take to arrive, and the server to answer: generous, for a loaded runner. */
export const WITHIN = { timeout: 20_000 }

/** Wait until `condition` holds, or fail with `problem`. */
export async function until(condition, problem) {
  const deadline = Date.now() + WITHIN.timeout
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(problem)
}

/**
 * Sideways scroll, and every element with a box past either edge -- except
 * what is inside a grid's well (`.grid-bench`), whose own horizontal
 * scroller shows columns past it (UX-SPEC F3: AG Grid's scrollbar is beside
 * `role=grid`, not in it). The well itself must be inside the window, which
 * is measured separately, so a well that runs past the edge still fails.
 */
export function measureWidth(page) {
  return page.evaluate(() => {
    const edge = document.documentElement.clientWidth
    const past = []
    for (const element of document.body.querySelectorAll('*')) {
      if (element.closest('.grid-bench') !== null && !element.classList.contains('grid-bench')) continue
      const box = element.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      if (box.right <= edge + 0.5 && box.left >= -0.5) continue
      const part = element.getAttribute('data-formancy-part')
      past.push(`${element.tagName.toLowerCase()}${part === null ? '' : `[${part}]`}.${String(element.className).slice(0, 24)} at ${Math.round(box.left)}..${Math.round(box.right)}`)
    }
    return { overflow: document.documentElement.scrollWidth - edge, past: [...new Set(past)].slice(0, 6) }
  })
}

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

/**
 * axe at WCAG 2.2 AA with nothing switched off, and a guard on the guard:
 * the two measurements must have run over something. What axe leaves
 * undecided for contrast comes back with each node's selector, reason and
 * place in `window.formancyGateUndecided`, which holds the elements axe
 * named, taken as it answered, for `decide` below: a selector axe builds
 * can name a class AG Grid takes off again, `ag-row-hover` among them, so
 * the element is not found by it later.
 */
export async function audit(page, target) {
  // Through Playwright's evaluate, not a script element: the page's policy
  // refuses an inline script, as it should (0083), and what Playwright
  // evaluates is not held to it, as 0069 measured.
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(`${AXE}\n;undefined`)
  const subject = target ?? (await page.evaluateHandle(() => document))
  return subject.evaluate(async (context, tags) => {
    const results = await window.axe.run(context, { runOnly: { type: 'tag', values: tags }, elementRef: true })
    const nodes = (list, id) => list.find((rule) => rule.id === id)?.nodes ?? []
    const undecided = nodes(results.incomplete, 'color-contrast')
    window.formancyGateUndecided = undecided.map((node) => node.element)
    return {
      axe: window.axe.version,
      violations: results.violations.map((rule) => `${rule.id} (${String(rule.nodes.length)}): ${rule.nodes[0]?.html.slice(0, 90) ?? ''}`),
      measured: ['color-contrast', 'target-size'].filter((id) => nodes(results.passes, id).length > 0),
      undecided: undecided.map((node, at) => ({ html: node.html.slice(0, 60), selector: node.target[0], at, reason: node.any.map((check) => check.message).join(' ') })),
    }
  }, [...ACCESSIBILITY_TAGS])
}

/** WCAG 2.x relative luminance of an sRGB colour, each channel 0..255. */
function luminance([r, g, b]) {
  const linear = (channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** The contrast ratio of two colours, to two decimals. */
export function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100
}

/** A computed colour -- `rgb()`, `rgba()` or `color(srgb …)` -- as 0..255 channels and an alpha; null for any other form. */
export function parseColor(value) {
  let match = /^rgba?\(([^)]+)\)$/.exec(value)
  if (match !== null) {
    const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    return { rgb: parts.slice(0, 3), alpha: parts[3] ?? 1 }
  }
  match = /^color\(srgb ([^)]+)\)$/.exec(value)
  if (match !== null) {
    const parts = match[1].split(/[\s/]+/).filter(Boolean).map(Number)
    return { rgb: parts.slice(0, 3).map((channel) => Math.round(channel * 255)), alpha: parts[3] ?? 1 }
  }
  return null
}

/**
 * The colours the browser painted at `points` (viewport CSS pixels), read from
 * a screenshot of the page decoded by the page itself: what a person sees,
 * whatever element or pseudo-element drew it. AG Grid paints a row's
 * selection and hover on a layer of its own, which no computed style of the
 * cell names, so a contrast inside a grid is measured on the pixels.
 */
export async function painted(page, points) {
  const picture = await page.screenshot({ scale: 'css', animations: 'disabled', caret: 'hide' })
  return page.evaluate(
    async ({ data, at }) => {
      const image = new Image()
      image.src = `data:image/png;base64,${data}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(image, 0, 0)
      return at.map(({ x, y }) => [...context.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3)])
    },
    { data: picture.toString('base64'), at: points },
  )
}

/** Two animation frames: a rendering update has run since the call, by which WebKit has said where a focus scrolled the page (0058's reportsFocusScroll). */
export function settled(page) {
  return page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

/** The probe's page: a column of buttons taller than the window, which a focus scrolls, and a row of buttons wider than its scroller, fixed at the top, which a focus scrolls sideways. */
const PROBE_PAGE = `<!doctype html><style>body{margin:0}button{appearance:none;margin:0;padding:0;border:0;outline:none}#column button{display:block;width:100%;height:10px}#row{position:fixed;top:0;left:0;width:280px;height:60px;overflow:auto;white-space:nowrap;background:#fff}#row button{display:inline-block;width:200px;height:40px}</style><div id="row">${'<button></button>'.repeat(40)}</div><div id="column">${'<button></button>'.repeat(400)}</div>`

/** What each trial focuses, out of view after the trial before it: a button of the column, which scrolls the window, or of the row, which scrolls its scroller. */
const FOCUSED = [
  ['column', 360],
  ['row', 30],
  ['column', 30],
  ['row', 2],
  ['column', 340],
  ['row', 35],
  ['column', 50],
  ['row', 5],
]

/**
 * 0058's reportsFocusScroll, on a page of its own in `browser`: each of
 * FOCUSED focused, out of view, and the scroll the page says in the task
 * that focused it -- the window's `scrollY`, the row's `scrollLeft` --
 * against the one it says once `settled`. A trial is a focus that scrolled;
 * `late` counts those whose first answer was still the scroll before it,
 * for the window and for the scroller apart.
 */
export async function focusScroll(browser) {
  const page = await browser.newPage({ viewport: { width: 320, height: 900 } })
  try {
    await page.setContent(PROBE_PAGE)
    const counts = { window: { trials: 0, late: 0 }, scroller: { trials: 0, late: 0 } }
    for (const [where, at] of FOCUSED) {
      const before = await page.evaluate(
        ({ where, at }) => {
          const position = () => (where === 'row' ? document.getElementById('row').scrollLeft : window.scrollY)
          const was = position()
          document.querySelectorAll(`#${where} button`)[at].focus()
          return { was, inTask: position() }
        },
        { where, at },
      )
      await settled(page)
      const now = await page.evaluate((where) => (where === 'row' ? document.getElementById('row').scrollLeft : window.scrollY), where)
      if (now === before.was) continue
      const kind = counts[where === 'row' ? 'scroller' : 'window']
      kind.trials += 1
      if (before.inTask !== now) kind.late += 1
    }
    return counts
  } finally {
    await page.close()
  }
}

/**
 * The colours painted at the points `locate()` finds in the page -- `{
 * points, ...what else it read }`, or null when what it looks for is not
 * drawn -- read from a page that held still: the points are found again
 * after the screenshot, and the reading taken again while they moved. A
 * page that scrolled or shifted between finding a point and the screenshot
 * would have its colours read beside what they belong to; seen in WebKit on
 * 2026-10-13, where the document scrolled by 24 px within a press and
 * settled back about 130 ms later, its cause not established.
 */
export async function paintedWhere(page, locate) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const before = await locate()
    if (before === null) return null
    const colours = await painted(page, before.points)
    const after = await locate()
    if (JSON.stringify(after) === JSON.stringify(before)) return { ...before, colours }
  }
  throw new Error('the page never held still between finding what to measure and the screenshot of it')
}

/**
 * A text axe called partially obscured, shown whole inside the pane that cuts
 * it, asked of axe again, and the pane put back: `passes`, a `violation` with
 * axe's ratio, or `left` with why it could not be shown. The pane is the
 * text's nearest ancestor that scrolls up and down, and only its own scroll
 * moves -- never the window's, never a grid's -- and only when the text's box
 * runs past the pane's edge and fits inside it, and the pane lies wholly in
 * the window. Its colours are the text's own and the pane's, which do not
 * change when the pane scrolls: a pane that scrolls inside itself stays where
 * it is drawn, so what lies behind its glass does not move. Anything else
 * that covers part of a text is not this, and stays undecided.
 */
async function reveal(page, at) {
  return page.evaluate(async (index) => {
    const element = window.formancyGateUndecided?.[index]
    if (element === undefined || !element.isConnected) return { verdict: 'left', why: 'gone from the page' }
    // A grid scrolls itself, and its scroll is part of the state measured.
    if (element.closest('.grid-bench') !== null) return { verdict: 'left', why: 'partially obscured, inside a grid' }
    let pane = element.parentElement
    while (pane !== null && !/auto|scroll/.test(getComputedStyle(pane).overflowY)) pane = pane.parentElement
    if (pane === null) return { verdict: 'left', why: 'partially obscured, in no pane that scrolls' }
    const frame = pane.getBoundingClientRect()
    const top = frame.top + pane.clientTop
    const bottom = top + pane.clientHeight
    const box = element.getBoundingClientRect()
    if (box.top >= top && box.bottom <= bottom) return { verdict: 'left', why: 'partially obscured, and not by the edge of its pane' }
    if (box.height > pane.clientHeight || frame.top < 0 || frame.bottom > window.innerHeight) return { verdict: 'left', why: 'cut by a pane it does not fit in, or one the window cuts' }
    const before = pane.scrollTop
    try {
      pane.scrollTop = before + (box.top < top ? box.top - top : box.bottom - bottom)
      const results = await window.axe.run(element, { runOnly: { type: 'rule', values: ['color-contrast'] } })
      const ratio = (outcome) => outcome[0]?.nodes[0]?.any[0]?.data?.contrastRatio
      if (results.violations.length > 0) return { verdict: 'violation', ratio: ratio(results.violations) }
      if (results.incomplete.length > 0) return { verdict: 'left', why: `shown whole in the pane that cut it, and still undecided: ${results.incomplete[0]?.nodes[0]?.any[0]?.message ?? ''}` }
      return results.passes.length > 0 ? { verdict: 'passes' } : { verdict: 'left', why: 'shown whole in the pane that cut it, and axe measured nothing' }
    } finally {
      pane.scrollTop = before
    }
  }, at)
}

/**
 * Decides what axe left undecided inside a grid -- a header or a cell whose
 * background axe "could not determine due to a pseudo element" (UX-SPEC F1),
 * or because "it is overlapped by another element" -- by the text's computed
 * colour against the background the browser painted in that cell's padding,
 * at 4.5:1 or more. Anything axe left undecided outside a grid, or for
 * another reason, stays undecided: the gate fails it. Overlapped is what axe
 * says of a row the grid keeps drawn above its scroller's top, where the
 * page's own toolbar lies over it: the same text scrolled out of view as
 * below, found `hidden` the same way (seen 2026-10-28, when a grid's Filter
 * row moved the Records panel's pager over row 23 at 1281 pixels).
 *
 * The background is read only where the cell itself is drawn. A cell its
 * grid has scrolled partly out of view is read inside the part its grid
 * shows -- its box cut by every ancestor that clips it sideways, the grid's
 * own scrollers among them -- and a cell outside the window is first
 * brought into it by the window's scroll alone, never the grid's, which is
 * part of the state measured, and the window is scrolled back after. The
 * point must then be on the cell, by elementFromPoint, or the cell stays
 * undecided; where a grid's header covers the cell's top padding,
 * its bottom padding is tried. A text its grid has scrolled wholly out of
 * view -- a column past the well's edge, a row below the grid's own
 * scroller -- or that the grid's header covers is on no screen in this
 * state, and is returned as `hidden`, neither decided nor left: when its
 * box is cut away by an ancestor and the window, where it can say,
 * shows something else at its middle, or when the window shows something
 * else there. Before 2026-10-14 the point was the box's corner wherever it
 * lay: with a row's Delete as the last column (0053), End scrolled the
 * Records grid so that, at 360 pixels, the corner of its "Created by"
 * header lay outside the grid -- on the panel's glass in Firefox and WebKit,
 * read as 4.49:1 and 4.47:1, and left of the window in Chromium, where a
 * screenshot has no pixel and the gate read black -- and every cell below
 * the window was read against that black too (0058).
 *
 * Partially obscured is what axe says of a text its own scrolling pane cuts
 * at an edge: side by side, the Records panel scrolls inside itself, so a
 * focused control is never covered (records.css), and a text at its top or
 * bottom edge is half shown. Such a text outside a grid is decided by
 * `reveal`. Seen 2026-10-28, when a grid's View row (0105) made
 * the panel's content taller than a window 900 pixels high: the panel's
 * heading after a row's Delete scrolled it, and a refused filter's lines at
 * its foot, in all three browsers.
 */
export async function decide(page, undecided) {
  const left = []
  const decided = []
  const hidden = []
  const scrolled = await page.evaluate(() => [window.scrollX, window.scrollY])
  try {
    for (const node of undecided) {
      if (/partially obscured/.test(node.reason)) {
        const revealed = await reveal(page, node.at)
        if (revealed.verdict === 'passes') continue
        left.push(`${node.html} (${revealed.verdict === 'violation' ? `shown whole in the pane that cut it, at ${String(revealed.ratio)}:1` : revealed.why})`)
        continue
      }
      if (!/pseudo element|overlapped by another element/.test(node.reason)) {
        left.push(node.html)
        continue
      }
      await page.evaluate((at) => {
        const box = window.formancyGateUndecided?.[at]?.closest('[role="columnheader"], [role="gridcell"]')?.getBoundingClientRect()
        if (box !== undefined && (box.top < 0 || box.bottom > window.innerHeight)) window.scrollBy(0, box.top - (window.innerHeight - box.height) / 2)
      }, node.at)
      const locate = () =>
        page.evaluate((at) => {
          const element = window.formancyGateUndecided?.[at]
          const cell = element?.closest('[role="columnheader"], [role="gridcell"]')
          if (element === undefined || !element.isConnected || cell === null || cell === undefined || element.closest('.grid-bench') === null) return null
          // What is drawn of a box: cut by every ancestor that clips it, the grid's own scrollers among them, and, `inWindow`, by the window.
          const drawnOf = (box, inWindow) => {
            const edge = inWindow ? { left: 0, right: document.documentElement.clientWidth, top: 0, bottom: window.innerHeight } : { left: -Infinity, right: Infinity, top: -Infinity, bottom: Infinity }
            const part = { left: Math.max(box.left, edge.left), right: Math.min(box.right, edge.right), top: Math.max(box.top, edge.top), bottom: Math.min(box.bottom, edge.bottom) }
            for (let ancestor = cell.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
              const style = getComputedStyle(ancestor)
              const clip = ancestor.getBoundingClientRect()
              if (style.overflowX !== 'visible') Object.assign(part, { left: Math.max(part.left, clip.left), right: Math.min(part.right, clip.right) })
              if (style.overflowY !== 'visible') Object.assign(part, { top: Math.max(part.top, clip.top), bottom: Math.min(part.bottom, clip.bottom) })
            }
            return part
          }
          const name = (cell.textContent ?? '').trim().slice(0, 30)
          const describe = (hit) => (hit === null ? 'nothing' : `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 40)}`)
          const box = cell.getBoundingClientRect()
          const part = drawnOf(box, true)
          // Inside the cell's top padding or, where a grid's header covers that, its bottom padding: clear of its 1px focus
          // border and its text, where the window shows the cell.
          const tried = []
          for (const point of [{ x: part.left + 4, y: box.top + 4 }, { x: part.left + 4, y: box.bottom - 4 }]) {
            const inside = point.x < part.right - 1 && point.y >= part.top && point.y < part.bottom - 1
            const hit = inside ? document.elementFromPoint(point.x, point.y) : null
            if (hit !== null && cell.contains(hit)) return { color: getComputedStyle(element).color, points: [point], name, drawn: true }
            tried.push(`at ${String(Math.round(point.x))}, ${String(Math.round(point.y))} ${inside ? describe(hit) : 'the cell cut off'}`)
          }
          // Shown nowhere a point was tried: a text its grid has scrolled wholly out of view, or that the grid's header covers, is on
          // no screen in this state, so there is nothing to decide. Scrolled out: its box cut away by an ancestor -- the window's own
          // edges hide none, since it was scrolled to -- and, where its middle is in the window, the window showing something else
          // there. Covered: the window showing something else at its middle.
          const range = document.createRange()
          range.selectNodeContents(element)
          const words = range.getBoundingClientRect()
          const shown = drawnOf(words, false)
          const middle = { x: (words.left + words.right) / 2, y: (words.top + words.bottom) / 2 }
          const inWindow = middle.x >= 0 && middle.x < document.documentElement.clientWidth && middle.y >= 0 && middle.y < window.innerHeight
          const there = inWindow ? document.elementFromPoint(middle.x, middle.y) : null
          const elsewhere = there !== null && !cell.contains(there)
          if ((shown.right <= shown.left || shown.bottom <= shown.top) && (!inWindow || elsewhere)) return { hidden: true, name, points: [] }
          if (elsewhere) return { hidden: true, name, points: [] }
          return { name, points: [], drawn: false, on: tried.join('; ') }
        }, node.at)
      const at = await paintedWhere(page, locate)
      if (at?.hidden === true) {
        hidden.push(at.name)
        continue
      }
      if (at === null || !at.drawn) {
        left.push(`${node.html}${at === null ? ' (outside a grid, or gone from the page)' : ` (shown, and the gate read no pixel of the cell beside it: ${at.on})`}`)
        continue
      }
      const [background] = at.colours
      const text = parseColor(at.color)
      if (text === null || text.alpha !== 1) {
        left.push(`${node.html} (its colour ${at.color} is not one this gate reads)`)
        continue
      }
      decided.push({ name: at.name, ratio: contrast(text.rgb, background) })
    }
  } finally {
    await page.evaluate(([x, y]) => window.scrollTo(x, y), scrolled)
  }
  return { left, decided, hidden, failing: decided.filter((entry) => entry.ratio < 4.5) }
}

/** What has the keyboard's focus, said so that a failure names it. */
export function describeFocus(page) {
  return page.evaluate(() => {
    const element = document.activeElement
    if (element === null || element === document.body) return 'the page itself'
    return `${element.tagName.toLowerCase()}${element.id === '' ? '' : `#${element.id}`}${element.getAttribute('role') === null ? '' : `[role=${String(element.getAttribute('role'))}]`} "${(element.textContent ?? '').trim().slice(0, 40)}"`
  })
}

/** Null when `locator`'s element has the focus, otherwise where the focus is. */
export async function focusedOn(page, locator) {
  return (await locator.evaluate((element) => element === document.activeElement || element.contains(document.activeElement))) ? null : `the focus is on ${await describeFocus(page)}`
}
