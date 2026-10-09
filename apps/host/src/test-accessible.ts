import { screen, within } from '@testing-library/react'
import axe from 'axe-core'
import { computeAccessibleName } from 'dom-accessibility-api'
import { ACCESSIBILITY_EXCLUSIONS, ACCESSIBILITY_TAGS, ACCESSIBILITY_UNMEASURABLE_IN_JSDOM } from '@formancy/conformance'

/**
 * The accessibility floor every state of the page is held to, from the studio
 * and the examples page: axe at WCAG 2.2 AA over the whole document, and every
 * control named by a real implementation of the accessible-name algorithm.
 */

/**
 * axe over the whole document at WCAG 2.2 AA, with only what jsdom cannot
 * measure switched off, and the page-structure rules a form fragment is
 * excused from upstream -- this is a page, not a fragment.
 */
export async function audit(): Promise<string[]> {
  const wcag = await axe.run(document, {
    runOnly: { type: 'tag', values: [...ACCESSIBILITY_TAGS] },
    rules: Object.fromEntries(Object.keys(ACCESSIBILITY_UNMEASURABLE_IN_JSDOM).map((rule) => [rule, { enabled: false }])),
  })
  const structure = await axe.run(document, { runOnly: { type: 'rule', values: Object.keys(ACCESSIBILITY_EXCLUSIONS) } })
  return [...wcag.violations, ...structure.violations].map((violation) => `${violation.id}: ${violation.nodes[0]?.html.slice(0, 120) ?? ''}`)
}

/**
 * Every link, button and control on the page whose accessible name is empty.
 * axe does not notice a control named by something useless; computing every
 * name and refusing an empty one does.
 */
export function unnamed(): string[] {
  const roles = ['link', 'button', 'textbox', 'combobox', 'listbox', 'checkbox', 'radio', 'spinbutton', 'switch'] as const
  return roles
    .flatMap((role) => screen.queryAllByRole(role))
    .filter((element) => computeAccessibleName(element).trim() === '')
    .map((element) => element.outerHTML.slice(0, 100))
}

/** The accessible name of what has the keyboard's focus; the page itself when nothing does. */
export function focusedName(): string {
  const element = document.activeElement
  return element === null || element === document.body ? 'the page itself' : computeAccessibleName(element)
}

/** What the paragraphs in `container` say, in order: prose has a role and no name. */
export function paragraphs(container: HTMLElement): string[] {
  return within(container)
    .queryAllByRole('paragraph')
    .map((paragraph) => paragraph.textContent ?? '')
}
