// The Open beside a lookup's box, in the browser (0157): the button the host
// page draws in the place formancy 0.14.0 gives a host after a select's or
// a typeahead's box (formancy.ai 0237), which jsdom lays out nowhere.
//
// - In every state the gate measures, each such button on the page is one
//   axe's target-size rule measured and passed. The gate's own audit fails
//   any violation of the rule; this fails a button the rule did not reach,
//   which would pass that audit untested.
// - While it is available, its glyph is drawn at 3:1 or more against what
//   is behind it (WCAG 1.4.11). axe's contrast rule reads text, and the
//   button has none, so the glyph's colour is read here, from the computed
//   `fill` and the computed background colours from the button up to the
//   first one that is opaque. An unavailable one, `aria-disabled`, is an
//   inactive control, which 1.4.11 excuses.
// - A width's pass that drew no such button, or none unavailable or none
//   available, fails: every check above would pass over nothing. The short
//   window's pass signs in and lists the orders with no record open, so it
//   draws none, and is not tallied.
// - Tab from the order's Customer lands on its Open, in each renderer, on a
//   new order, the Open unavailable, and on a loaded one, available
//   (journey.mjs).
//
// Every check has one name in every browser (0058).

import { contrast, focusedOn, parseColor } from './measure.mjs'

/** A host's button in the place beside a box: the part is formancy's, the button the page's. */
export const BESIDE = '[data-formancy-part="field-beside"] button'

/** The name of the Open beside an order's Customer: the customer form is titled Customer (plane.mjs). */
export const CUSTOMER_OPEN = 'Open in Customer'

/**
 * Each Open beside a box the page draws now: its name, whether it is
 * unavailable, what axe's target-size rule found of it -- run on those
 * buttons alone, after the gate's own audit has put axe in the page -- its
 * glyph's computed fill, and the backgrounds from it up to the first opaque
 * one, each with whether an image is drawn there.
 */
export function besideReadings(page) {
  return page.evaluate(async (selector) => {
    const drawn = [...document.querySelectorAll(selector)].filter((button) => button.getClientRects().length > 0)
    if (drawn.length === 0) return []
    const results = await window.axe.run({ include: drawn }, { runOnly: { type: 'rule', values: ['target-size'] }, elementRef: true })
    const holds = (list, button) => list.some((rule) => rule.nodes.some((node) => node.element === button))
    const verdict = (button) =>
      holds(results.violations, button)
        ? 'too small'
        : holds(results.incomplete, button)
          ? 'undecided'
          : holds(results.passes, button)
            ? 'passed'
            : 'not measured'
    const grounds = (button) => {
      const layers = []
      for (let at = button; at !== null; at = at.parentElement) {
        const style = getComputedStyle(at)
        layers.push({ color: style.backgroundColor, image: style.backgroundImage !== 'none' })
        if (/^rgb\(/.test(style.backgroundColor)) break
      }
      return layers
    }
    return drawn.map((button) => ({
      name: button.getAttribute('aria-label') ?? '',
      unavailable: button.getAttribute('aria-disabled') === 'true',
      size: verdict(button),
      glyph: getComputedStyle(button.querySelector('svg') ?? button).fill,
      grounds: grounds(button),
    }))
  }, BESIDE)
}

/** The colour behind a glyph, from its backgrounds bottom first: each translucent one laid over the opaque one under it; null where one is unreadable or an image. */
function behind(grounds) {
  let colour = [255, 255, 255]
  for (const { color, image } of [...grounds].reverse()) {
    const parsed = parseColor(color)
    if (parsed === null || image) return null
    colour = colour.map((channel, at) => Math.round(parsed.rgb[at] * parsed.alpha + channel * (1 - parsed.alpha)))
  }
  return colour
}

/** What is wrong with the Opens beside the boxes `readings` describes: the ones axe's target size did not pass, and the available ones whose glyph is below 3:1. */
export function besideProblems(readings) {
  const unsized = readings.filter((open) => open.size !== 'passed').map((open) => `${open.name}: ${open.size}`)
  const faint = readings
    .filter((open) => !open.unavailable)
    .flatMap((open) => {
      const glyph = parseColor(open.glyph)
      const ground = behind(open.grounds)
      if (glyph === null || ground === null) return [`${open.name}: its glyph ${open.glyph} over ${JSON.stringify(open.grounds)} could not be read`]
      const ratio = contrast(glyph.rgb, ground)
      return ratio >= 3 ? [] : [`${open.name}: ${String(ratio)}:1`]
    })
  return { unsized: unsized.length === 0 ? null : unsized.join('; '), faint: faint.length === 0 ? null : faint.join('; ') }
}

/** Null when Tab from `box` puts the keyboard on `open` and `open` is as available as `available` says, else what happened. */
export async function tabsOnto(page, box, open, available) {
  await box.focus()
  await page.keyboard.press('Tab')
  const focus = await focusedOn(page, open)
  if (focus !== null) return focus
  const unavailable = (await open.getAttribute('aria-disabled')) === 'true'
  return unavailable === !available ? null : `it is ${unavailable ? 'unavailable' : 'available'}`
}
