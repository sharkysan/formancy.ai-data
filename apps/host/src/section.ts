import type { FormMenuChild } from '@formancy/data-client'

/*
 * Whether a section shows under the record (0109): a child form the menu
 * calls `one` is drawn as the record's own section, shown while the
 * record's answer is the condition's. Read from the record as it is
 * stored -- as opened, or as its last save left it -- never from what the
 * person is typing: the section's rows are the stored record's.
 */

/**
 * Whether `child` shows under a record whose stored answers are `stored`.
 * Always for a child with no condition, and wherever the stored answers
 * are not known: what a page shows is never a permission (0109), and a
 * section hidden by mistake would hide what its own policy lets the
 * person read.
 */
export function sectionShown(child: Pick<FormMenuChild, 'when'>, stored: Readonly<Record<string, unknown>> | null): boolean {
  if (child.when === null || stored === null) return true
  return stored[child.when.field] === child.when.equals
}
