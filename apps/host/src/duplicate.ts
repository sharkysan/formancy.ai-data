import type { FormRecord } from '@formancy/data-client'
import type { FieldDef } from '@formancy/spec'
import type { Said } from './leave.js'

/*
 * Duplicate record (0107): a new record holding a copy of a saved one's
 * answers. Which fields a copy carries is the server's decision, sent with
 * the form as `copied` -- what this person may read and give on create, less
 * every column of a key -- so the page copies by that list and decides
 * nothing of it: a field it carried that the server would refuse is a save
 * refused as over-posting after the person typed into the copy.
 */

/** Whether an answer holds anything a person would miss: not null, not absent, not empty text. */
function held(answer: unknown): boolean {
  return answer !== null && answer !== undefined && answer !== ''
}

/**
 * A new record copied from `record`: the answers `copied` names, each as
 * read, and no token or version, so a save creates. A field the record does
 * not hold is left absent, as on a new form.
 */
export function copyOf(record: FormRecord, copied: readonly string[]): FormRecord {
  const answers: FormRecord['answers'] = Object.fromEntries(
    copied.filter((field) => Object.hasOwn(record.answers, field)).map((field) => [field, record.answers[field] ?? null]),
  )
  return { record: null, version: null, answers }
}

/** The labels of the fields that held a value in `record` and are not copied, in the form's order: the values a person will not see carried. */
export function leftOut(fields: readonly FieldDef[], record: FormRecord, copied: readonly string[]): string[] {
  const kept = new Set(copied)
  return fields.filter((field) => !kept.has(field.key) && held(record.answers[field.key])).map((field) => String(field.label ?? field.key))
}

/** What the detail's line says of a copy: the record copied, into which forms, and the fields left out. */
export function copiedLine(token: string, left: readonly string[], both: boolean): Said {
  const into = both ? ' into both forms, for a new record.' : ' into the form, for a new record.'
  return ['Copied ', { code: token }, left.length === 0 ? into : `${into} Not copied: ${left.join(', ')}.`]
}
