// What the studio gate measures in the browser, as numbers and computed
// results: sideways overflow, axe, and where the keyboard is.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { ACCESSIBILITY_TAGS } from '@formancy/conformance'

/** Sideways scroll, and every element with a box that is past either edge. */
export function measureWidth(page) {
  return page.evaluate(() => {
    const edge = document.documentElement.clientWidth
    const past = []
    for (const element of document.body.querySelectorAll('*')) {
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
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: AXE })
  const subject = target ?? (await page.evaluateHandle(() => document))
  return subject.evaluate(async (context, tags) => {
    const results = await window.axe.run(context, { runOnly: { type: 'tag', values: tags } })
    const nodes = (list, id) => list.find((rule) => rule.id === id)?.nodes ?? []
    return {
      axe: window.axe.version,
      violations: results.violations.map((rule) => `${rule.id} (${String(rule.nodes.length)}): ${rule.nodes[0]?.html.slice(0, 90) ?? ''}`),
      measured: ['color-contrast', 'target-size'].filter((id) => nodes(results.passes, id).length > 0),
      undecided: nodes(results.incomplete, 'color-contrast').map((node) => node.html.slice(0, 60)).slice(0, 4),
    }
  }, [...ACCESSIBILITY_TAGS])
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
  check(`${state}: the contrast of every text decided`, result.undecided.length === 0 ? null : `undecided: ${result.undecided.join('; ')}`)
}
