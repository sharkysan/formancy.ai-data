import { within } from '@testing-library/react'
import { getRole, isInaccessible } from 'dom-accessibility-api'

/**
 * How the suite finds the controls on the page: from the accessibility tree,
 * by role and accessible name (formancy.ai 0034), never by tag or selector.
 *
 * A list of tags would compare markup, and the markup is each renderer's own
 * on purpose; it would also miss a control drawn as a widget -- a combobox or
 * a switch built from a `div` -- which a person using a screen reader meets by
 * its role and nothing else.
 */

/** The roles ARIA gives a control a person answers with. */
export const ANSWERING_ROLES = [
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'spinbutton',
  'slider',
  'checkbox',
  'switch',
  'radio',
] as const

/**
 * Every control in `container` a person answers with.
 *
 * By role; and, for the inputs ARIA gives no role at all -- a date or a
 * date-time, among the fields here ("no corresponding role" in HTML-AAM) --
 * by the accessible names the caller expects, since a name is the only handle
 * the tree offers on them. So one of those drawn under a name nobody expects
 * is the one control this cannot see; axe's `label` rule is what refuses one
 * drawn with no name.
 *
 * Only an element with no role is taken by name. Anything with a role was
 * either found by it above or is not a control: the customer form's layout
 * section is a group named "Customer", which is also a field of the order.
 *
 * Inaccessible elements are left out, as `getAllByRole` leaves them out: a
 * control inside `hidden` is not on the page for anybody.
 */
export function answerable(container: HTMLElement, names: readonly string[]): HTMLElement[] {
  const scope = within(container)
  const byRole = ANSWERING_ROLES.flatMap((role) => scope.queryAllByRole(role))
  const byName = names
    .flatMap((name) => scope.queryAllByLabelText(name, { exact: true }))
    .filter((element) => getRole(element) === null)
  return [...new Set([...byRole, ...byName])].filter((element) => !isInaccessible(element))
}

/**
 * What a paragraph in `container` says, in order.
 *
 * Prose has a role and, by ARIA's own rule, no name: a paragraph may not be
 * named. So a sentence the page or a renderer prints -- an empty kind of note,
 * the fallback where a chooser would be -- is found as a paragraph, by role,
 * and what it says is the assertion. Hidden text is not on the page, and is
 * not returned.
 */
export function paragraphs(container: HTMLElement): string[] {
  return within(container)
    .queryAllByRole('paragraph')
    .map((paragraph) => paragraph.textContent ?? '')
}
