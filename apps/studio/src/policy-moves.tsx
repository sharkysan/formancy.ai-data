import type { ReactElement } from 'react'
import type { FormBindings, FormPolicy, TransitionMove } from '@formancy/data-core'
import { useFocusAfterRender } from './focus.js'
import { stateFields, withTransitions } from './policy-model.js'
import { RolesInput } from './roles-input.js'

/**
 * A field whose value is a record's state, and the moves each role may make
 * of it (0112): from one value to another, or from nothing, which a create
 * starts. Values are typed as the column holds them; whether they fit, and
 * whether a role may make the move it is given -- update, or create from
 * nothing, and the field's read and write -- is the policy check's, in
 * `validatePolicy`'s words, as everything else on this step is.
 *
 * Removing a move removes the button pressed. The keyboard goes to the
 * Remove of the move that takes its place, and after the last to Add a
 * move, as a row filter's does.
 */
export function StateMoves({
  bindings,
  labels,
  policy,
  onPolicy,
}: {
  bindings: FormBindings
  labels: Readonly<Record<string, string>>
  policy: FormPolicy
  onPolicy: (next: FormPolicy) => void
}): ReactElement {
  const focusAfter = useFocusAfterRender()
  const rule = policy.transitions
  const moves = rule?.moves ?? []
  const fields = stateFields(bindings)
  // A field the policy names and the form no longer offers stays chosen, for the check to say why.
  const offered = rule === undefined || fields.includes(rule.field) ? fields : [rule.field, ...fields]
  const write = (field: string, next: readonly TransitionMove[]) => onPolicy(withTransitions(policy, { field, moves: [...next] }))
  const replace = (field: string, at: number, move: TransitionMove) => write(field, moves.map((entry, index) => (index === at ? move : entry)))
  const remove = (field: string, at: number) => {
    write(field, moves.filter((_, index) => index !== at))
    focusAfter(at < moves.length - 1 ? `move-${String(at)}-remove` : 'move-add')
  }
  return (
    <fieldset>
      <legend>State moves</legend>
      <p className="hint">
        A field whose value is where a record stands, and the moves each role may make of it. An update changes it only by a
        move listed for one of the person&rsquo;s roles; a create starts it by a move from a new record, or leaves it to the
        column&rsquo;s default. Without a state field, every change is the field&rsquo;s write roles alone.
      </p>
      <div className="field">
        <label htmlFor="state-field">State field</label>
        <select
          id="state-field"
          value={rule?.field ?? ''}
          onChange={(event) => onPolicy(withTransitions(policy, event.target.value === '' ? null : { field: event.target.value, moves }))}
        >
          <option value="">None</option>
          {offered.map((field) => (
            <option key={field} value={field}>
              {labels[field] ?? field} ({field})
            </option>
          ))}
        </select>
      </div>
      {rule === undefined ? null : (
        <>
          {moves.length === 0 ? (
            <p className="none">No move yet: until one is added, the policy check refuses the state field.</p>
          ) : (
            <ol className="rules">
              {moves.map((move, index) => {
                const id = `move-${String(index)}`
                const name = `move ${String(index + 1)}`
                return (
                  <li key={id} className="move">
                    <div className="field">
                      <label htmlFor={`${id}-from`}>
                        From{' '}<span className="visually-hidden">in {name}</span>
                      </label>
                      <input
                        id={`${id}-from`}
                        value={move.from ?? ''}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(event) => replace(rule.field, index, { ...move, from: event.target.value === '' ? null : event.target.value })}
                      />
                    </div>
                    <span className="equals" aria-hidden="true">
                      &rarr;
                    </span>
                    <div className="field">
                      <label htmlFor={`${id}-to`}>
                        To{' '}<span className="visually-hidden">in {name}</span>
                      </label>
                      <input
                        id={`${id}-to`}
                        value={move.to}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(event) => replace(rule.field, index, { ...move, to: event.target.value })}
                      />
                    </div>
                    <RolesInput
                      id={`${id}-roles`}
                      label={
                        <>
                          Roles{' '}<span className="visually-hidden">that may make {name}</span>
                        </>
                      }
                      roles={move.roles}
                      onRoles={(roles) => replace(rule.field, index, { ...move, roles })}
                    />
                    <button type="button" id={`${id}-remove`} className="button" onClick={() => remove(rule.field, index)}>
                      Remove{' '}<span className="visually-hidden">{name}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
          <p className="hint">An empty From is a move that starts a new record.</p>
          <p>
            <button type="button" id="move-add" className="button" onClick={() => write(rule.field, [...moves, { from: null, to: '', roles: [] }])}>
              Add a move
            </button>
          </p>
        </>
      )}
    </fieldset>
  )
}
