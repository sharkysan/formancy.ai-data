import { useState } from 'react'
import type { FormEvent, ReactElement, RefObject } from 'react'

/**
 * Opening a record by its token: a tool few need beside the grid, one of
 * the demo's controls (demo-tools.tsx, 0146), which open themselves when a
 * Load is refused, so the refusal is seen (UX-SPEC D10). The guide's "No
 * such record." step needs it, and so does a person handed a token by
 * somebody else.
 *
 * Records are addressed by token only (0012, 0029). Load goes through the
 * unsaved-changes guard: it replaces the forms on screen.
 */
export function RecordBar({
  refusal,
  loadRef,
  onLoad,
}: {
  /** The server's sentence for the last Load, in an alert under the tool. */
  refusal: string | null
  loadRef: RefObject<HTMLButtonElement | null>
  onLoad: (token: string) => void
}): ReactElement {
  const [record, setRecord] = useState('')

  function load(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    onLoad(record.trim())
  }

  return (
    <div className="token-open">
      <form className="record-bar" onSubmit={load}>
        <label htmlFor="record-token">Record token</label>
        <input id="record-token" type="text" autoComplete="off" spellCheck={false} value={record} onChange={(event) => setRecord(event.target.value)} />
        <button type="submit" className="button" ref={loadRef}>
          Load
        </button>
      </form>
      {refusal === null ? null : (
        <p role="alert" className="problem-box">
          {refusal}
        </p>
      )}
    </div>
  )
}
