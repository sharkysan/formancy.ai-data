import { useId } from 'react'
import type { ReactElement, RefObject } from 'react'
import type { Said } from './leave.js'
import { ServerDid } from './server-did.js'
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
  /** The how-manyth answer of the server the line says, whose words are drawn in its teal for a moment (0146); null for the page's own words. */
  said: number | null
}

/**
 * A grid's pager (UX-SPEC §5.8): the status line, read as one unit with its
 * help and its one recovery, then Previous rows and Next rows. The buttons
 * are `aria-disabled` at either end, never `disabled`, which would drop the
 * keyboard (0029); so is Ask again while it is asking. While a refused new
 * list stands (`waits`, 0146) both are `aria-disabled` and described by the
 * line and its help, which say why: the rows shown are the list before.
 */
export function Pager({
  status,
  first,
  last,
  waits = false,
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
  /** A refused new list stands: both buttons wait for it. */
  waits?: boolean
  asking: boolean
  retryRef: RefObject<HTMLButtonElement | null>
  onClear: (() => void) | undefined
  onRetry: () => void
  onPrevious: () => void
  onNext: () => void
}): ReactElement {
  const id = useId()
  const why = waits ? (status.help === null ? `${id}-line` : `${id}-line ${id}-help`) : undefined
  return (
    <div className="pager">
      <div className="status-cell">
        <p role="status" id={`${id}-line`} className="status" data-kind={status.kind}>
          {status.said === null ? (
            <Words said={status.text} />
          ) : (
            <ServerDid said={status.said}>
              <Words said={status.text} />
            </ServerDid>
          )}
        </p>
        {status.help === null ? null : (
          <p id={`${id}-help`} className="hint">
            {status.help}
          </p>
        )}
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
        <button type="button" className="button" aria-disabled={first || waits ? 'true' : 'false'} aria-describedby={why} onClick={onPrevious}>
          Previous rows
        </button>
        <button type="button" className="button" aria-disabled={last || waits ? 'true' : 'false'} aria-describedby={why} onClick={onNext}>
          Next rows
        </button>
      </div>
    </div>
  )
}
