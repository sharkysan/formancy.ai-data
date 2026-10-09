import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { DriftChange, DriftSeverity, DriftSubject } from '@formancy/data-core'
import type { AdminClient, Drift, Published } from './api.js'
import { describeRef, isFormId } from './choice.js'

/**
 * The three severities, most severe first, each with what it stops -- the
 * words are `DriftSeverity`'s own definitions, not new ones.
 */
const SEVERITIES: ReadonlyArray<{ severity: DriftSeverity; heading: string; blocks: string }> = [
  { severity: 'blocking', heading: 'Blocking', blocks: 'Blocks the form as published: a write it offers is stopped, or a field it shows can no longer be read, until it is reviewed.' },
  { severity: 'review', heading: 'Review', blocks: 'Blocks nothing. A person has something to decide.' },
  { severity: 'info', heading: 'Info', blocks: 'Blocks nothing. Recorded so the review is complete.' },
]

function describeSubject(subject: DriftSubject): string {
  if (subject.kind === 'scope') return 'the discovery scope'
  if (subject.kind === 'schema') return `schema ${subject.schema}`
  if (subject.kind === 'object') return describeRef(subject.object)
  return `${describeRef(subject.object)}, ${subject.kind} ${subject.name}`
}

/** What an operation the published form offered can still do, from the report and the bundle. */
function operationState(offered: boolean | undefined, writable: boolean): string {
  if (offered === false) return 'never offered by this form'
  if (writable) return 'still allowed'
  return 'blocked by the changes below'
}

function labelIn(published: Published | null, key: string): string {
  const label = published?.bundle.form.model.fields.find((field) => field.key === key)?.label
  return typeof label === 'string' ? `${label} (${key})` : key
}

function Change({ change, published }: { change: DriftChange; published: Published | null }): ReactElement {
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

type Checked = { formId: string; drift: Drift; published: Published | null } | { failure: string }

/**
 * Step 9: a published form against the database as it is now (plan sections 3
 * and 14), classified by the server against the form's own bindings (0010).
 *
 * Any published form, by id: the plane has no route that lists them, so the
 * id is typed, and defaults to the form this session generated. Each change is
 * shown with its severity, what that severity stops, and the fields it
 * touches; above them, what the published form may still do.
 */
export function DriftStep({ client, formId: initial }: { client: AdminClient; formId: string }): ReactElement {
  const [formId, setFormId] = useState(initial)
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState<Checked | null>(null)

  async function check(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    // Not disabled while checking: a disabled button drops the keyboard's focus.
    if (checking) return
    const id = formId.trim()
    if (!isFormId(id)) {
      setChecked({ failure: `${id === '' ? 'An empty id' : id} is not a form id: lower-case letters, digits, dot, hyphen or underscore.` })
      return
    }
    setChecking(true)
    const [drift, latest] = await Promise.all([client.drift(id), client.latest(id)])
    setChecking(false)
    setChecked(drift.ok ? { formId: id, drift: drift.value, published: latest.ok ? latest.value : null } : { failure: drift.message })
  }

  return (
    <>
      <p className="lede">
        Compare a published form with its database as it is now. Only what the form rests on is compared: its table and its
        lookups&rsquo; targets. Something this connection can no longer see is an access change, never a deletion.
      </p>
      <form className="inline-form" onSubmit={(event) => void check(event)} noValidate>
        <div className="field">
          <label htmlFor="drift-form-id">Form id</label>
          <input id="drift-form-id" value={formId} spellCheck={false} onChange={(event) => setFormId(event.target.value)} />
        </div>
        <button type="submit" className="primary">
          Check drift
        </button>
      </form>
      {checked === null ? null : 'failure' in checked ? (
        <p role="alert" className="problem-box">
          {checked.failure}
        </p>
      ) : (
        <DriftReportView drift={checked.drift} published={checked.published} formId={checked.formId} />
      )}
    </>
  )
}

function DriftReportView({ drift, published, formId }: { drift: Drift; published: Published | null; formId: string }): ReactElement {
  const blocking = drift.changes.filter((change) => change.severity === 'blocking').length
  const offered = published?.bundle.bindings.operations
  return (
    <section className="drift" aria-labelledby="drift-heading">
      <h3 id="drift-heading">
        Version {drift.version} of {formId}, against the database now
      </h3>
      <p role="status">
        {drift.changes.length === 0
          ? `Nothing this form rests on has changed since version ${String(drift.version)} was published.`
          : `${String(drift.changes.length)} ${drift.changes.length === 1 ? 'change' : 'changes'}, ${String(blocking)} blocking.`}
      </p>
      <h4 id="still-heading">What the published form may still do</h4>
      <ul aria-labelledby="still-heading" className="still">
        <li>Create: {operationState(offered?.create, drift.writable.create)}</li>
        <li>Update: {operationState(offered?.update, drift.writable.update)}</li>
        <li>{drift.blocking ? 'As a whole: not to be used as published until the blocking changes are reviewed.' : 'As a whole: usable as published.'}</li>
      </ul>
      {SEVERITIES.map(({ severity, heading, blocks }) => {
        const changes = drift.changes.filter((change) => change.severity === severity)
        if (changes.length === 0) return null
        return (
          <div key={severity} className="severity-group" data-severity={severity}>
            <h4 id={`drift-${severity}`}>{heading}</h4>
            <p className="means">{blocks}</p>
            <ul aria-labelledby={`drift-${severity}`}>
              {changes.map((change, index) => (
                // A change is its subject and kind; the server's order is the order to read them in.
                <Change key={index} change={change} published={published} />
              ))}
            </ul>
          </div>
        )
      })}
    </section>
  )
}
