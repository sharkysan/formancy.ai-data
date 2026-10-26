// What the studio gate measures in the browser, as numbers and computed
// results: sideways overflow, axe, where the keyboard is, and what the
// page's policy refused.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { ACCESSIBILITY_TAGS } from '@formancy/conformance'
import { policyRefused } from '../../../../scripts/browser-gate.mjs'

/**
 * Sideways scroll, and every element with a box that is past either edge --
 * except what is inside a browse's grid (`.rows`, 0099), which scrolls
 * sideways in its own region, as the host gate excuses a grid's well. The
 * region itself must be inside the window, so one that runs past the edge
 * still fails.
 */
export function measureWidth(page) {
  return page.evaluate(() => {
    const edge = document.documentElement.clientWidth
    const past = []
    for (const element of document.body.querySelectorAll('*')) {
      if (element.closest('.rows') !== null && !element.classList.contains('rows')) continue
      const box = element.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      if (box.right <= edge + 0.5 && box.left >= -0.5) continue
      past.push(`${element.tagName.toLowerCase()}.${String(element.className).slice(0, 24)} at ${Math.round(box.left)}..${Math.round(box.right)}`)
    }
    return { overflow: document.documentElement.scrollWidth - edge, past: [...new Set(past)].slice(0, 6) }
  })
}

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

/**
 * axe at WCAG 2.2 AA with nothing switched off, and a guard on the guard: the
 * two measurements must have run over something, and every text's contrast
 * must have been decided.
 */
export async function audit(page, target) {
  // Through Playwright's evaluate, not a script element: the page's policy
  // refuses an inline script, as it should (0083), and what Playwright
  // evaluates is not held to it, as 0069 measured.
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(`${AXE}\n;undefined`)
  const subject = target ?? (await page.evaluateHandle(() => document))
  return subject.evaluate(async (context, tags) => {
    const results = await window.axe.run(context, { runOnly: { type: 'tag', values: tags } })
    const nodes = (list, id) => list.find((rule) => rule.id === id)?.nodes ?? []
    return {
      axe: window.axe.version,
      violations: results.violations.map((rule) => `${rule.id} (${String(rule.nodes.length)}): ${rule.nodes[0]?.html.slice(0, 90) ?? ''}`),
      measured: ['color-contrast', 'target-size'].filter((id) => nodes(results.passes, id).length > 0),
      undecided: nodes(results.incomplete, 'color-contrast').map((node) => ({ html: node.html.slice(0, 60), target: node.target[0] })),
    }
  }, [...ACCESSIBILITY_TAGS])
}

/**
 * The texts axe left undecided inside a browse's grid (`.rows`, 0099),
 * which its region scrolls sideways: each scrolled into view in its region
 * from its start, as a person scrolling to it reads it, and measured alone by axe's own
 * contrast rule, then the region and the window put back. Below AA is
 * `failing`; still undecided, or not inside a grid, is `left`, which the
 * gate fails as before.
 */
async function decideInRows(page, undecided) {
  return page.evaluate(async (nodes) => {
    const left = []
    const failing = []
    for (const { html, target } of nodes) {
      const element = typeof target === 'string' ? document.querySelector(target) : null
      const region = element?.closest('.rows') ?? null
      if (element === null || region === null) {
        left.push(html)
        continue
      }
      const before = { region: region.scrollLeft, x: window.scrollX, y: window.scrollY }
      // Its start into view, where its text begins: a caption as wide as the table fits no narrower region whole.
      element.scrollIntoView({ block: 'nearest', inline: 'start' })
      const results = await window.axe.run(element, { runOnly: { type: 'rule', values: ['color-contrast'] } })
      region.scrollLeft = before.region
      window.scrollTo(before.x, before.y)
      if (results.violations.length > 0) failing.push(html)
      else if (results.passes.length === 0) left.push(`${html} (still undecided once scrolled into view)`)
    }
    return { left, failing }
  }, undecided)
}

/** What has the keyboard's focus, said so that a failure names it. */
export function describeFocus(page) {
  return page.evaluate(() => {
    const element = document.activeElement
    if (element === null || element === document.body) return 'the page itself'
    return `${element.tagName.toLowerCase()}${element.id === '' ? '' : `#${element.id}`} "${(element.textContent ?? '').trim().slice(0, 40)}"`
  })
}

/**
 * Enter on `pressed`, as a keyboard user presses it; then, once `settled`
 * says the studio has answered, whether `expected` has the focus.
 *
 * In a browser because what happens to the focus of an element React moves
 * or unmounts is the browser's to say, and jsdom has an answer of its own.
 */
export async function focusAfterEnter(page, pressed, settled, expected) {
  await pressed.focus()
  await page.keyboard.press('Enter')
  await settled()
  return (await expected.evaluate((element) => element === document.activeElement)) ? null : `the focus is on ${await describeFocus(page)}`
}

/** A state measured: no sideways scroll, nothing past either edge, and axe -- contrast and target size included -- over the whole page. */
export async function measured(gate, page, state) {
  const { check } = gate
  const width = await measureWidth(page)
  check(`${state}: no sideways scroll`, width.overflow > 0 ? `${String(width.overflow)}px of horizontal overflow` : null)
  check(`${state}: nothing past either edge`, width.past.length === 0 ? null : width.past.join('; '))
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined))
  const result = await audit(page)
  gate.axe(result.axe)
  check(`${state}: axe finds nothing at WCAG 2.2 AA`, result.violations.length === 0 ? null : result.violations.join('; '))
  check(`${state}: contrast and target size measured, over something`, result.measured.length === 2 ? null : `only ${result.measured.join(', ') || 'nothing'}`)
  const { left, failing } = await decideInRows(page, result.undecided)
  const undecided = [...left.slice(0, 4).map((html) => `undecided: ${html}`), ...failing.slice(0, 4).map((html) => `below AA once scrolled into view: ${html}`)]
  check(`${state}: the contrast of every text decided`, undecided.length === 0 ? null : undecided.join('; '))
  // Everything the page did to reach this state, under the policy it was
  // sent with (0083): what the browser refused, and what the console said
  // of the policy.
  check(`${state}: the browser refused nothing under the page’s policy`, await policyRefused(page))
}
