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
 * undecided for contrast comes back with each node's selector and reason,
 * for `decide` below.
 */
export async function audit(page, target) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: AXE })
  const subject = target ?? (await page.evaluateHandle(() => document))
  return subject.evaluate(async (context, tags) => {
    const results = await window.axe.run(context, { runOnly: { type: 'tag', values: tags } })
    const nodes = (list, id) => list.find((rule) => rule.id === id)?.nodes ?? []
    return {
      axe: window.axe.version,
      violations: results.violations.map((rule) => `${rule.id} (${String(rule.nodes.length)}): ${rule.nodes[0]?.html.slice(0, 90) ?? ''}`),
      measured: ['color-contrast', 'target-size'].filter((id) => nodes(results.passes, id).length > 0),
      undecided: nodes(results.incomplete, 'color-contrast').map((node) => ({ html: node.html.slice(0, 60), selector: node.target[0], reason: node.any.map((check) => check.message).join(' ') })),
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

/**
 * Decides what axe left undecided inside a grid -- a header or a cell whose
 * background axe "could not determine due to a pseudo element" (UX-SPEC F1)
 * -- by the text's computed colour against the background the browser painted
 * in that cell's padding, at 4.5:1 or more. Anything axe left undecided
 * outside a grid, or for another reason, stays undecided: the gate fails it.
 */
export async function decide(page, undecided) {
  const left = []
  const decided = []
  for (const node of undecided) {
    const at = await page.evaluate((selector) => {
      const element = document.querySelector(selector)
      const cell = element?.closest('[role="columnheader"], [role="gridcell"]')
      if (element === null || cell === null || cell === undefined || element.closest('.grid-bench') === null) return null
      const box = cell.getBoundingClientRect()
      // Inside the cell's padding, clear of its 1px focus border and its text.
      return { color: getComputedStyle(element).color, x: box.left + 4, y: box.top + 4, name: (cell.textContent ?? '').trim().slice(0, 30) }
    }, node.selector)
    if (at === null || !/pseudo element/.test(node.reason)) {
      left.push(node.html)
      continue
    }
    const [background] = await painted(page, [{ x: at.x, y: at.y }])
    const text = parseColor(at.color)
    if (text === null || text.alpha !== 1) {
      left.push(`${node.html} (its colour ${at.color} is not one this gate reads)`)
      continue
    }
    decided.push({ name: at.name, ratio: contrast(text.rgb, background) })
  }
  return { left, decided, failing: decided.filter((entry) => entry.ratio < 4.5) }
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
