import type { FormRecord, PublishedForm } from '@formancy/data-client'
import type { Said } from './leave.js'

/*
 * Change from a date (0115): the open version of a chain read again, and
 * every pane opened on its next version -- its answers, the start left for
 * the person to give and the end empty, which the server keeps open. Saved,
 * it ends the version it follows where it starts, in one write (0113).
 */

type Versions = NonNullable<PublishedForm['versions']>

/** The next version of `record`: no token, no version, its answers but the start and the end. */
export function nextOf(record: FormRecord, versions: Versions): FormRecord {
  return { record: null, version: null, answers: { ...record.answers, [versions.from]: null, [versions.to]: null } }
}

/** Whether `answers` are an open version's: one whose end is empty, which a change from a date may follow. */
export function isOpen(answers: Readonly<Record<string, unknown>> | null, versions: Versions | null): boolean {
  return versions !== null && answers !== null && (answers[versions.to] ?? null) === null
}

/** What the line says once the next version is open: what the person does next. */
export function nextLine(token: string, both: boolean): Said {
  return [
    `${both ? 'Both forms hold' : 'The form holds'} the next version of `,
    { code: token },
    ': give the date it starts, change what changes, and save. Saving ends this version on that date.',
  ]
}
