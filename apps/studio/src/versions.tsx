import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { DriftChange } from '@formancy/data-core'
import type { AdminClient, Published } from './api.js'
import { describeRef } from './choice.js'
import { Change } from './drift-change.js'

type Listed = { state: 'reading' } | { state: 'read'; versions: number[] } | { state: 'failed'; message: string }

type Restored =
  | { kind: 'restored'; version: number; restoredFrom: number }
  | { kind: 'incompatible'; message: string; changes: DriftChange[]; published: Published | null }
  | { kind: 'conflict'; current: number | null }
  | { kind: 'failed'; message: string }

/** A version in one line: what a person recognises it by before restoring it. */
function describeVersion(published: Published): string {
  const { form, bindings, connection } = published.bundle
  const fields = form.model.fields.length
  return `Version ${String(published.version)}: “${typeof form.title === 'string' ? form.title : form.id}”, ${String(fields)} ${fields === 1 ? 'field' : 'fields'}, bound to ${describeRef(bindings.root)} on ${connection}.`
}

/**
 * Restore an older version of a form (0030): republished as the next
 * version, the same document, with the policy it had -- only when drift against
 * it blocks nothing, which the server decides. A restore names the newest
 * version the list was read with, so one published since is a conflict, not
 * a version silently replaced. It is configuration that comes back, never
 * the database.
 */
export function VersionsPanel({ client, formId, onRestored }: { client: AdminClient; formId: string; onRestored: () => void }): ReactElement {
  const [listed, setListed] = useState<Listed>({ state: 'reading' })
  const [reads, setReads] = useState(0)
  const [chosen, setChosen] = useState<number | null>(null)
  const [described, setDescribed] = useState<Published | null>(null)
  const [pending, setPending] = useState(false)
  const [restored, setRestored] = useState<Restored | null>(null)

  useEffect(() => {
    let current = true
    void client.versions(formId).then((outcome) => {
      if (!current) return
      setListed(outcome.ok ? { state: 'read', versions: outcome.value } : { state: 'failed', message: outcome.message })
    })
    return () => {
      current = false
    }
  }, [client, formId, reads])

  const versions = listed.state === 'read' ? listed.versions : []
  const newest = versions.at(-1) ?? null
  const older = versions.slice(0, -1)
  // The choice stays while it is still offered; otherwise the newest older version.
  const selected = chosen !== null && older.includes(chosen) ? chosen : (older.at(-1) ?? null)

  useEffect(() => {
    setDescribed(null)
    if (selected === null) return
    let current = true
    void client.version(formId, selected).then((outcome) => {
      if (current && outcome.ok) setDescribed(outcome.value)
    })
    return () => {
      current = false
    }
  }, [client, formId, selected])

  async function restore(version: number, expectedBase: number): Promise<void> {
    // A second press while the first is on its way does nothing; the button stays enabled, so it keeps the keyboard.
    if (pending) return
    setPending(true)
    setRestored(null)
    const outcome = await client.restore(formId, version, expectedBase)
    if (outcome.ok) {
      setRestored({ kind: 'restored', version: outcome.value.version, restoredFrom: outcome.value.restoredFrom })
      setReads((count) => count + 1)
      onRestored()
    } else if (outcome.code === 'incompatible') {
      // The version itself, for the labels of the fields each change touches.
      const read = await client.version(formId, version)
      setRestored({ kind: 'incompatible', message: outcome.message, changes: outcome.changes ?? [], published: read.ok ? read.value : null })
    } else if (outcome.code === 'conflict') {
      setRestored({ kind: 'conflict', current: outcome.current ?? null })
      setReads((count) => count + 1)
    } else {
      setRestored({ kind: 'failed', message: outcome.message })
    }
    setPending(false)
  }

  return (
    <section className="versions" aria-labelledby="versions-heading">
      <h3 id="versions-heading">Versions of {formId}</h3>
      {listed.state === 'reading' ? (
        <p>Reading which versions are published…</p>
      ) : listed.state === 'failed' ? (
        <p className="problem-box">{listed.message}</p>
      ) : selected === null || newest === null ? (
        <p className="none">Only version {newest ?? 1} is published: there is nothing older to restore.</p>
      ) : (
        <>
          <p className="hint">
            Restoring publishes an older version again as version {newest + 1}, with the policy it had, when the database can
            still serve it. It changes no table.
          </p>
          <div className="inline-form">
            <div className="field">
              <label htmlFor="restore-version">Version to restore</label>
              <select id="restore-version" value={selected} onChange={(event) => setChosen(Number(event.target.value))}>
                {older.map((version) => (
                  <option key={version} value={version}>
                    Version {version}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className="button" onClick={() => void restore(selected, newest)}>
              Restore version {selected}
            </button>
          </div>
          {described === null ? null : <p className="described">{describeVersion(described)}</p>}
        </>
      )}
      {restored === null ? null : restored.kind === 'restored' ? (
        <p role="status" className="done">
          Restored version {restored.restoredFrom} as version {restored.version}: the runtime serves it from now on, with the
          policy it had. The database was not changed.
        </p>
      ) : restored.kind === 'incompatible' ? (
        <div role="alert" className="problem-box">
          <p>{restored.message}</p>
          <h4 id="restore-blocks">What blocks it</h4>
          <ul aria-labelledby="restore-blocks">
            {restored.changes.map((change, index) => (
              <Change key={index} change={change} published={restored.published} />
            ))}
          </ul>
        </div>
      ) : restored.kind === 'conflict' ? (
        <p role="alert" className="problem-box">
          Somebody published {restored.current === null ? 'a version' : `version ${String(restored.current)}`} since the list was
          read. Nothing was restored; the list now shows it.
        </p>
      ) : (
        <p role="alert" className="problem-box">
          {restored.message}
        </p>
      )}
    </section>
  )
}
