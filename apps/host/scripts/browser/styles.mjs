// What the host gate reads from the host's own stylesheet: the text Vite
// builds, the widths worth measuring, and every rule of it that would reach
// into a paper or a grid.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP } from './serve.mjs'

/**
 * host.css as one text, each `@import` replaced by the file it names, which
 * is what Vite builds. Read from the source, so a rule or a file added is
 * checked without anybody listing it here; an import this does not
 * understand stops the gate rather than checking less than the page loads.
 */
export function stylesheet() {
  const text = readFileSync(join(APP, 'src', 'host.css'), 'utf8').replaceAll(/@import\s+'(\.\/[^']+\.css)';/g, (_, path) =>
    readFileSync(join(APP, 'src', path), 'utf8'),
  )
  if (/@import/.test(text.replaceAll(/\/\*[\s\S]*?\*\//g, ''))) throw new Error('src/host.css has an @import the gate does not inline')
  return text
}

/**
 * Every `@media` condition of the stylesheet, comments left out. The widths
 * below are read from `max-width` rem queries alone, so a condition of any
 * other shape -- `min-width`, pixels, a range, `prefers-reduced-motion` --
 * is one the gate would never measure the page past, and stops it instead
 * (0047), as an `@import` it does not inline does.
 */
export function mediaConditions(text = stylesheet()) {
  const conditions = [...text.replaceAll(/\/\*[\s\S]*?\*\//g, '').matchAll(/@media\s*([^{]*)\{/g)].map((match) => match[1].trim())
  const unread = conditions.filter((condition) => !/^\(\s*max-width:\s*[\d.]+rem\s*\)$/.test(condition))
  if (unread.length > 0)
    throw new Error(`src/host.css has an @media condition the gate does not read, so it would measure no width past it: ${unread.join('; ')}`)
  return conditions
}

/** The widths worth measuring: the studio's list, with the breakpoints read from host.css, one pixel past each. */
export function widths() {
  const breakpoints = mediaConditions().map((condition) => Number(/([\d.]+)rem/.exec(condition)[1]) * 16)
  if (breakpoints.length === 0) throw new Error('found no max-width breakpoint in src/host.css, so the widths below measure nothing')
  return [
    // WCAG 2.2 SC 1.4.10, Reflow: 320 CSS pixels with no horizontal scrolling.
    { label: 'reflow, 320', width: 320 },
    // The same with the web fonts refused, whose fallback widths differ.
    { label: 'reflow, 320, web fonts refused', width: 320, refuseFonts: true },
    { label: 'phone, 360', width: 360 },
    ...[...new Set(breakpoints)].sort((a, b) => a - b).map((px) => ({ label: `one past the ${String(px)}px breakpoint`, width: px + 1 })),
    { label: 'laptop, 1440', width: 1440 },
  ]
}

/**
 * Every rule of host.css that selects an element inside `container` -- a
 * paper, or a grid's well. Parsed by the browser from the source, so a rule
 * added is checked without anybody listing it. A state the pointer or
 * keyboard puts an element in comes off the selector first, and a
 * pseudo-element is matched as the element it hangs off: a rule is matched
 * for every moment, not this one.
 */
export function rulesReaching(container) {
  return container.evaluate((box, text) => {
    const parsed = new CSSStyleSheet()
    parsed.replaceSync(text)
    const selectors = []
    const walk = (rules) => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule) selectors.push(rule.selectorText)
        else if ('cssRules' in rule) walk(rule.cssRules)
      }
    }
    walk(parsed.cssRules)
    const elements = [...box.querySelectorAll('*')]
    const reached = []
    for (const selector of selectors) {
      const always = selector.replace(/::[\w-]+(\([^)]*\))?/g, '').replace(/:(?:focus-visible|focus-within|focus|hover|active)(?![\w-])/g, '')
      const hit = elements.find((element) => element.matches(always.trim() === '' ? '*' : always))
      if (hit !== undefined) reached.push(`${selector} selects ${hit.outerHTML.slice(0, 60)}`)
    }
    return { rules: selectors.length, tags: [...new Set(elements.map((element) => element.tagName.toLowerCase()))], reached }
  }, stylesheet())
}
