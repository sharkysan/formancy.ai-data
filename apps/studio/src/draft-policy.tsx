import type { ReactElement } from 'react'
import type { DeleteAction, FormBindings, FormPolicy, RowFilterRule } from '@formancy/data-core'
import type { FormSchema } from '@formancy/spec'
import { describeRef } from './choice.js'
import { labelOf } from './document.js'
import { lookupBindings } from './policy-model.js'

const OPERATIONS = ['read', 'create', 'update', 'delete'] as const

/** An action as SQL spells it, as the Policy step's delete reach names an acceptance. */
const SPELLED: Readonly<Record<DeleteAction, string>> = { cascade: 'CASCADE', 'set-null': 'SET NULL', 'set-default': 'SET DEFAULT' }

/** Roles as the end of a sentence: the list, or nobody, which is what deny by default grants. */
const roles = (list: readonly string[] | undefined) => (list === undefined || list.length === 0 ? 'nobody' : list.join(', '))

/** Rules as the Policy step's rows have them: a column, and the trusted attribute it equals. */
const rules = (list: readonly RowFilterRule[]) => list.map((rule) => `${rule.column} = trusted attribute ${rule.attribute}`).join(', and ')

/**
 * A draft's policy, as the publisher approving it reads it (0065): who may
 * read, create, update and delete; each field's read and write roles;
 * which rows of the root and of each lookup's table are in reach, and
 * through which lookups the root's are reached; the moves its state field
 * is held to (0112); and the foreign keys a delete may act through. In the Policy step's words, and nothing to edit:
 * a change is another draft. The paper beside it shows what the people
 * filling the form in see; this says who they are, and what approving it
 * grants them.
 */
export function DraftPolicy({ policy, bindings, document }: { policy: FormPolicy; bindings: FormBindings; document: FormSchema }): ReactElement {
  const root = describeRef(bindings.root)
  const lookups = lookupBindings(bindings)
  const through = lookups.filter((binding) => (policy.through ?? []).includes(binding.field)).map((binding) => labelOf(document, binding.field))
  const cascades = policy.cascades ?? []
  const moves = policy.transitions
  const reach =
    policy.rowFilters.length > 0
      ? `Row filters on ${root}: ${rules(policy.rowFilters)}.`
      : through.length > 0
        ? `No row filter on ${root}: its rows are reached through ${through.join(' and ')} alone.`
        : `No row filter: every row of ${root} is in reach of anybody an operation names.`
  return (
    <section className="draft-policy" aria-labelledby="draft-policy">
      <h4 id="draft-policy">Its policy</h4>
      <h5 id="draft-operations">Who may do what</h5>
      <ul aria-labelledby="draft-operations">
        {OPERATIONS.map((operation) => (
          <li key={operation}>{`Roles that may ${operation}: ${roles(policy.operations[operation])}.`}</li>
        ))}
      </ul>
      <h5 id="draft-fields">Fields</h5>
      <ul aria-labelledby="draft-fields">
        {bindings.fields.map((binding) => {
          const entry = policy.fields[binding.field]
          const written = binding.writes.create || binding.writes.update
          return <li key={binding.field}>{`${labelOf(document, binding.field)} (${binding.field}): read roles ${roles(entry?.read)}; ${written ? `write roles ${roles(entry?.write)}` : 'never written by this form'}.`}</li>
        })}
      </ul>
      <h5 id="draft-rows">Rows</h5>
      <ul aria-labelledby="draft-rows">
        <li>{reach}</li>
        {lookups.map((binding) => {
          const label = labelOf(document, binding.field)
          const offered = Object.hasOwn(policy.lookups, binding.field) ? policy.lookups[binding.field] : undefined
          const what = offered === undefined ? 'not decided' : offered.length === 0 ? `every row of ${describeRef(binding.target.table)}` : rules(offered)
          const scoping = (policy.through ?? []).includes(binding.field) ? ` Only rows of ${root} whose ${label} is one of these.` : ''
          return <li key={binding.field}>{`Rows the ${label} list may offer: ${what}.${scoping}`}</li>
        })}
      </ul>
      {moves === undefined ? null : (
        <>
          <h5 id="draft-moves">{`Moves of ${labelOf(document, moves.field)} (${moves.field})`}</h5>
          <ul aria-labelledby="draft-moves">
            {moves.moves.map((move) => (
              <li key={`${move.from ?? ''}/${move.to}`}>{`${move.from === null ? 'A new record starts at' : `From ${move.from} to`} ${move.to}: roles ${roles(move.roles)}.`}</li>
            ))}
          </ul>
          <p>Every other change of it is refused.</p>
        </>
      )}
      {cascades.length === 0 ? null : (
        <>
          <h5 id="draft-delete">What a delete also does</h5>
          <ul aria-labelledby="draft-delete">
            {cascades.map((rule) => (
              <li key={`${describeRef(rule.table)}/${rule.foreignKey}`}>{`${rule.foreignKey} of ${describeRef(rule.table)}, as ON DELETE ${SPELLED[rule.onDelete]}.`}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
