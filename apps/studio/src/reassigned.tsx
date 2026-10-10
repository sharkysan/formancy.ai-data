import type { ReactElement } from 'react'
import { describeReassigned } from '@formancy/data-core'
import type { ReassignedKey } from '@formancy/data-core'
import { useFocusAfterRender } from './focus.js'

export type Decision = 'keep' | 'remove'

const keep = (key: string) => `reassigned-${key}-keep`

/**
 * Keys that stand for another column or lookup than when the policy's grants
 * were written (0030): order_date, say, once a column renamed to "order date"
 * took the key. A grant names a key, so it would now apply to the other
 * column. The studio holds publishing until a person keeps or removes each,
 * and sends each kept key with the publish: the server refuses grants on
 * one it is not told of (0039). A key removed and then given grants again is
 * listed again. Each is said in the sentence the server refuses it in.
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
      <p>Publishing waits until each is decided, and the server refuses grants nobody decided.</p>
      <ul aria-labelledby="reassigned-heading">
        {keys.map((entry, index) => (
          <li key={entry.field}>
            <p>{describeReassigned(entry)}</p>
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
