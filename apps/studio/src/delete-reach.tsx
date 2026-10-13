import type { ReactElement } from 'react'
import { deleteReview, offers } from '@formancy/data-core'
import type { CascadeRule, DeleteAction, FormBindings, FormPolicy, MetadataSnapshot, ReachedKey, ReferentialAction } from '@formancy/data-core'
import { describeRef } from './choice.js'
import { useFocusAfterRender } from './focus.js'
import { withCascade, withoutCascade, withoutCascadeAt } from './policy-model.js'

/** A referential action as SQL spells it. */
const SPELLED: Readonly<Record<ReferentialAction, string>> = {
  'no-action': 'NO ACTION',
  restrict: 'RESTRICT',
  cascade: 'CASCADE',
  'set-null': 'SET NULL',
  'set-default': 'SET DEFAULT',
}

/** The acceptance a box writes: the key's table, its name and the action it has. */
function ruleOf({ key }: ReachedKey): CascadeRule {
  return { table: { schema: key.table.schema, name: key.table.name }, foreignKey: key.name, onDelete: key.onDelete as DeleteAction }
}

/** What the rows a key refers through are, from where the delete stands: the record itself, or a row a cascade of it deletes. */
function referred(root: FormBindings['root'], { onto }: ReachedKey): string {
  return onto.schema === root.schema && onto.name === root.name ? 'it' : `a deleted row of ${describeRef(onto)}`
}

/** What ticking a key's box accepts, as its label: what the key does to the rows that refer through it. */
function effect(root: FormBindings['root'], reached: ReachedKey): string {
  const { key } = reached
  const named = `(${key.name}, ON DELETE ${SPELLED[key.onDelete]})`
  const rows = `the rows of ${describeRef(key.table)} that refer to ${referred(root, reached)}`
  if (key.onDelete === 'cascade') return `Also deletes ${rows} ${named}`
  const columns = key.columns.join(', ')
  const to = key.onDelete === 'set-null' ? 'NULL' : key.columns.length === 1 ? 'its default' : 'their defaults'
  return `Sets ${columns} to ${to} in ${rows} ${named}`
}

/** What a key that only refuses refuses, as a list item. */
function refusal(root: FormBindings['root'], reached: ReachedKey & { on: 'delete' | 'update' }): string {
  const { key, onto, on } = reached
  const rows = `While rows of ${describeRef(key.table)} refer to`
  return on === 'delete'
    ? `${rows} ${referred(root, reached)} (${key.name}, ON DELETE ${SPELLED[key.onDelete]})`
    : `${rows} the reference it would clear in ${describeRef(onto)} (${key.name}, ON UPDATE ${SPELLED[key.onUpdate]})`
}

const strayRemove = (index: number) => `stray-cascade-${String(index)}-remove`

/**
 * Acceptances to remove, each with its Remove: the keyboard goes to the
 * next one's, else the one before's, and when the note closes to `check`,
 * the policy check whose verdict the removal changes.
 */
function Strays({ id, lead, entries, policy, onPolicy, check }: {
  id: string
  lead: string
  entries: ReadonlyArray<{ index: number; rule: CascadeRule }>
  policy: FormPolicy
  onPolicy: (next: FormPolicy) => void
  check: string
}): ReactElement | null {
  const focusAfter = useFocusAfterRender()
  if (entries.length === 0) return null
  function remove(at: number, index: number): void {
    const neighbour = entries[at + 1] ?? entries[at - 1]
    onPolicy(withoutCascadeAt(policy, index))
    // Removing an entry moves every later one up a place in the list, and its Remove's id with it.
    focusAfter(neighbour === undefined ? check : strayRemove(neighbour.index > index ? neighbour.index - 1 : neighbour.index))
  }
  return (
    <div className="notice" role="note" aria-labelledby={id}>
      <p id={id}>{lead}</p>
      <ul aria-labelledby={id}>
        {entries.map(({ index, rule }, at) => {
          const named = `${rule.foreignKey} of ${describeRef(rule.table)}`
          return (
            <li key={`${String(index)}-${named}`}>
              <code>{rule.foreignKey}</code> of {describeRef(rule.table)}, as ON DELETE {SPELLED[rule.onDelete]}{' '}
              <button type="button" id={strayRemove(index)} className="button" onClick={() => remove(at, index)}>
                Remove{' '}<span className="visually-hidden">the acceptance of {named}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * What a delete of one of the form's records also does, asked of an
 * administrator one foreign key at a time (0052): a box for each key that
 * deletes or changes other rows when a record is deleted, the ones past the
 * root included, and none that accepts them all, because a key nobody read
 * is not accepted (0051). Ticked, a box adds the key with its action to the
 * policy's `cascades`.
 *
 * What the database refuses -- a key that only restricts -- is listed, so
 * that a person meets no refusal they could have been told of; what no box
 * can make grantable is said in the publish check's own words; and the list
 * says how much of the reach it is. All of it is `deleteReview`'s, the walk
 * `deleteProblems` refuses a policy by, at publish, on every read and in
 * the planner: the step decides nothing of its own.
 *
 * Shown only where the form offers delete. A form that offers none, with
 * acceptances left from one that did, lists them to be removed.
 */
export function DeleteReach({ bindings, snapshot, policy, onPolicy, check }: {
  bindings: FormBindings
  snapshot: MetadataSnapshot
  policy: FormPolicy
  onPolicy: (next: FormPolicy) => void
  /** The policy check's id, where the keyboard goes when the last acceptance of a note is removed. */
  check: string
}): ReactElement | null {
  const root = describeRef(bindings.root)
  if (!offers(bindings, 'delete')) {
    const left = (policy.cascades ?? []).map((rule, index) => ({ index, rule }))
    return <Strays id="cascades-unoffered" lead="The policy accepts what a delete does, and this form offers no delete" entries={left} policy={policy} onPolicy={onPolicy} check={check} />
  }
  const review = deleteReview(snapshot, bindings.root, policy)
  // A key that sets NULL or a default keeps the rows it reaches: of the keys
  // onto them, the walk reads those onto a column it clears, and no other.
  const clears = review.acting.some(({ key }) => key.onDelete !== 'cascade')
  return (
    <fieldset>
      <legend>What deleting a record of {root} also does</legend>
      <p className="hint">
        {review.complete
          ? `This is every foreign key the catalog shows onto ${root} and onto each table a delete of it removes rows from${
              clears ? ', and every one onto a column it clears: a key onto another column of a row it keeps is not affected, and is not listed' : ''
            }.`
          : `This is not every foreign key a delete of ${root} may act through: what the snapshot cannot see is said below.`}{' '}
        Triggers and rules that run on a delete are not listed, and do what the database defines.
      </p>
      {review.acting.length === 0 ? (
        // Behind a gap, none seen is not none (fail closed): the snapshot cannot establish that nothing acts.
        <p className="none">
          {review.complete
            ? `No foreign key deletes or changes other rows when a record of ${root} is deleted.`
            : `The snapshot shows no foreign key that deletes or changes other rows when a record of ${root} is deleted, and cannot show every one.`}
        </p>
      ) : (
        <>
          <p className="hint" id="reach-acting">
            Each key below deletes or changes other rows when a record is deleted, and those rows are asked of no form&rsquo;s
            policy. Tick each one you accept: a grant of delete is refused while one is not.
          </p>
          {review.acting.map((reached, index) => {
            const id = `cascade-${String(index)}`
            const rule = ruleOf(reached)
            return (
              <div className="choice" key={`${reached.key.table.schema}.${reached.key.table.name}.${reached.key.name}`}>
                <div className="check">
                  <input
                    type="checkbox"
                    id={id}
                    checked={reached.accepted}
                    onChange={(event) => onPolicy(event.target.checked ? withCascade(policy, rule) : withoutCascade(policy, rule))}
                  />
                  <label htmlFor={id}>{effect(bindings.root, reached)}</label>
                </div>
              </div>
            )
          })}
        </>
      )}
      {review.restricting.length === 0 ? null : (
        <>
          <p className="hint" id="reach-refused">
            The database refuses a delete
          </p>
          <ul aria-labelledby="reach-refused">
            {review.restricting.map((reached) => (
              <li key={`${reached.on}-${reached.key.table.schema}.${reached.key.table.name}.${reached.key.name}`}>{refusal(bindings.root, reached)}</li>
            ))}
          </ul>
        </>
      )}
      {review.blocked.length === 0 ? null : (
        <div className="notice" role="note" aria-labelledby="reach-blocked">
          <p id="reach-blocked">
            <strong>Delete cannot be granted on this form, whatever is ticked</strong>
          </p>
          <ul aria-labelledby="reach-blocked">
            {review.blocked.map((clause) => (
              <li key={clause}>{clause}</li>
            ))}
          </ul>
        </div>
      )}
      <Strays id="cascades-stray" lead={`The policy accepts what a delete of ${root} does not do`} entries={review.stray} policy={policy} onPolicy={onPolicy} check={check} />
    </fieldset>
  )
}
