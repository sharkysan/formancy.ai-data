import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { DataClient } from '@formancy/data-client'
import { useAfterRender } from './after-render.js'
import type { ChildForm, ParentOpen } from './children.js'
import { paneEntry, useGuardContext, useRegistered } from './guard.js'
import type { PaneEntry } from './guard.js'
import type { Said } from './leave.js'
import { useOpening } from './opening.js'
import { Pane } from './pane.js'
import { renderersOf } from './panes.js'
import type { RendererChoice } from './prefs.js'
import { createSession } from './session.js'
import type { SaveResult } from './session.js'
import { Words } from './words.js'

/** What the section holds: nothing yet, a new row, or its one row. */
type Held = null | { kind: 'new' } | { kind: 'record'; token: string }

/** Where finding the record's row stands. */
type Finding = { kind: 'waiting' } | { kind: 'asking' } | { kind: 'none' } | { kind: 'found' } | { kind: 'refused'; message: string }

/**
 * A child form that is a section of the open record (0109): the one row of
 * it that references the record, in the child form's own forms, with no
 * grid -- the menu says it has at most one. Listed with the record as its
 * parent and a limit of one when the section mounts, then read and opened
 * as any child row is; with none, Add starts a new row preset with the
 * record, which the save creates. The section is mounted again for every
 * record, so what it holds is that record's.
 *
 * Its sessions are its own, keyed `<child form>~<field>`, as a child
 * section's are, and the guard counts their work. It offers no delete: the
 * child form's own page deletes a row (0053). Whether it is shown at all is
 * the workspace's, by the record as stored (`section.ts`).
 */
export function OneChild({
  client,
  form,
  index,
  parentNoun,
  parent,
  renderer,
  ownerBase = '',
  idBase = 'child',
}: {
  client: DataClient
  form: ChildForm
  index: number
  parentNoun: string
  parent: ParentOpen
  renderer: RendererChoice
  ownerBase?: string
  idBase?: string
}): ReactElement {
  const { child, menu, definition } = form
  const owner = `${ownerBase}${child.form}~${child.field}`
  const { ask } = useGuardContext()
  const after = useAfterRender()
  const addButton = useRef<HTMLButtonElement>(null)
  const detailHeading = useRef<HTMLHeadingElement>(null)
  const [held, setHeld] = useState<Held>(null)
  const [finding, setFinding] = useState<Finding>(parent.kind === 'record' ? { kind: 'asking' } : { kind: 'waiting' })
  const [line, setLine] = useState<Said>([])
  const heldRef = useRef<Held>(null)
  heldRef.current = held

  const title = menu.title
  const headingId = `${idBase}-${String(index)}-heading`
  const canCreate = menu.operations.includes('create') && definition.operations.includes('create')

  const sessions = useMemo(
    () =>
      (['react', 'angular'] as const).map((which) =>
        createSession({ client, formId: child.form, definition, renderer: which, namespace: owner, fixed: [child.field] }),
      ),
    [client, child.form, child.field, definition, owner],
  )
  const entries = useMemo<PaneEntry[]>(
    () =>
      sessions.map((session) =>
        paneEntry(owner, session, (): Said => {
          const now = heldRef.current
          return now?.kind === 'record' ? [`${title} `, { code: now.token }] : [`New ${title}`]
        }),
      ),
    [sessions, owner, title],
  )
  useRegistered(entries)
  const opening = useOpening({ client, formId: child.form, owner, sessions })

  // The record's row, if it has one: asked once, for this record, when the section mounts.
  const parentToken = parent.kind === 'record' ? parent.token : null
  useEffect(() => {
    if (parentToken === null) return undefined
    const controller = new AbortController()
    void client.list(child.form, { parent: { field: child.field, record: parentToken }, limit: 1 }, controller.signal).then(
      (page) => {
        if (controller.signal.aborted) return
        if (!page.ok) return setFinding({ kind: 'refused', message: page.message })
        const token = page.value.rows[0]?.record ?? null
        if (token === null) return setFinding({ kind: 'none' })
        opening.read({ kind: 'child-row', owner, record: token }, token, false, {
          opened: (now) => {
            setHeld({ kind: 'record', token: now.token })
            setFinding({ kind: 'found' })
          },
          refused: (message) => setFinding({ kind: 'refused', message }),
          back: () => setFinding({ kind: 'none' }),
        })
      },
      () => undefined,
    )
    return () => controller.abort()
    // The section is mounted again for every record; nothing else asks again.
  }, [client, child.form, child.field, parentToken])

  function startNew(): void {
    if (parentToken === null) return
    ask(
      { kind: 'child-new', owner, title },
      (discarded) => {
        opening.replaced()
        for (const session of sessions) session.open({ record: null, version: null, answers: { [child.field]: parentToken } })
        setHeld({ kind: 'new' })
        setLine([...(discarded ? ['Discarded the unsaved changes. '] : []), `A new ${title}, for ${parentNoun} `, { code: parentToken }, '.'])
        after(() => detailHeading.current?.focus())
      },
      () => addButton.current?.focus(),
    )
  }

  /** A row created here is the section's (opening.ts); a save of it says so in its own pane. */
  function answered(result: SaveResult, from: (typeof sessions)[number]): void {
    opening.answered(result, from, (now) => {
      setHeld({ kind: 'record', token: now.token })
      setFinding({ kind: 'found' })
      setLine(['Created ', { code: now.token }, '.'])
    })
  }

  const said: string =
    finding.kind === 'waiting'
      ? `${title} is added once this ${parentNoun} is saved.`
      : finding.kind === 'asking'
        ? `Loading ${title}.`
        : finding.kind === 'refused'
          ? finding.message
          : finding.kind === 'none' && held === null
            ? canCreate
              ? `This ${parentNoun} has no ${title} yet.`
              : `This ${parentNoun} has no ${title}.`
            : ''

  return (
    <section className="child one-child" aria-labelledby={headingId}>
      <div className="section-head">
        <h4 id={headingId} className="child-heading" tabIndex={-1}>
          {title}
        </h4>
        {canCreate && finding.kind === 'none' && held === null ? (
          <button type="button" className="button" ref={addButton} onClick={startNew}>
            Add {title}
          </button>
        ) : null}
      </div>
      {said === '' ? null : (
        <p role="status" className="status" data-kind={finding.kind === 'refused' ? 'refused' : finding.kind === 'asking' ? 'loading' : 'answer'}>
          {said}
        </p>
      )}
      {held === null ? null : (
        <div className="child-detail">
          <div className="title-row">
            <h5 id={`${headingId}-detail`} className="child-detail-heading" tabIndex={-1} ref={detailHeading}>
              <Words said={held.kind === 'record' ? [`${title} `, { code: held.token }] : [`New ${title}`]} />
            </h5>
          </div>
          <p role="status" className="status quiet-line">
            <Words said={line} />
          </p>
          <div className="panes" data-count={renderersOf(renderer).length}>
            {sessions
              .filter((session) => renderersOf(renderer).includes(session.renderer))
              .map((session) => (
                <Pane
                  key={session.renderer}
                  session={session}
                  title={held.kind === 'record' ? `${title} ${held.token}` : `New ${title}`}
                  level={6}
                  idBase={owner}
                  namedBy={`${headingId}-detail`}
                  onAnswer={(result) => answered(result, session)}
                />
              ))}
          </div>
        </div>
      )}
    </section>
  )
}
