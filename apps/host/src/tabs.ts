import { childTitle } from './child-title.js'
import type { ChildForm } from './children.js'

/*
 * The record's tabs (0142): the record itself, then one tab per child form
 * the menu names for its form, in the menu's order, each named as its
 * section's heading names it. A child the menu calls `one` is a section of
 * the record (0109), drawn in the record's own tab: it is part of the
 * record. And where a key pressed on a tab moves the selection, as
 * WAI-ARIA's tabs pattern has it for a horizontal row.
 */

/** The record's own tab: its form, its panes and its sections. No child's key, which always holds a `~`. */
export const RECORD_TAB = 'record'

/** A child form drawn in a tab of its own beside the record. */
export interface ChildTab {
  /** `<child form>~<field>`, as its section's owner is keyed at level 1. */
  key: string
  form: ChildForm
  /** Its place in the menu's list of children, which its section's element ids are minted from. */
  index: number
  /** The same child form under this record through another field too: the name and the heading say the field. */
  twice: boolean
  /** What the tab says: its section's heading. */
  name: string
}

/** Every child of `children` that is not a section of the record, in the menu's order. */
export function childTabs(children: readonly ChildForm[]): ChildTab[] {
  const tabs: ChildTab[] = []
  children.forEach((form, index) => {
    const { child, menu, definition } = form
    if (child.one) return
    const twice = children.filter((each) => each.child.form === child.form).length > 1
    tabs.push({ key: `${child.form}~${child.field}`, form, index, twice, name: childTitle(menu.title, twice, definition, child.field) })
  })
  return tabs
}

/**
 * The tab a key pressed on `at` selects, of `keys` in their order: Right
 * and Left the next and the previous, round the ends, Home and End the
 * first and the last. Null for any other key, which is the browser's: Tab
 * leaves the row for the panel shown.
 */
export function tabMoved(keys: readonly string[], at: string, key: string): string | null {
  const here = keys.indexOf(at)
  const count = keys.length
  const to =
    key === 'ArrowRight' ? (here + 1) % count : key === 'ArrowLeft' ? (here - 1 + count) % count : key === 'Home' ? 0 : key === 'End' ? count - 1 : null
  return to === null ? null : (keys[to] ?? null)
}
