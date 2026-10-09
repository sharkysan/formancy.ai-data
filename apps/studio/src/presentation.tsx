import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { isLayoutContainer } from '@formancy/builder-core'
import type { BuilderSession, CommandOutcome } from '@formancy/builder-core'
import type { LayoutNode } from '@formancy/spec'
import { CarriedPanel } from './carried.js'
import type { Carried } from './carry.js'
import { labelOf, useDocument } from './document.js'
import { useFocusAfterRender } from './focus.js'

type Said = { ok: boolean; message: string }

/**
 * A label as typed, committed through the session on every change.
 *
 * A blank label is refused here, before the session sees it, because the
 * validator's own refusal of one ("Must be an object.") names the schema and
 * not the problem. Any other refusal is the session's, shown as it says it.
 * Refused, the draft stays in the box and the document keeps its label, and
 * the box says which.
 */
function LabelInput({ id, label, value, commit }: { id: string; label: ReactElement; value: string; commit: (text: string) => CommandOutcome }): ReactElement {
  const [draft, setDraft] = useState(value)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    // An undo, a redo or another control changed the label: the box follows.
    setDraft(value)
    setProblem(null)
  }, [value])
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={draft}
        aria-invalid={problem !== null}
        aria-describedby={problem === null ? undefined : `${id}-problem`}
        onChange={(event) => {
          const text = event.target.value
          setDraft(text)
          if (text.trim() === '') {
            setProblem(`A label needs words a person can read. Until it has some, it stays “${value}”.`)
            return
          }
          const outcome = commit(text)
          setProblem(outcome.ok ? null : `${outcome.message} It stays “${value}”.`)
        }}
      />
      {problem === null ? null : (
        <p id={`${id}-problem`} className="field-problem">
          {problem}
        </p>
      )}
    </div>
  )
}

/**
 * Step 6: labels and arrangement, through the released `@formancy/builder-core`
 * session -- so every edit is checked by formancy's own validator and undone by
 * its own history -- with controls of the studio's own rather than
 * `@formancy/builder-react`'s panes (0024).
 *
 * The controls offer exactly what cannot break a binding: a field's label, a
 * section's label, a field's place among its neighbours, and whether it spans
 * the row. Nothing here adds, removes, renames or retypes a field, because a
 * field is a column the bindings name, and the generator is what decides those.
 * A draft carried from another (0030) lists what could not be carried above
 * the controls, and what it offers is a label too.
 */
export function PresentationStep({ session, carried = null }: { session: BuilderSession; carried?: Carried | null }): ReactElement {
  const document = useDocument(session)
  const [said, setSaid] = useState<Said | null>(null)
  const focusAfter = useFocusAfterRender()
  const layout = document.layouts?.[0]

  function report(outcome: CommandOutcome, done: string): CommandOutcome {
    setSaid(outcome.ok ? { ok: true, message: done } : { ok: false, message: outcome.message })
    return outcome
  }

  function fieldNode(node: Extract<LayoutNode, { kind: 'field' }>, path: number[], siblings: number, inTable: boolean): ReactElement {
    const key = node.path
    const label = labelOf(document, key)
    const at = path[path.length - 1] ?? 0
    const parent = path.slice(0, -1)
    const address = { layout: layout?.name ?? '', path }
    const id = `presentation-${key}`
    const move = (by: -1 | 1) => {
      const outcome = report(session.moveLayoutNode(address, { layout: address.layout, parent, index: at + by }), `Moved ${label} ${by < 0 ? 'up' : 'down'}.`)
      // A move that reaches the end disables the button just pressed; focus
      // goes to its partner rather than falling to the page.
      const end = by < 0 ? at + by === 0 : at + by === siblings - 1
      if (outcome.ok && end) focusAfter(`${id}-${by < 0 ? 'down' : 'up'}`)
    }
    return (
      <li key={key} className="placed">
        <LabelInput
          id={`${id}-label`}
          label={
            <>
              Label{' '}<span className="visually-hidden">of {key}</span>
            </>
          }
          value={label}
          commit={(text) => report(session.setFieldProperty([key], 'label', text), `Labelled ${key} “${text}”.`)}
        />
        <p className="bound">
          Bound field <code>{key}</code>
        </p>
        <div className="actions">
          <button type="button" id={`${id}-up`} className="button" disabled={at === 0} onClick={() => move(-1)}>
            Move up{' '}<span className="visually-hidden">{label}</span>
          </button>
          <button type="button" id={`${id}-down`} className="button" disabled={at === siblings - 1} onClick={() => move(1)}>
            Move down{' '}<span className="visually-hidden">{label}</span>
          </button>
          {inTable ? (
            <span className="check">
              <input
                type="checkbox"
                id={`${id}-span`}
                checked={node.span === 'all'}
                onChange={(event) =>
                  report(
                    session.setLayoutNodeProperty(address, 'span', event.target.checked ? 'all' : undefined),
                    event.target.checked ? `${label} spans the row.` : `${label} takes one column.`,
                  )
                }
              />
              <label htmlFor={`${id}-span`}>
                Full width{' '}<span className="visually-hidden">for {label}</span>
              </label>
            </span>
          ) : null}
        </div>
      </li>
    )
  }

  function nodes(list: readonly LayoutNode[], parent: number[], inTable: boolean): ReactElement {
    const fields = list.flatMap((node, index) => (node.kind === 'field' ? [{ node, index }] : []))
    return (
      <>
        {fields.length === 0 ? null : <ol className="placements">{fields.map(({ node, index }) => fieldNode(node, [...parent, index], list.length, inTable))}</ol>}
        {list.map((node, index) => (node.kind === 'field' || !isLayoutContainer(node) ? null : container(node, [...parent, index])))}
      </>
    )
  }

  function container(node: Extract<LayoutNode, { children: LayoutNode[] }>, path: number[]): ReactElement {
    const id = `layout-${path.join('-')}`
    const name = typeof node.label === 'string' ? node.label : null
    if (name === null) {
      // A grid, a row or a column without a label is arrangement, not a place a
      // person navigates to: no landmark, so a form with two of them does not
      // offer two regions with one name.
      return (
        <div key={id} className={`arrangement ${node.kind}`}>
          {nodes(node.children, path, node.kind === 'table')}
        </div>
      )
    }
    return (
      <section key={id} className={`arrangement ${node.kind}`} aria-labelledby={`${id}-heading`}>
        <h3 id={`${id}-heading`}>{name}</h3>
        <LabelInput
          id={`${id}-label`}
          label={
            <>
              Section label{' '}<span className="visually-hidden">of {name}</span>
            </>
          }
          value={name}
          commit={(text) => report(session.setLayoutNodeLabel({ layout: layout?.name ?? '', path }, text), `Section labelled “${text}”.`)}
        />
        {nodes(node.children, path, node.kind === 'table')}
      </section>
    )
  }

  return (
    <>
      <p className="lede">
        What a person filling the form reads, and in what order. Each field is a column the bindings name, so nothing here
        adds, removes or renames one: that is the generator&rsquo;s, from the table.
      </p>
      {carried === null ? null : <CarriedPanel session={session} carried={carried} report={report} />}
      <div className="toolbar">
        {/* Never disabled: emptying the history would drop the keyboard's focus
            from the button just pressed. With nothing to undo, it says so. */}
        <button type="button" className="button" onClick={() => setSaid({ ok: true, message: session.undo() ? 'Undone.' : 'Nothing to undo.' })}>
          Undo
        </button>
        <button type="button" className="button" onClick={() => setSaid({ ok: true, message: session.redo() ? 'Redone.' : 'Nothing to redo.' })}>
          Redo
        </button>
        <p role="status" className={said?.ok === false ? 'said refused' : 'said'}>
          {said?.message}
        </p>
      </div>
      {layout === undefined ? <p className="none">The form has no arrangement to edit.</p> : nodes(layout.nodes, [], false)}
    </>
  )
}
