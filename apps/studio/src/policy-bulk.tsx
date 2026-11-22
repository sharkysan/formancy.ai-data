import type { ReactElement } from 'react'
import { offeredFor, offers } from '@formancy/data-core'
import type { FormBindings, FormPolicy } from '@formancy/data-core'
import { useFocusAfterRender } from './focus.js'
import { withBulkDeleteRoles } from './policy-model.js'

/** What deleting chosen records together does, read with every box: the host page's confirmation says it again before each request (0174). */
export const TOGETHER_NOTE =
  'A person given this deletes up to a page of the records they chose in one request, each on its own, as a delete of it alone, at the version their page read it at: one that cannot be deleted is named, and the others are deleted. A set can end half deleted, record by record, and nothing is undone.'

/** Why nothing is offered: the form offers no delete at all. */
export const NO_DELETE = 'This form offers no delete, so none of its records are deleted together.'

/** Why nothing is offered: a together child's rows are deleted only in a save of their record (0155). */
export const SAVED_WITH = 'Rows of this form are deleted only with the record they are saved with, in its save, so none are deleted together.'

/** Why nothing is offered yet: nobody may delete with the form. */
export const NOBODY_DELETES = 'Nobody may delete with this form yet: a role given delete above can then be given this too.'

/** Under a role the grant names that may not delete: what the server's policy check says too. */
const mayNot = (role: string): string =>
  `${role} may not delete with this form, so the server refuses this grant until it is unticked or ${role} is given delete above.`

interface GrantProps {
  bindings: FormBindings
  policy: FormPolicy
  onPolicy: (next: FormPolicy) => void
  /** The policy check's id, where the keyboard goes when a grant the form cannot offer is removed. */
  check: string
}

/**
 * Who may delete the chosen records of a page together (0173, 0174), as
 * `FormPolicy.bulk.delete` holds it: a box for each role given delete,
 * unticked by default -- absent is nobody's -- read with a note of what it
 * does. Offered only where a delete of one record is: a form that offers
 * no delete, a together child, whose rows are deleted only in a save of
 * their record (0155), and a form nobody may delete with yet each say why
 * there is nothing to tick. A role the grant names that may not delete --
 * delete taken from it above, or an imported policy -- keeps its box,
 * ticked and described by why the server refuses it, as `validatePolicy`'s
 * check says in its words; on a form that offers none, the grant is listed
 * to be removed (`StrayGrant`).
 *
 * Who may change them (0175), `bulk.update`, has no control here: an
 * administrator writes it by hand, and every edit here keeps it
 * (`withBulkDeleteRoles`). It is no stray grant where the form offers an
 * update alone, nor is a `bulk` that names no operation; one the form
 * cannot offer is the policy check's to name.
 */
export function BulkGrants({ bindings, policy, onPolicy, check }: GrantProps): ReactElement {
  // Here, not in the notice: the notice goes with the grant, before the keyboard is moved.
  const focusAfter = useFocusAfterRender()
  const why = !offers(bindings, 'delete') ? NO_DELETE : !offeredFor(bindings, 'delete', null) ? SAVED_WITH : null
  const remove = (): void => {
    onPolicy(withBulkDeleteRoles(policy, []))
    focusAfter(check)
  }
  const bulk = policy.bulk
  // What the server refuses here and no box can untick: a delete grant, or a `bulk` naming neither operation on a form that offers neither write alone.
  const stray: Stray | null =
    why === null || bulk === undefined
      ? null
      : bulk.delete !== undefined
        ? 'deleting'
        : bulk.update === undefined && !offeredFor(bindings, 'update', null)
          ? 'changing or deleting'
          : null
  return (
    <fieldset>
      <legend>Who may delete chosen records together</legend>
      <p className="hint" id="bulk-note">
        {TOGETHER_NOTE}
      </p>
      {why !== null ? <p className="none">{why}</p> : <RoleBoxes policy={policy} onPolicy={onPolicy} />}
      {stray === null ? null : <StrayGrant what={stray} granted={bulk?.delete?.roles ?? []} onRemove={remove} />}
    </fieldset>
  )
}

/** A box for each role given delete, in its order, then any the grant names besides, each described by why the server refuses it; or why there is none yet. */
function RoleBoxes({ policy, onPolicy }: Pick<GrantProps, 'policy' | 'onPolicy'>): ReactElement {
  const granted = policy.bulk?.delete?.roles ?? []
  const deleters = policy.operations.delete ?? []
  const roles = [...deleters, ...granted.filter((role) => !deleters.includes(role))]
  if (roles.length === 0) return <p className="none">{NOBODY_DELETES}</p>
  const toggled = (role: string, on: boolean): FormPolicy =>
    withBulkDeleteRoles(
      policy,
      roles.filter((each) => (each === role ? on : granted.includes(each))),
    )
  return (
    <>
      {roles.map((role, index) => {
        const id = `bulk-delete-${String(index)}`
        const refused = deleters.includes(role) ? null : `${id}-refused`
        return (
          <div className="choice" key={role}>
            <div className="check">
              <input
                type="checkbox"
                id={id}
                checked={granted.includes(role)}
                aria-describedby={refused === null ? 'bulk-note' : `${refused} bulk-note`}
                onChange={(event) => onPolicy(toggled(role, event.target.checked))}
              />
              <label htmlFor={id}>{role}</label>
            </div>
            {refused === null ? null : (
              <p className="hint" id={refused}>
                {mayNot(role)}
              </p>
            )}
          </div>
        )
      })}
    </>
  )
}

/** What a stray grant grants, as its notice says it: a delete of chosen records, or a `bulk` that names no operation (0175). */
type Stray = 'deleting' | 'changing or deleting'

/**
 * A grant on a form that cannot offer one -- left from a generation that
 * offered delete, or imported -- which the server refuses whatever roles
 * it names: a delete grant, naming nobody among them, or a `bulk: {}` on
 * a form that offers neither write alone. Listed with a Remove, since no
 * box is drawn to untick, which takes the delete grant alone and keeps a
 * change of chosen records beside it.
 */
function StrayGrant({ what, granted, onRemove }: { what: Stray; granted: readonly string[]; onRemove: () => void }): ReactElement {
  return (
    <div className="notice" role="note" aria-labelledby="bulk-stray">
      <p id="bulk-stray">
        {granted.length === 0
          ? `The policy holds a grant of ${what} chosen records together that names nobody, which this form cannot offer.`
          : `The policy grants ${granted.join(', ')} the deletion of chosen records together, which this form cannot offer.`}
      </p>
      <button type="button" className="button" onClick={onRemove}>
        Remove <span className="visually-hidden">the grant of {what} chosen records together</span>
      </button>
    </div>
  )
}
