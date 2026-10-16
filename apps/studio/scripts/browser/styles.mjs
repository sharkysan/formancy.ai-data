// What the studio gate reads from the studio's own stylesheet: the text Vite
// builds, the widths worth measuring, and every rule of it that would reach
// into the paper.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP } from './serve.mjs'

/**
 * The studio's stylesheet as one text: src/studio.css with each of its
 * `@import`s replaced by the file it names, which is what Vite builds. Read
 * from the source, so a rule or a file added is checked without anybody
 * listing it here; an import that names no file, or one this does not
 * understand, stops the gate rather than checking less than the page loads.
 */
export function stylesheet() {
  const entry = join(APP, 'src', 'studio.css')
  const text = readFileSync(entry, 'utf8').replaceAll(/@import\s+'(\.\/[^']+\.css)';/g, (_, path) => readFileSync(join(APP, 'src', path), 'utf8'))
  if (/@import/.test(text.replaceAll(/\/\*[\s\S]*?\*\//g, ''))) throw new Error('src/studio.css has an @import the gate does not inline')
  return text
}

/**
 * The widths worth measuring. Breakpoints are read from the stylesheet, one
 * pixel past each `max-width`, where the wider layout is at its narrowest; a
 * breakpoint added to studio.css is measured without anybody editing this.
 */
export function widths() {
  const css = stylesheet()
  const breakpoints = [...css.matchAll(/@media\s*\(\s*max-width:\s*([\d.]+)rem\s*\)/g)].map((match) => Number(match[1]) * 16)
  if (breakpoints.length === 0) throw new Error('found no max-width breakpoint in src/studio.css, so the widths below measure nothing')
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
 * Every rule of studio.css that selects an element on the paper -- the
 * preview's, or under review a draft's, which is the same component.
 *
 * The stylesheet is read from the source and parsed by the browser, so a rule
 * added to it is checked without anybody listing it here. A rule is matched
 * for every moment, not this one: a state the pointer or the keyboard puts an
 * element in (`:hover`, `:focus-visible`) comes off the selector first, and a
 * pseudo-element is matched as the element it hangs off. What the paper
 * inherits -- the font, the line height -- it would inherit from any host
 * page; that is not a rule selecting it.
 */
export function rulesOnThePaper(page) {
  const css = stylesheet()
  return page.locator('form.sheet').evaluate((paper, text) => {
    const stylesheet = new CSSStyleSheet()
    stylesheet.replaceSync(text)
    const selectors = []
    const walk = (rules) => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule) selectors.push(rule.selectorText)
        else if ('cssRules' in rule) walk(rule.cssRules)
      }
    }
    walk(stylesheet.cssRules)
    const elements = [...paper.querySelectorAll('*')]
    const reached = []
    for (const selector of selectors) {
      const always = selector.replace(/::[\w-]+(\([^)]*\))?/g, '').replace(/:(?:focus-visible|focus-within|focus|hover|active)(?![\w-])/g, '')
      const hit = elements.find((element) => element.matches(always.trim() === '' ? '*' : always))
      if (hit !== undefined) reached.push(`${selector} selects ${hit.outerHTML.slice(0, 60)}`)
    }
    return { rules: selectors.length, tags: [...new Set(elements.map((element) => element.tagName.toLowerCase()))], reached }
  }, css)
}

/** The paper's check, and the guard on it: real rules, matched against a whole form. */
export async function checkThePaper(page, check, what) {
  const paper = await rulesOnThePaper(page)
  check(`${what}: no rule of studio.css selects anything on the paper`, paper.reached.length === 0 ? null : paper.reached.slice(0, 6).join('; '))
  const missing = ['label', 'input', 'button'].filter((tag) => !paper.tags.includes(tag))
  check('which matched studio.css against a whole form', paper.rules > 0 && missing.length === 0 ? null : `${String(paper.rules)} rules, and no ${missing.join(', ')} on the paper`)
}
