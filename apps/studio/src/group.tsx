import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { defaultGroup, groupProblem } from '@formancy/data-core'
import type { ObjectRef } from '@formancy/data-core'

/*
 * The group the form is listed under (0143), in the Presentation step,
 * after the state labels: one box holding what a host's list of forms puts
 * this one under, which shows the default -- the root schema's name in
 * words -- until another is typed, and No group, which empties it. Empty,
 * the form is listed under no group.
 *
 * The box keeps what is typed; what is kept is the words without the
 * spaces around them, so a group never starts or ends with one, which the
 * server refuses. A group the server would refuse otherwise -- past its
 * length, a control character -- is refused here, in words, and the form
 * keeps the group it had. The publish leaves the group out where it is the
 * default (`publish.tsx`), as the server requires.
 */

const HEADING = 'form-group-heading'
const BOX = 'form-group'

/** Where the form is listed, as the end of a sentence. */
const under = (group: string | null): string => (group === null ? 'under no group' : `under ${group}`)

export function GroupPanel({ root, group, onGroup }: { root: ObjectRef; group: string | null; onGroup: (group: string | null) => void }): ReactElement {
  const kept = group ?? ''
  const [draft, setDraft] = useState(kept)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    // No group, or a draft taken up, changed what is kept: the box follows unless it already says it.
    setDraft((typed) => (typed.trim() === kept ? typed : kept))
  }, [kept])
  const fallback = defaultGroup(root)
  return (
    <section className="form-group" aria-labelledby={HEADING}>
      <h3 id={HEADING}>Group</h3>
      <p className="hint">
        Where a host&rsquo;s list of forms puts this one. {fallback === null ? 'No group' : fallback} is the default, from schema {root.schema}. Left empty, the
        form is listed under no group.
      </p>
      <div className="field">
        <label htmlFor={BOX}>Group</label>
        <input
          id={BOX}
          value={draft}
          aria-invalid={problem !== null}
          aria-describedby={problem === null ? undefined : `${BOX}-problem`}
          onChange={(event) => {
            const text = event.target.value
            setDraft(text)
            const words = text.trim()
            const refused = words === '' ? null : groupProblem(words)
            setProblem(refused === null ? null : `A group ${refused}. Until it fits, the form stays ${under(group)}.`)
            if (refused === null) onGroup(words === '' ? null : words)
          }}
        />
        {problem === null ? null : (
          <p id={`${BOX}-problem`} className="field-problem">
            {problem}
          </p>
        )}
      </div>
      <div className="actions">
        <button
          type="button"
          className="button"
          onClick={() => {
            setDraft('')
            setProblem(null)
            onGroup(null)
          }}
        >
          No group
        </button>
      </div>
    </section>
  )
}
