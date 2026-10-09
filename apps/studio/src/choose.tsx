import { useId, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { findObject } from '@formancy/data-core'
import type { ForeignKeyMeta, MetadataSnapshot, ObjectMeta, RowFilterRule } from '@formancy/data-core'
import type { Failure, ProposalRequest } from './api.js'
import type { Choice } from './choice.js'
import {
  choiceFor,
  choiceProblems,
  describeRef,
  gapsAbout,
  lookupBlocker,
  pinCandidates,
  proposalFor,
  rowversionOf,
  suggestedDisplay,
  versionCandidates,
} from './choice.js'

/** The attribute a newly pinned column is given until somebody types another: the one tenant isolation uses. */
const DEFAULT_ATTRIBUTE = 'tenant'

function LookupChoices({ snapshot, root, choice, onChoice }: { snapshot: MetadataSnapshot; root: ObjectMeta; choice: Choice; onChoice: (next: Choice) => void }): ReactElement {
  const hidden = gapsAbout(snapshot, root.ref).filter((gap) => gap.aspect === 'foreign-keys')
  const toggle = (foreignKey: ForeignKeyMeta, target: ObjectMeta | undefined, on: boolean) => {
    const others = choice.lookups.filter((lookup) => lookup.foreignKey !== foreignKey.name)
    const display = target === undefined ? [] : suggestedDisplay(target, foreignKey.references?.columns ?? [])
    onChoice({ ...choice, lookups: on ? [...others, { foreignKey: foreignKey.name, display }] : others })
  }
  const setDisplay = (foreignKey: string, target: ObjectMeta, column: string, on: boolean) => {
    onChoice({
      ...choice,
      lookups: choice.lookups.map((lookup) => {
        if (lookup.foreignKey !== foreignKey) return lookup
        const wanted = new Set(on ? [...lookup.display, column] : lookup.display.filter((name) => name !== column))
        // The target's own column order, so the same choice always makes the same label.
        return { ...lookup, display: target.columns.map((entry) => entry.name).filter((name) => wanted.has(name)) }
      }),
    })
  }

  return (
    <fieldset>
      <legend>Foreign keys to offer as lookups</legend>
      {root.foreignKeys.length === 0 ? (
        <p className={hidden.length > 0 ? 'cannot-tell' : 'none'}>
          {hidden.length > 0
            ? `Cannot tell whether ${describeRef(root.ref)} has any: ${hidden.map((gap) => gap.detail).join('; ')}`
            : `${describeRef(root.ref)} has no foreign key, so there is nothing to offer as a lookup.`}
        </p>
      ) : (
        root.foreignKeys.map((foreignKey) => {
          const blocker = lookupBlocker(snapshot, foreignKey)
          const target = foreignKey.references === null ? undefined : findObject(snapshot, foreignKey.references.table)
          const chosen = choice.lookups.find((lookup) => lookup.foreignKey === foreignKey.name)
          const id = `lookup-${foreignKey.name}`
          const where = foreignKey.references === null ? 'an unknown target' : describeRef(foreignKey.references.table)
          return (
            <div className="choice" key={foreignKey.name}>
              <div className="check">
                <input
                  type="checkbox"
                  id={id}
                  checked={chosen !== undefined}
                  disabled={blocker !== null}
                  aria-describedby={`${id}-about`}
                  onChange={(event) => toggle(foreignKey, target, event.target.checked)}
                />
                <label htmlFor={id}>Offer {foreignKey.name} as a lookup</label>
              </div>
              <p id={`${id}-about`} className={blocker === null ? 'hint' : 'cannot-tell'}>
                {foreignKey.columns.join(', ')} &rarr; {where}. {blocker}
              </p>
              {chosen === undefined || target === undefined ? null : (
                <fieldset className="nested">
                  <legend>Columns to show for {foreignKey.name}</legend>
                  <p className="hint">What a person recognises a {target.ref.name} by. The first text column is suggested; confirm or change it.</p>
                  {target.columns.map((column) => (
                    <div className="check" key={column.name}>
                      <input
                        type="checkbox"
                        id={`${id}-show-${column.name}`}
                        checked={chosen.display.includes(column.name)}
                        onChange={(event) => setDisplay(foreignKey.name, target, column.name, event.target.checked)}
                      />
                      <label htmlFor={`${id}-show-${column.name}`}>{column.name}</label>
                    </div>
                  ))}
                </fieldset>
              )}
            </div>
          )
        })
      )}
    </fieldset>
  )
}

function Pins({ root, rowFilters, onRowFilters }: { root: ObjectMeta; rowFilters: readonly RowFilterRule[]; onRowFilters: (next: RowFilterRule[]) => void }): ReactElement {
  const hint = useId()
  return (
    <fieldset aria-describedby={hint}>
      <legend>Columns the policy pins to trusted context</legend>
      <p id={hint} className="hint">
        A pinned column is never written from the form. A create takes its value from the signed-in person&rsquo;s attribute,
        and every read, update and lookup is filtered by it: this is how a form is kept to one tenant. The generator shows
        a pinned column read-only, and the policy&rsquo;s row filters are this list.
      </p>
      {pinCandidates(root).map((column) => {
        const rule = rowFilters.find((entry) => entry.column === column.name)
        const id = `pin-${column.name}`
        return (
          <div className="choice pin" key={column.name}>
            <div className="check">
              <input
                type="checkbox"
                id={id}
                checked={rule !== undefined}
                onChange={(event) =>
                  onRowFilters(
                    event.target.checked
                      ? [...rowFilters, { column: column.name, attribute: DEFAULT_ATTRIBUTE }]
                      : rowFilters.filter((entry) => entry.column !== column.name),
                  )
                }
              />
              <label htmlFor={id}>Pin {column.name}</label>
            </div>
            {rule === undefined ? null : (
              <div className="field">
                <label htmlFor={`${id}-attribute`}>Attribute {column.name} is pinned to</label>
                <input
                  id={`${id}-attribute`}
                  value={rule.attribute}
                  spellCheck={false}
                  onChange={(event) => onRowFilters(rowFilters.map((entry) => (entry.column === column.name ? { ...entry, attribute: event.target.value } : entry)))}
                />
              </div>
            )}
          </div>
        )
      })}
    </fieldset>
  )
}

function VersionColumn({ root, choice, onChoice }: { root: ObjectMeta; choice: Choice; onChoice: (next: Choice) => void }): ReactElement {
  const rowversion = rowversionOf(root)
  if (rowversion !== undefined) {
    return (
      <p className="hint">
        {describeRef(root.ref)} has a rowversion column, <code>{rowversion.name}</code>: the database changes it on every
        update, so a stale save is detected with nothing to confirm.
      </p>
    )
  }
  return (
    <div className="field">
      <label htmlFor="version-column">Version column</label>
      <select
        id="version-column"
        aria-describedby="version-column-hint"
        value={choice.versionColumn ?? ''}
        onChange={(event) => onChoice({ ...choice, versionColumn: event.target.value === '' ? null : event.target.value })}
      >
        <option value="">None: update is not offered</option>
        {versionCandidates(root).map((column) => (
          <option key={column.name} value={column.name}>
            {column.name}
          </option>
        ))}
      </select>
      <p id="version-column-hint" className="hint">
        {describeRef(root.ref)} has no rowversion. Confirm a column only if every writer of the table increments it on each
        update; without one the form offers no update, because a stale save could not be detected.
      </p>
    </div>
  )
}

/**
 * Step 3: one root table or view, the relationships to offer as lookups and
 * how each is shown, the columns the policy pins, and a version column to
 * confirm when the database keeps none (plan section 3).
 *
 * Everything offered comes from the snapshot: a lookup whose target this
 * connection cannot see is listed and disabled with the gap that explains it,
 * rather than left out as if the relationship did not exist (0004).
 */
export function ChooseStep({
  snapshot,
  connection,
  choice,
  onChoice,
  rowFilters,
  onRowFilters,
  generated,
  onGenerate,
}: {
  snapshot: MetadataSnapshot
  connection: string
  choice: Choice | null
  onChoice: (next: Choice) => void
  rowFilters: readonly RowFilterRule[]
  onRowFilters: (next: RowFilterRule[]) => void
  /** What the form already generated was generated from, which choosing another root replaces. */
  generated: Pick<ProposalRequest, 'connection' | 'root'> | null
  onGenerate: (request: ProposalRequest) => Promise<Failure | null>
}): ReactElement {
  const [pending, setPending] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const root = choice === null ? undefined : findObject(snapshot, choice.root)
  const tables = snapshot.objects.filter((object) => object.kind === 'table')
  const views = snapshot.objects.filter((object) => object.kind === 'view')
  const selected = root === undefined ? '' : String(snapshot.objects.indexOf(root))
  // Choosing a root is what discards a generated form and its policy, here or
  // on another connection; said on the choice, before it is made.
  const replaces =
    generated === null
      ? null
      : generated.connection === connection
        ? `Choosing another root replaces the form generated from ${describeRef(generated.root)}, and its policy.`
        : `Choosing a root on ${connection} replaces the form generated from ${describeRef(generated.root)} on ${generated.connection}, and its policy.`

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    // A second press while the first is on its way does nothing. The button
    // is not disabled for it: a disabled button drops the keyboard's focus.
    if (choice === null || pending) return
    const local = choiceProblems(choice, rowFilters)
    setProblems(local)
    if (local.length > 0) return
    setPending(true)
    const failure = await onGenerate(proposalFor(connection, choice, rowFilters))
    setPending(false)
    if (failure !== null) setProblems([failure.message])
  }

  const option = (object: ObjectMeta) => (
    <option key={describeRef(object.ref)} value={String(snapshot.objects.indexOf(object))}>
      {describeRef(object.ref)}
    </option>
  )

  return (
    <form className="choose" onSubmit={(event) => void submit(event)} noValidate>
      <p className="lede">
        One table or view of <code>{connection}</code> becomes the form. Everything here goes to the generator as asked;
        it decides the fields and says what it chose.
      </p>
      <div className="field">
        {/* Not `root`: index.html mounts the studio in #root, and a label points at the first element with its id. */}
        <label htmlFor="root-object">Root table or view</label>
        <select
          id="root-object"
          aria-describedby={replaces === null ? undefined : 'root-object-replaces'}
          value={selected}
          onChange={(event) => {
            const object = snapshot.objects[Number(event.target.value)]
            if (object !== undefined) onChoice(choiceFor(object.ref))
          }}
        >
          <option value="" disabled>
            Choose one
          </option>
          {tables.length === 0 ? null : <optgroup label="Tables">{tables.map(option)}</optgroup>}
          {views.length === 0 ? null : <optgroup label="Views">{views.map(option)}</optgroup>}
        </select>
        {replaces === null ? null : (
          <p id="root-object-replaces" className="hint">
            {replaces}
          </p>
        )}
      </div>
      {choice === null || root === undefined ? null : (
        <>
          <div className="pair">
            <div className="field">
              <label htmlFor="form-id">Form id</label>
              <input id="form-id" value={choice.formId} spellCheck={false} onChange={(event) => onChoice({ ...choice, formId: event.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="form-title">Title</label>
              <input id="form-title" value={choice.title} onChange={(event) => onChoice({ ...choice, title: event.target.value })} />
            </div>
          </div>
          <LookupChoices snapshot={snapshot} root={root} choice={choice} onChoice={onChoice} />
          <Pins root={root} rowFilters={rowFilters} onRowFilters={onRowFilters} />
          <VersionColumn root={root} choice={choice} onChoice={onChoice} />
          {problems.length === 0 ? null : (
            <div role="alert" className="problem-box">
              <p>The form was not generated:</p>
              <ul>
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </div>
          )}
          {generated !== null ? (
            <p className="hint">
              A form is already generated. Generating again replaces it and starts its presentation afresh; the policy is
              kept, and checked against the new form.
            </p>
          ) : null}
          <p className="next">
            <button type="submit" className="primary">
              Generate the form
            </button>
          </p>
        </>
      )}
    </form>
  )
}
