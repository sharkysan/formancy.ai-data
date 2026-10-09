import { useState } from 'react'
import type { ReactElement } from 'react'
import { findObject } from '@formancy/data-core'
import type { FormPolicy, MetadataSnapshot, RowFilterRule } from '@formancy/data-core'
import { describeRef } from './choice.js'
import type { LookupBinding } from './policy-model.js'

/** The attribute a new rule starts with until somebody types another. */
const DEFAULT_ATTRIBUTE = 'tenant'

/**
 * Rules of the one shape a row filter has: this column equals this trusted
 * attribute. Equality with a value from the verified context and nothing more
 * expressive, on purpose (0011): there is no operator to choose, because a
 * second one would be SQL somebody wrote.
 */
function RuleList({ prefix, what, rules, columns, onRules }: { prefix: string; what: string; rules: readonly RowFilterRule[]; columns: readonly string[]; onRules: (next: RowFilterRule[]) => void }): ReactElement {
  const replace = (at: number, rule: RowFilterRule) => onRules(rules.map((entry, index) => (index === at ? rule : entry)))
  return (
    <ol className="rules">
      {rules.map((rule, index) => {
        const id = `${prefix}-${String(index)}`
        const name = `${what} ${String(index + 1)}`
        const offered = columns.includes(rule.column) ? columns : [rule.column, ...columns]
        return (
          <li key={id} className="rule">
            <div className="field">
              <label htmlFor={`${id}-column`}>
                Column{' '}<span className="visually-hidden">of {name}</span>
              </label>
              <select id={`${id}-column`} value={rule.column} onChange={(event) => replace(index, { ...rule, column: event.target.value })}>
                {offered.map((column) => (
                  <option key={column} value={column}>
                    {column === '' ? 'Choose a column' : column}
                  </option>
                ))}
              </select>
            </div>
            <span className="equals" aria-hidden="true">
              =
            </span>
            <div className="field">
              <label htmlFor={`${id}-attribute`}>
                Trusted attribute{' '}<span className="visually-hidden">of {name}</span>
              </label>
              <input id={`${id}-attribute`} value={rule.attribute} spellCheck={false} onChange={(event) => replace(index, { ...rule, attribute: event.target.value })} />
            </div>
            <button type="button" className="button" onClick={() => onRules(rules.filter((_, at) => at !== index))}>
              Remove{' '}<span className="visually-hidden">{name}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/** A new rule on the first column nobody has filtered yet. */
function nextRule(rules: readonly RowFilterRule[], columns: readonly string[]): RowFilterRule {
  const taken = new Set(rules.map((rule) => rule.column))
  return { column: columns.find((column) => !taken.has(column)) ?? columns[0] ?? '', attribute: DEFAULT_ATTRIBUTE }
}

/**
 * The root's row filters. They are also the columns the generator pinned, so
 * a change here makes the generated form stale, and the step says so with a
 * way to generate it again.
 */
export function RowFilters({
  root,
  rules,
  columns,
  onRules,
  stale,
  onRegenerate,
}: {
  root: string
  rules: readonly RowFilterRule[]
  columns: readonly string[]
  onRules: (next: RowFilterRule[]) => void
  stale: boolean
  /** Generate again with these pins; a refusal comes back in the generator's words. */
  onRegenerate: () => Promise<string | null>
}): ReactElement {
  const [refused, setRefused] = useState<string | null>(null)
  return (
    <fieldset>
      <legend>Row filters on {root}</legend>
      <p className="hint">
        Which rows of {root} this form reaches: on read and update the filter, on create the values the pinned columns are
        written with, from the signed-in person&rsquo;s attributes and never from the form.
      </p>
      {rules.length === 0 ? (
        <p className="none">
          No row filter: every row of {root} is in reach of anybody an operation names. That is a statement this policy
          makes; a table kept per tenant needs one.
        </p>
      ) : (
        <RuleList prefix="row-filter" what="row filter" rules={rules} columns={columns} onRules={onRules} />
      )}
      <p>
        <button type="button" className="button" onClick={() => onRules([...rules, nextRule(rules, columns)])}>
          Add a row filter
        </button>
      </p>
      {stale ? (
        <div className="notice" role="note">
          <p>
            The form was generated with other pinned columns. The generator shows a pinned column read-only, so until it
            runs again the form and this policy disagree about which fields a person fills in.
          </p>
          <button type="button" className="primary" onClick={() => void onRegenerate().then(setRefused)}>
            Generate again with these pins
          </button>
          {refused === null ? null : (
            <p role="alert" className="problem-box">
              The form was not generated: {refused}
            </p>
          )}
        </div>
      ) : null}
    </fieldset>
  )
}

/**
 * Which rows each lookup may offer. Undecided is its own state, distinct from
 * "every row": `validatePolicy` refuses a lookup the policy says nothing
 * about, and offering every tenant's customers is a choice a person makes,
 * not a default.
 */
export function LookupFilters({
  lookups,
  labels,
  snapshot,
  policy,
  onLookups,
}: {
  lookups: readonly LookupBinding[]
  labels: Readonly<Record<string, string>>
  snapshot: MetadataSnapshot
  policy: FormPolicy
  onLookups: (next: FormPolicy['lookups']) => void
}): ReactElement | null {
  if (lookups.length === 0) return null
  const set = (field: string, rules: RowFilterRule[] | undefined) => {
    const next = { ...policy.lookups }
    if (rules === undefined) delete next[field]
    else next[field] = rules
    onLookups(next)
  }
  return (
    <>
      {lookups.map((binding) => {
        const target = describeRef(binding.target.table)
        const columns = findObject(snapshot, binding.target.table)?.columns.map((column) => column.name) ?? [...binding.target.columns]
        const rules = Object.hasOwn(policy.lookups, binding.field) ? policy.lookups[binding.field] : undefined
        const label = labels[binding.field] ?? binding.field
        return (
          <fieldset key={binding.field}>
            <legend>
              Rows the {label} list may offer
            </legend>
            <p className="hint">
              The {label} field chooses a row of {target}. A choice is checked again on save against these filters, so a
              row they exclude cannot be submitted even by somebody who knows its key.
            </p>
            {rules === undefined ? (
              <p className="cannot-tell">Not decided: the policy is refused until it says which rows of {target} the list may offer.</p>
            ) : rules.length === 0 ? (
              <p className="none">Every row of {target} is offered.</p>
            ) : (
              <RuleList prefix={`lookup-${binding.field}`} what={`${label} filter`} rules={rules} columns={columns} onRules={(next) => set(binding.field, next)} />
            )}
            <p className="actions">
              {rules === undefined ? (
                <button type="button" className="button" onClick={() => set(binding.field, [])}>
                  Offer every row{' '}<span className="visually-hidden">of {target}</span>
                </button>
              ) : null}
              <button type="button" className="button" onClick={() => set(binding.field, [...(rules ?? []), nextRule(rules ?? [], columns)])}>
                Add a filter{' '}<span className="visually-hidden">to the {label} list</span>
              </button>
            </p>
          </fieldset>
        )
      })}
    </>
  )
}
