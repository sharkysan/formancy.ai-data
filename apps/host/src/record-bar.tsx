import { useState } from 'react'
import type { FormEvent, ReactElement, RefObject } from 'react'

/**
 * Opening a record by its token: a tool few need beside the grid, behind a
 * disclosure that opens itself when a Load is refused, so the refusal is
 * seen (UX-SPEC D10). The guide's "No such record." step needs it, and so
 * does a person handed a token by somebody else.
 *
 * The disclosure is a button that says whether it is expanded, the ARIA
 * pattern, rather than `<details>`, whose summary has no role a person's
 * assistive technology or a test can name it by.
 *
 * Records are addressed by token only (0012, 0029). Load goes through the
 * unsaved-changes guard: it replaces the forms on screen.
 */
export function RecordBar({
  open,
  onToggle,
  refusal,
  loadRef,
  onLoad,
}: {
  open: boolean
  onToggle: (open: boolean) => void
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
      <button type="button" className="button quiet disclosure" aria-expanded={open} aria-controls="token-tool" onClick={() => onToggle(!open)}>
        <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 12 12">
          <path d={open ? 'M2 4l4 4 4-4' : 'M4 2l4 4-4 4'} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Open by record token
      </button>
      <div id="token-tool" hidden={!open}>
        <form className="record-bar" onSubmit={load}>
          <label htmlFor="record-token">Record token</label>
          <input id="record-token" type="text" autoComplete="off" spellCheck={false} value={record} onChange={(event) => setRecord(event.target.value)} />
          <button type="submit" className="button" ref={loadRef}>
            Load
          </button>
        </form>
      </div>
      {refusal === null ? null : (
        <p role="alert" className="problem-box">
          {refusal}
        </p>
      )}
    </div>
  )
}
