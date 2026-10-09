import type { ReactElement } from 'react'
import type { ReassignedKey } from '@formancy/data-core'
import { useFocusAfterRender } from './focus.js'
import { describeAnchor } from './regenerate.js'

export type Decision = 'keep' | 'remove'

const keep = (key: string) => `reassigned-${key}-keep`

/**
 * Keys that stand for another column or lookup than when the policy's grants
 * were written (0030): order_date, say, once a column renamed to "order date"
 * took the key. A grant names a key, so it would now apply to the other
 * column. The server publishes it all the same -- the key exists -- so the
 * studio holds publishing until a person keeps or removes each, and says it
 * is the one holding it.
 *
 * A decision takes its entry, and the buttons pressed, out of the list. The
 * keyboard goes to the next entry's Keep, and after the last to `after`, the
 * policy check whose verdict the decisions feed.
 */
export function ReassignedKeys({ keys, after, onDecide }: { keys: readonly ReassignedKey[]; after: string; onDecide: (key: string, decision: Decision) => void }): ReactElement | null {
  const focusAfter = useFocusAfterRender()
  if (keys.length === 0) return null
  function decide(entry: ReassignedKey, at: number, decision: Decision): void {
    onDecide(entry.field, decision)
    const neighbour = keys[at + 1] ?? keys[at - 1]
    focusAfter(neighbour === undefined ? after : keep(neighbour.field))
  }
  return (
    <section className="notice reassigned" aria-labelledby="reassigned-heading">
      <h3 id="reassigned-heading">Keys that now stand for something else</h3>
      <p>Each grant below was written for what its key stood for when the policy was. Keep it for what the key stands for now, or remove it.</p>
      <p>The studio holds publishing until each is decided; the server does not, because the key still exists.</p>
      <ul aria-labelledby="reassigned-heading">
        {keys.map((entry, index) => (
          <li key={entry.field}>
            <p>
              Grants for <code>{entry.field}</code> were written for {describeAnchor(entry.was)}; it now stands for {describeAnchor(entry.now)}.
            </p>
            <p className="actions">
              <button type="button" id={keep(entry.field)} className="button" onClick={() => decide(entry, index, 'keep')}>
                Keep grants for {entry.field}
              </button>
              <button type="button" className="button" onClick={() => decide(entry, index, 'remove')}>
                Remove grants for {entry.field}
              </button>
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
