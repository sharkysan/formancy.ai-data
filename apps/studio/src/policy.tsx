import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { BuilderSession } from '@formancy/builder-core'
import { validatePolicy } from '@formancy/data-core'
import type { FormBindings, FormPolicy, MetadataSnapshot } from '@formancy/data-core'
import { describeRef } from './choice.js'
import { labelOf, useDocument } from './document.js'
import { LookupFilters, RowFilters } from './policy-filters.js'
import { boundColumns, fillFromOperations, formatRoles, lookupBindings, orphanFields, orphanLookups, parseRoles, withFieldRoles } from './policy-model.js'

/**
 * A list of roles as text, kept as typed.
 *
 * The draft is the person's; the roles are what it parses to. A change from
 * outside -- "fill every field" -- replaces the draft, and typing never does:
 * otherwise the comma just typed would vanish before the next role could be.
 */
function RolesInput({ id, label, roles, onRoles }: { id: string; label: ReactElement | string; roles: readonly string[]; onRoles: (roles: string[]) => void }): ReactElement {
  const [draft, setDraft] = useState(formatRoles(roles))
  useEffect(() => {
    if (formatRoles(parseRoles(draft)) !== formatRoles(roles)) setDraft(formatRoles(roles))
    // Only an outside change to the roles resets the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles])
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={draft}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => {
          setDraft(event.target.value)
          onRoles(parseRoles(event.target.value))
        }}
      />
    </div>
  )
}

const OPERATIONS = ['read', 'create', 'update'] as const

/**
 * Whether the policy fits the form, in the words `validatePolicy` uses -- the
 * function the server runs on publish (0019) -- recomputed on every change.
 * The summary is a polite live region; the list is what a person fixes from.
 */
function PolicyCheck({ problems }: { problems: readonly string[] }): ReactElement {
  return (
    <section className="policy-check" aria-labelledby="check-heading" data-ok={problems.length === 0}>
      <h3 id="check-heading">Policy check</h3>
      <p role="status">
        {problems.length === 0
          ? 'The policy fits this form.'
          : `${String(problems.length)} ${problems.length === 1 ? 'problem' : 'problems'}: the server refuses this policy until ${problems.length === 1 ? 'it is' : 'they are'} fixed.`}
      </p>
      {problems.length === 0 ? null : (
        <ul aria-labelledby="check-heading">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Step 5: who may do what with this form (`FormPolicy`), kept apart from the
 * form and its bindings (plan section 9).
 *
 * Deny by default, as the policy is: an operation lists the roles that may
 * perform it, a field nobody is given is nobody's, and a lookup nobody
 * decided is refused. Nothing here judges whether the policy fits -- that is
 * `validatePolicy`, run on every change and shown in its own words.
 */
export function PolicyStep({
  bindings,
  snapshot,
  session,
  policy,
  onPolicy,
  stale,
  onRegenerate,
}: {
  bindings: FormBindings
  snapshot: MetadataSnapshot
  session: BuilderSession
  policy: FormPolicy
  onPolicy: (next: FormPolicy) => void
  stale: boolean
  onRegenerate: () => Promise<string | null>
}): ReactElement {
  const document = useDocument(session)
  const checked = validatePolicy(policy, bindings)
  const problems = checked.ok ? [] : checked.problems
  const labels = Object.fromEntries(bindings.fields.map((binding) => [binding.field, labelOf(document, binding.field)]))
  const pinned = new Set(policy.rowFilters.map((rule) => rule.column))
  const orphans = orphanFields(policy, bindings)
  const strayLookups = orphanLookups(policy, bindings)

  return (
    <>
      <p className="lede">
        Who may read, create and update with this form, field by field, and which rows of {describeRef(bindings.root)} and
        of each lookup it reaches. Roles are the names your host puts in its tokens, separated by commas.
      </p>
      <PolicyCheck problems={problems} />

      <fieldset>
        <legend>Who may do what</legend>
        {OPERATIONS.map((operation) => (
          <RolesInput
            key={operation}
            id={`operation-${operation}`}
            label={`Roles that may ${operation}`}
            roles={policy.operations[operation]}
            onRoles={(roles) => onPolicy({ ...policy, operations: { ...policy.operations, [operation]: roles } })}
          />
        ))}
        <p className="hint">
          This form offers create: {bindings.operations.create ? 'yes' : 'no'}; update: {bindings.operations.update ? 'yes' : 'no'}.
          A role granted an operation the form does not offer is refused.
        </p>
      </fieldset>

      <fieldset>
        <legend>Fields</legend>
        <p className="hint">A field nobody may read is not sent to anybody; a field nobody may write is refused when submitted.</p>
        <p>
          <button type="button" className="button" onClick={() => onPolicy(fillFromOperations(policy, bindings))}>
            Fill every field from the operations
          </button>
        </p>
        <ul className="field-roles">
          {bindings.fields.map((binding) => {
            const entry = policy.fields[binding.field]
            const label = labels[binding.field] ?? binding.field
            const why = !binding.writable ? 'Never written by this form.' : binding.kind === 'column' && pinned.has(binding.column) ? 'Pinned by a row filter.' : null
            return (
              <li key={binding.field}>
                <p className="field-name">
                  {label} <code>{binding.field}</code>
                </p>
                <RolesInput
                  id={`read-${binding.field}`}
                  label={
                    <>
                      Read roles{' '}<span className="visually-hidden">for {label}</span>
                    </>
                  }
                  roles={entry?.read ?? []}
                  onRoles={(read) => onPolicy(withFieldRoles(policy, binding.field, read, entry?.write ?? []))}
                />
                {binding.writable ? (
                  <RolesInput
                    id={`write-${binding.field}`}
                    label={
                      <>
                        Write roles{' '}<span className="visually-hidden">for {label}</span>
                      </>
                    }
                    roles={entry?.write ?? []}
                    onRoles={(write) => onPolicy(withFieldRoles(policy, binding.field, entry?.read ?? [], write))}
                  />
                ) : null}
                {why === null ? null : <p className="hint">{why}</p>}
              </li>
            )
          })}
        </ul>
        {orphans.length === 0 ? null : (
          <div className="notice" role="note">
            <p>The policy names fields this form does not have, left from an earlier generation:</p>
            <ul>
              {orphans.map((key) => (
                <li key={key}>
                  <code>{key}</code>{' '}
                  <button type="button" className="button" onClick={() => onPolicy(withFieldRoles(policy, key, [], []))}>
                    Remove{' '}<span className="visually-hidden">{key}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </fieldset>

      <RowFilters
        root={describeRef(bindings.root)}
        rules={policy.rowFilters}
        columns={boundColumns(bindings)}
        onRules={(rowFilters) => onPolicy({ ...policy, rowFilters })}
        stale={stale}
        onRegenerate={onRegenerate}
      />
      <LookupFilters lookups={lookupBindings(bindings)} labels={labels} snapshot={snapshot} policy={policy} onLookups={(lookups) => onPolicy({ ...policy, lookups })} />
      {strayLookups.length === 0 ? null : (
        <div className="notice" role="note">
          <p>The policy filters lookups this form does not have:</p>
          <ul>
            {strayLookups.map((key) => (
              <li key={key}>
                <code>{key}</code>{' '}
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    const lookups = { ...policy.lookups }
                    delete lookups[key]
                    onPolicy({ ...policy, lookups })
                  }}
                >
                  Remove{' '}<span className="visually-hidden">the {key} lookup filter</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
