import type { ReactElement } from 'react'
import { describeRoutine } from '@formancy/data-core'
import type { ActionBinding, FormBindings, FormPolicy, MetadataSnapshot } from '@formancy/data-core'
import { sameRoutine } from './actions.js'
import { describeRef } from './choice.js'
import { useFocusAfterRender } from './focus.js'
import { orphanActions, withActionRoles } from './policy-model.js'
import { RolesInput } from './roles-input.js'

const strayRemove = (name: string) => `stray-action-${name}-remove`

/** How a run moves the record's version before it calls the routine, as the generator's note says it. */
function moved(binding: ActionBinding): string {
  return binding.move.kind === 'increment' ? `incrementing ${binding.move.column}` : `setting ${binding.move.column} to itself, which moves the rowversion`
}

/**
 * What an action does that this module neither sees nor bounds, said
 * before it is granted and so before the form is published (0163), as
 * 0052 says what a delete also does: the routine is opaque; field grants,
 * state moves and the policy's cascades do not bind it (0159); on a form
 * whose version is a column, a routine writing other rows of the table
 * must move theirs; on SQL Server a RETURN status other than 0 refuses the
 * run; and a routine that reaches past its caller's grants does.
 */
function Notice({ binding, snapshot, root }: { binding: ActionBinding; snapshot: MetadataSnapshot; root: string }): ReactElement {
  const id = `action-${binding.name}-notice`
  const routine = snapshot.routines?.find((candidate) => sameRoutine(candidate.ref, binding.routine))
  return (
    <div className="notice" role="note" aria-labelledby={id}>
      <p id={id}>
        <strong>What {binding.name} does is the deployment&rsquo;s</strong>
      </p>
      <ul>
        <li>
          It calls <code>{describeRoutine(binding.routine)}</code> over the open record after {moved(binding)}, in one transaction. This module guards what it
          hands the routine and the transaction around it, and cannot see what the routine does.
        </li>
        <li>
          Field grants, state moves and the policy&rsquo;s cascades do not bind it: it may write fields no grant lets a person write, move a state outside the
          moves this policy lists, and delete through keys the policy does not accept.
        </li>
        {binding.move.kind === 'increment' ? (
          <li>
            A routine that writes other rows of {root} must increment their {binding.move.column} itself, or a save read before it overwrites what it wrote.
          </li>
        ) : null}
        {snapshot.kind === 'sqlserver' ? (
          <li>
            A RETURN status other than 0 refuses the run, which is rolled back: a procedure that returns one for any other reason is refused on its first run.
          </li>
        ) : null}
        {routine?.reach === 'owner' ? (
          <li>
            It may act beyond this connection&rsquo;s own grants:{' '}
            {snapshot.kind === 'sqlserver'
              ? 'every SQL Server procedure reaches its owner’s objects by ownership chaining.'
              : 'it is SECURITY DEFINER, and runs with its owner’s.'}
          </li>
        ) : null}
      </ul>
    </div>
  )
}

/**
 * Who may run each action the form binds (0159), as `FormPolicy.actions`
 * holds it: a list of roles per action, nobody's until one is typed, and
 * before each the notice of what it does that nothing here binds (0163).
 * Whether a grant fits -- a role that may not read, or may not read a
 * field the action passes -- is `validatePolicy`'s, said by the policy
 * check in its words. A grant for an action the form no longer binds,
 * left from an earlier generation, is listed to be removed.
 */
export function ActionGrants({
  bindings,
  snapshot,
  policy,
  onPolicy,
  check,
}: {
  bindings: FormBindings
  snapshot: MetadataSnapshot
  policy: FormPolicy
  onPolicy: (next: FormPolicy) => void
  /** The policy check's id, where the keyboard goes when the last stray grant is removed. */
  check: string
}): ReactElement | null {
  const focusAfter = useFocusAfterRender()
  const bound = bindings.actions ?? []
  const strays = orphanActions(policy, bindings)
  if (bound.length === 0 && strays.length === 0) return null
  const root = describeRef(bindings.root)
  const remove = (name: string) => {
    onPolicy(withActionRoles(policy, name, []))
    const at = strays.indexOf(name)
    const neighbour = strays[at + 1] ?? strays[at - 1]
    focusAfter(neighbour === undefined ? check : strayRemove(neighbour))
  }
  return (
    <fieldset>
      <legend>Who may run each action</legend>
      <p className="hint">
        A role that may run an action must also read with this form, and read every field the action passes to its routine: the run names the version its person
        read, and the routine is handed nothing its person is kept from. It needs no update, as a database grants EXECUTE without UPDATE. An action nobody is
        given runs for nobody.
      </p>
      {bound.map((binding) => (
        <div className="choice" key={binding.name}>
          <RolesInput
            id={`action-${binding.name}-roles`}
            label={`Roles that may run ${binding.name}`}
            roles={policy.actions?.[binding.name]?.roles ?? []}
            onRoles={(roles) => onPolicy(withActionRoles(policy, binding.name, roles))}
          />
          <Notice binding={binding} snapshot={snapshot} root={root} />
        </div>
      ))}
      {strays.length === 0 ? null : (
        <div className="notice" role="note">
          <p>The policy grants actions this form does not bind, left from an earlier generation:</p>
          <ul>
            {strays.map((name) => (
              <li key={name}>
                <code>{name}</code>{' '}
                <button type="button" id={strayRemove(name)} className="button" onClick={() => remove(name)}>
                  Remove <span className="visually-hidden">the grant of {name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </fieldset>
  )
}
