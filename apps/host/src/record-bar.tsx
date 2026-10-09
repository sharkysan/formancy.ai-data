import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { DataClient } from '@formancy/data-client'
import type { Session } from './session.js'

/**
 * Which record both panes hold: one read by its token, or a new one.
 *
 * Load reads the record once and opens it in both panes, each with its own
 * engine, version and draft from then on -- so the stale case is the ordinary
 * one of two people: load the same record in both, save in one, then save in
 * the other. New opens an empty form in both.
 *
 * Records are addressed by token only. The definition does not say which
 * columns identify a record, so a token comes from a create, a read or the
 * server's lookups, never from a key a person types (0012, 0029).
 */
export function RecordBar({ client, formId, sessions }: { client: DataClient; formId: string; sessions: readonly Session[] }): ReactElement {
  const [record, setRecord] = useState('')
  const [said, setSaid] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)

  async function load(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setRefusal(null)
    setSaid('')
    const read = await client.read(formId, record.trim())
    if (!read.ok) {
      setRefusal(read.message)
      return
    }
    for (const session of sessions) session.open(read.value)
    setSaid(`Loaded record ${String(read.value.record)} into both forms.`)
  }

  function start(): void {
    setRefusal(null)
    for (const session of sessions) session.open()
    setSaid('Both forms are empty, for a new record.')
  }

  return (
    <section className="card record-bar" aria-labelledby="record-heading">
      <h2 id="record-heading" className="card-heading">Record</h2>
      <form className="record-form" onSubmit={(event) => void load(event)}>
        <div className="field">
          <label htmlFor="record-token">Record token</label>
          <input id="record-token" type="text" autoComplete="off" spellCheck={false} value={record} onChange={(event) => setRecord(event.target.value)} />
        </div>
        <div className="actions">
          <button type="submit" className="primary">
            Load
          </button>
          <button type="button" className="button" onClick={start}>
            New record
          </button>
        </div>
      </form>
      <p role="status" className="hint">
        {said}
      </p>
      {refusal === null ? null : (
        <p role="alert" className="problem-box">
          {refusal}
        </p>
      )}
    </section>
  )
}
