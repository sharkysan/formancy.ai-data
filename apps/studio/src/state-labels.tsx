import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { statesOf } from '@formancy/data-core'
import type { FormPolicy, StateLabel } from '@formancy/data-core'

/*
 * The labels of a state field's states (0129), in the Presentation step,
 * after the list views: a box for each state the policy's moves name, in
 * the order they name them, labelled "Label of placed". Empty, a state is
 * offered on the host page as its column spells it. Drawn only where the
 * policy holds a field to moves, which the Policy step before it decides.
 *
 * A box keeps what is typed; what is kept is the words without the spaces
 * around them, so a label never starts or ends with one, which the server
 * refuses. Only the states the policy names are kept: a label of a state
 * the policy no longer names is neither shown here nor published.
 */

const HEADING = 'state-labels-heading'

/** `labels` with `state`'s label set to `text`, or removed where it holds no words, in the order of `states`. */
function relabelled(labels: readonly StateLabel[], states: readonly string[], state: string, text: string): StateLabel[] {
  const label = (of: string): string => (of === state ? text.trim() : (labels.find((entry) => entry.state === of)?.label ?? ''))
  return states.flatMap((of) => (label(of) === '' ? [] : [{ state: of, label: label(of) }]))
}

/** One state's box: what was typed kept as typed, its words committed on every change. */
function StateLabelInput({ id, state, value, commit }: { id: string; state: string; value: string; commit: (text: string) => void }): ReactElement {
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    // Another box, or a draft taken up, changed what is kept: the box follows unless it already says it.
    setDraft((typed) => (typed.trim() === value ? typed : value))
  }, [value])
  return (
    <div className="field">
      <label htmlFor={id}>Label of {state}</label>
      <input
        id={id}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          commit(event.target.value)
        }}
      />
    </div>
  )
}

export function StateLabelsPanel({
  policy,
  labels,
  onLabels,
}: {
  policy: FormPolicy
  labels: readonly StateLabel[]
  onLabels: (labels: StateLabel[]) => void
}): ReactElement | null {
  const states = statesOf(policy)
  const field = policy.transitions?.field
  if (field === undefined || states.length === 0) return null
  return (
    <section className="state-labels" aria-labelledby={HEADING}>
      <h3 id={HEADING}>State labels</h3>
      <p className="hint">
        How the states of {field} are offered on the host page, where a person moves a record from one to the next. Left empty, a state is offered as its column
        spells it.
      </p>
      {states.map((state, index) => (
        <StateLabelInput
          key={state}
          id={`state-label-${String(index)}`}
          state={state}
          value={labels.find((entry) => entry.state === state)?.label ?? ''}
          commit={(text) => onLabels(relabelled(labels, states, state, text))}
        />
      ))}
    </section>
  )
}
