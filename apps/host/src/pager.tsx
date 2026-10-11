import type { ReactElement, RefObject } from 'react'
import type { Said } from './leave.js'
import { Words } from './words.js'

/** What a grid's status line says, and the help and recovery that belong to it. */
export interface Status {
  kind: 'loading' | 'answer' | 'refused'
  text: Said
  help: string | null
  /** Clear search: nothing matched what was searched for. */
  clear: boolean
  /** Ask again: the server refused the page. */
  retry: boolean
}

/**
 * A grid's pager (UX-SPEC §5.8): the status line, read as one unit with its
 * help and its one recovery, then Previous rows and Next rows. The buttons
 * are `aria-disabled` at either end, never `disabled`, which would drop the
 * keyboard (0029); so is Ask again while it is asking.
 */
export function Pager({
  status,
  first,
  last,
  asking,
  retryRef,
  onClear,
  onRetry,
  onPrevious,
  onNext,
}: {
  status: Status
  first: boolean
  last: boolean
  asking: boolean
  retryRef: RefObject<HTMLButtonElement | null>
  onClear: (() => void) | undefined
  onRetry: () => void
  onPrevious: () => void
  onNext: () => void
}): ReactElement {
  return (
    <div className="pager">
      <div className="status-cell">
        <p role="status" className="status" data-kind={status.kind}>
          <Words said={status.text} />
        </p>
        {status.help === null ? null : <p className="hint">{status.help}</p>}
        {status.clear ? (
          <button type="button" className="button" onClick={onClear}>
            Clear search
          </button>
        ) : null}
        {status.retry ? (
          <button type="button" className="button" ref={retryRef} aria-disabled={asking ? 'true' : undefined} onClick={onRetry}>
            Ask again
          </button>
        ) : null}
      </div>
      <div className="actions">
        <button type="button" className="button" aria-disabled={first ? 'true' : 'false'} onClick={onPrevious}>
          Previous rows
        </button>
        <button type="button" className="button" aria-disabled={last ? 'true' : 'false'} onClick={onNext}>
          Next rows
        </button>
      </div>
    </div>
  )
}
