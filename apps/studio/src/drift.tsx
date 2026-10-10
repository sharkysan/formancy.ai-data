import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { DriftSeverity } from '@formancy/data-core'
import type { Regeneration } from '@formancy/data-server'
import type { AdminClient, Drift, Published } from './api.js'
import { isFormId } from './choice.js'
import { Change } from './drift-change.js'
import { regenerateForm, RegenerationView } from './regenerate.js'
import type { Regenerated } from './regenerate.js'
import { VersionsPanel } from './versions.js'

/**
 * The three severities, most severe first, each with what it stops -- the
 * words are `DriftSeverity`'s own definitions, not new ones.
 */
const SEVERITIES: ReadonlyArray<{ severity: DriftSeverity; heading: string; blocks: string }> = [
  { severity: 'blocking', heading: 'Blocking', blocks: 'Blocks the form as published: a write it offers is stopped, or a field it shows can no longer be read, until it is reviewed.' },
  { severity: 'review', heading: 'Review', blocks: 'Blocks nothing. A person has something to decide.' },
  { severity: 'info', heading: 'Info', blocks: 'Blocks nothing. Recorded so the review is complete.' },
]

/** What an operation the published form offered can still do, from the report and the bundle. */
function operationState(offered: boolean | undefined, writable: boolean): string {
  if (offered === false) return 'never offered by this form'
  if (writable) return 'still allowed'
  return 'blocked by the changes below'
}

/** A list of words as a sentence says it: "read", "read and create", "read, create and update". */
function spoken(words: readonly string[]): string {
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1) as string}`
}

/**
 * The operations review blocks and the server still allows (0041): the
 * server compares only the form's own table when a request arrives, so what
 * blocks them is a change only review sees. Empty when the two agree.
 */
function stillAllowedByServer(drift: Drift, offered: { create: boolean; update: boolean } | undefined): string[] {
  const runtime = drift.runtime
  return [
    ...(!drift.readable && runtime.readable ? ['read'] : []),
    ...(['create', 'update'] as const).filter((operation) => offered?.[operation] !== false && !drift.writable[operation] && runtime.writable[operation]),
  ]
}

/**
 * A check's answer. A failure names the form when it has versions to offer
 * anyway: a newest version edited on disk is not served, and restoring an
 * older one over it is the way back (0030).
 */
type Checked = { formId: string; drift: Drift; published: Published | null } | { failure: string; formId?: string }

/** The refusals of a published form whose versions are still listed and may be restored. */
const VERSIONS_STILL_OFFERED = new Set(['corrupt-bundle', 'unavailable'])

/**
 * Step 9: a published form against the database as it is now (plan sections 3
 * and 14), classified by the server against the form's own bindings (0010).
 *
 * Any published form, by id: the plane has no route that lists them, so the
 * id is typed, and defaults to the form this session generated. Each change is
 * shown with its severity, what that severity stops, and the fields it
 * touches; above them, what the published form may still do.
 *
 * Once checked, the two answers to drift (0030): regenerate the form from
 * the database now, keeping its presentation, as a draft to review and
 * publish; or restore an older version, when the database can still serve
 * it. The versions are offered too when the newest one is not served or the
 * database cannot be read, because a restore over it is the way back.
 */
export function DriftStep({
  client,
  formId: initial,
  onRegenerated,
}: {
  client: AdminClient
  formId: string
  /** Continue with a regeneration as the draft: the Workbench takes it from here. */
  onRegenerated: (regeneration: Regeneration, fresh: string[]) => void
}): ReactElement {
  const [formId, setFormId] = useState(initial)
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState<Checked | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  const [regenerated, setRegenerated] = useState<Regenerated | null>(null)

  async function run(id: string): Promise<void> {
    setChecking(true)
    const [drift, latest] = await Promise.all([client.drift(id), client.latest(id)])
    setChecking(false)
    // A regeneration was of the version checked before; it says nothing about this one.
    setRegenerated(null)
    setChecked(
      drift.ok
        ? { formId: id, drift: drift.value, published: latest.ok ? latest.value : null }
        : { failure: drift.message, ...(VERSIONS_STILL_OFFERED.has(drift.code) ? { formId: id } : {}) },
    )
  }

  async function check(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    // Not disabled while checking: a disabled button drops the keyboard's focus.
    if (checking) return
    const id = formId.trim()
    if (!isFormId(id)) {
      setChecked({ failure: `${id === '' ? 'An empty id' : id} is not a form id: lower-case letters, digits, dot, hyphen or underscore.` })
      return
    }
    await run(id)
  }

  async function regenerate(id: string): Promise<void> {
    if (regenerating) return
    setRegenerating(true)
    setRegenerated(await regenerateForm(client, id))
    setRegenerating(false)
  }

  const versionsOf = checked?.formId

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
        <>
          <DriftReportView drift={reported(checked.drift, regenerated)} published={checked.published} formId={checked.formId} />
          <p className="next">
            <button type="button" className="primary" onClick={() => void regenerate(checked.formId)}>
              Regenerate, keeping your presentation
            </button>
          </p>
          {regenerated === null ? null : <RegenerationView regenerated={regenerated} onContinue={onRegenerated} />}
        </>
      )}
      {versionsOf === undefined ? null : (
        // Keyed by form: one form's chosen version and restore outcome are never shown under another's heading.
        <VersionsPanel key={versionsOf} client={client} formId={versionsOf} onRestored={() => void run(versionsOf)} />
      )}
    </>
  )
}

/** The drift to show: the regeneration's, which is newer, once there is one; the check's until then. */
function reported(drift: Drift, regenerated: Regenerated | null): Drift {
  if (regenerated?.ok === true) return { ...regenerated.regeneration.drift, version: regenerated.regeneration.version }
  if (regenerated?.ok === false && regenerated.drift !== undefined) return { ...regenerated.drift, version: drift.version }
  return drift
}

function DriftReportView({ drift, published, formId }: { drift: Drift; published: Published | null; formId: string }): ReactElement {
  const blocking = drift.changes.filter((change) => change.severity === 'blocking').length
  const offered = published?.bundle.bindings.operations
  const allowedByServer = stillAllowedByServer(drift, offered)
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
        <li>Read: {drift.readable ? 'still allowed' : 'blocked by the changes below'}</li>
        <li>Create: {operationState(offered?.create, drift.writable.create)}</li>
        <li>Update: {operationState(offered?.update, drift.writable.update)}</li>
        <li>{drift.blocking ? 'As a whole: not to be used as published until the blocking changes are reviewed.' : 'As a whole: usable as published.'}</li>
        {allowedByServer.length === 0 ? null : (
          <li>
            The server still allows {spoken(allowedByServer)}: what blocks {allowedByServer.length === 1 ? 'it' : 'them'} is a change it does not compare when a request arrives (a
            lookup&rsquo;s table, privileges, row security or the account). The database still refuses what the account may not do. Review the form and publish it again.
          </li>
        )}
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
