import type { ReactElement } from 'react'
import type { DriftChange, DriftSubject } from '@formancy/data-core'
import type { Published } from './api.js'
import { describeRef } from './choice.js'

function describeSubject(subject: DriftSubject): string {
  if (subject.kind === 'scope') return 'the discovery scope'
  if (subject.kind === 'schema') return `schema ${subject.schema}`
  if (subject.kind === 'object') return describeRef(subject.object)
  return `${describeRef(subject.object)}, ${subject.kind} ${subject.name}`
}

function labelIn(published: Published | null, key: string): string {
  const label = published?.bundle.form.model.fields.find((field) => field.key === key)?.label
  return typeof label === 'string' ? `${label} (${key})` : key
}

/**
 * One drift change, as the drift report and a refused restore both show it:
 * its severity, its kind and subject, the server's sentence, and the fields
 * of the form it touches, by their labels in `published` where it is known.
 */
export function Change({ change, published }: { change: DriftChange; published: Published | null }): ReactElement {
  return (
    <li className="change" data-severity={change.severity}>
      <p>
        <span className="severity">{change.severity}</span> <code>{change.kind}</code> on {describeSubject(change.subject)}
      </p>
      <p>{change.message}</p>
      <p className="affects">
        {change.affects.length === 0 ? 'Affects no field of this form.' : `Affects ${change.affects.map((key) => labelIn(published, key)).join(', ')}.`}
      </p>
    </li>
  )
}

/**
 * Changes, each a `Change`, under a heading of `level` named `heading`: what
 * blocks a write, or what a write was allowed with -- an import, a draft
 * submitted, a draft approved -- or `none` when a write was allowed with
 * nothing to review. `id` names the list by its heading, so it is unique on
 * the page.
 */
export function Changes({
  changes,
  published,
  id,
  heading,
  level: Heading,
  none,
}: {
  changes: readonly DriftChange[]
  published: Published | null
  id: string
  heading: string
  level: 'h3' | 'h4'
  none?: string
}): ReactElement | null {
  if (changes.length === 0) return none === undefined ? null : <p>{none}</p>
  return (
    <>
      <Heading id={id}>{heading}</Heading>
      <ul aria-labelledby={id}>
        {changes.map((change, index) => (
          // A change is its subject and kind; the server's order is the order to read them in.
          <Change key={index} change={change} published={published} />
        ))}
      </ul>
    </>
  )
}
