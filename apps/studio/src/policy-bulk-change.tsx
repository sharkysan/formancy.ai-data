import { useState } from 'react'
import type { ReactElement } from 'react'
import { offeredFor, readTogether, readTogetherReason, unsettableField } from '@formancy/data-core'
import type { FormBindings, FormPolicy } from '@formancy/data-core'
import type { FormSchema } from '@formancy/spec'
import { withBulkUpdate } from './policy-model.js'

/** What changing chosen records together does, read with every box: the host page's confirmation says it again before each request (0176). */
export const CHANGE_NOTE =
  'A person given this changes up to a page of the records they chose in one request, each field ticked here that they tick set to one value in every one, each record on its own, as an update of it alone, at the version their page read it at: one that cannot be changed is named, and the others are changed. A set can end half changed, record by record, and nothing is undone.'

/** Why nothing is offered: the form offers no update of a record alone. */
export const NO_UPDATE = 'This form offers no update, so none of its records are changed together.'

/** Why nothing is offered yet: nobody may update with the form. */
export const NOBODY_UPDATES = 'Nobody may update with this form yet: a role given update above can then be given this too.'

/** While a role or a field, but not both, is ticked: a grant of nobody or of nothing is no grant. */
export const NOTHING_YET = 'Nothing is granted until a role and a field are both ticked.'

/** Under a role the grant names that may not update: what the server's policy check says too. */
const mayNot = (role: string): string =>
  `${role} may not update with this form, so the server refuses this grant until it is unticked or ${role} is given update above.`

interface GrantProps {
  bindings: FormBindings
  policy: FormPolicy
  /** The form as the Presentation step leaves it: what a rule of it reads is asked of it, as the bundle's check asks (0175). */
  document: FormSchema
  /** Each field's label, as the Fields list names it. */
  labels: Readonly<Record<string, string>>
  onPolicy: (next: FormPolicy) => void
}

/** A grant as ticked here: its roles and fields, in the order offered. */
interface Ticked {
  roles: readonly string[]
  fields: readonly string[]
}

const NONE: Ticked = { roles: [], fields: [] }

/**
 * Who may change the chosen records of a page together, and in which
 * fields (0175, 0176), as `FormPolicy.bulk.update` holds it: a box for each
 * role given update and one for each field of the form, none ticked by
 * default -- absent is nobody's -- read with a note of what it does. A
 * field no change of chosen records may set is shown unticked and not
 * offered, saying why in the words of the server's own checks: the key, a
 * field written on create only, one the database writes or the server
 * stamps, one a row filter pins, a version chain's, the field a together
 * child's rows are saved with (`unsettableField`, 0175), and one a rule of
 * the form reads together with another (`readTogether`); so is one nobody
 * given update may write. A field or a role the grant names that is
 * refused keeps its box, ticked, described by why, until it is unticked.
 * Offered only where an update of one record alone is, which a together
 * child's rows have (0155); where nobody may update yet, it says so.
 *
 * What it publishes is exactly `bulk.update { roles, fields }`, and none
 * while no role or no field is ticked: a box ticked alone is held here,
 * said as granting nothing yet, until the other is. A grant on a form that
 * offers no update is the policy check's to name, with no Remove of its
 * own, as 0175 left it.
 */
export function BulkChangeGrant({ bindings, policy, document, labels, onPolicy }: GrantProps): ReactElement {
  const granted = policy.bulk?.update
  // A tick of one kind alone is the step's own until the other's; a whole grant it held that the policy no longer holds is gone.
  const [draft, setDraft] = useState<Ticked>(NONE)
  const shown: Ticked = granted ?? (draft.roles.length > 0 && draft.fields.length > 0 ? NONE : draft)
  const offered = offeredFor(bindings, 'update', null)
  const write = (next: Ticked): void => {
    setDraft(next)
    onPolicy(withBulkUpdate(policy, next.roles, next.fields))
  }
  return (
    <fieldset>
      <legend>Who may change chosen records together, and in which fields</legend>
      <p className="hint" id="bulk-change-note">
        {CHANGE_NOTE}
      </p>
      {!offered ? (
        <p className="none">{NO_UPDATE}</p>
      ) : (
        <>
          <ChangeRoles policy={policy} shown={shown} onTicked={write} />
          {(policy.operations.update ?? []).length === 0 && shown.roles.length === 0 ? null : (
            <ChangeFields bindings={bindings} policy={policy} document={document} labels={labels} shown={shown} onTicked={write} />
          )}
          {(shown.roles.length === 0) === (shown.fields.length === 0) ? null : <p className="hint">{NOTHING_YET}</p>}
        </>
      )}
    </fieldset>
  )
}

/** A box for each role given update, in its order, then any the grant names besides, each described by why the server refuses it; or why there is none yet. */
function ChangeRoles({ policy, shown, onTicked }: { policy: FormPolicy; shown: Ticked; onTicked: (next: Ticked) => void }): ReactElement {
  const updaters = policy.operations.update
  const roles = [...updaters, ...shown.roles.filter((role) => !updaters.includes(role))]
  if (roles.length === 0) return <p className="none">{NOBODY_UPDATES}</p>
  return (
    <fieldset className="nested">
      <legend>Roles that may change them</legend>
      {roles.map((role, index) => {
        const id = `bulk-change-role-${String(index)}`
        const refused = updaters.includes(role) ? null : `${id}-refused`
        return (
          <div className="choice" key={role}>
            <div className="check">
              <input
                type="checkbox"
                id={id}
                checked={shown.roles.includes(role)}
                aria-describedby={refused === null ? 'bulk-change-note' : `${refused} bulk-change-note`}
                onChange={(event) => onTicked({ ...shown, roles: roles.filter((each) => (each === role ? event.target.checked : shown.roles.includes(each))) })}
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
    </fieldset>
  )
}

/**
 * Why no change of chosen records may set `field`, in the server's words
 * after its label, or null where one may: the bindings' and the policy's
 * own refusal (`unsettableField`), a rule's (`readTogether`), or nobody
 * given update writing it.
 */
function refusal(props: Pick<GrantProps, 'bindings' | 'policy'>, together: ReadonlyMap<string, string>, field: string, label: string): string | null {
  const { bindings, policy } = props
  const unsettable = unsettableField(policy, bindings, field)
  if (unsettable !== null) return `${label} ${unsettable}.`
  const target = together.get(field)
  if (target !== undefined) return `${label} ${readTogetherReason(target)}.`
  const writers = policy.fields[field]?.write ?? []
  return policy.operations.update.some((role) => writers.includes(role)) ? null : `Nobody given update may write ${label}.`
}

/** A box for each field of the form, in its order: offered, or unticked and not offered, saying why -- and kept, ticked, where the grant names it. */
function ChangeFields(props: Omit<GrantProps, 'onPolicy'> & { shown: Ticked; onTicked: (next: Ticked) => void }): ReactElement {
  const { bindings, document, labels, shown, onTicked } = props
  const together = readTogether(document)
  const fields = bindings.fields.map((binding) => binding.field)
  return (
    <fieldset className="nested">
      <legend>Fields they may set</legend>
      {fields.map((field, index) => {
        const id = `bulk-change-field-${String(index)}`
        const label = labels[field] ?? field
        const refused = refusal(props, together, field, label)
        const ticked = shown.fields.includes(field)
        return (
          <div className="choice" key={field}>
            <div className="check">
              <input
                type="checkbox"
                id={id}
                checked={ticked}
                disabled={!ticked && refused !== null}
                aria-describedby={refused === null ? 'bulk-change-note' : `${id}-refused bulk-change-note`}
                onChange={(event) =>
                  onTicked({ ...shown, fields: fields.filter((each) => (each === field ? event.target.checked : shown.fields.includes(each))) })
                }
              />
              <label htmlFor={id}>{label}</label>
            </div>
            {refused === null ? null : (
              <p className="cannot-tell" id={`${id}-refused`}>
                {refused}
              </p>
            )}
          </div>
        )
      })}
    </fieldset>
  )
}
