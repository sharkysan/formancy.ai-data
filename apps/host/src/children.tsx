import { useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { DataClient, FormMenuChild, FormMenuEntry, PublishedForm } from '@formancy/data-client'
import { columnsOf } from './grid-datasource.js'
import { useGuardContext, useRegistered } from './guard.js'
import type { PaneEntry } from './guard.js'
import type { Said } from './leave.js'
import { useOpening } from './opening.js'
import { Pane } from './pane.js'
import { renderersOf } from './panes.js'
import type { RendererChoice } from './prefs.js'
import { RecordGrid } from './record-grid.js'
import type { OpenHow, RecordGridHandle, RowAt } from './record-grid.js'
import { createSession } from './session.js'
import type { SaveResult } from './session.js'
import { useAfterRender } from './after-render.js'
import { Words } from './words.js'

/** What the record above a child section is: a saved record, or a new one not saved yet. */
export type ParentOpen = { kind: 'new' } | { kind: 'record'; token: string }

/** A child form under the open record: the menu's entry, the child form's own, and its definition. */
export interface ChildForm {
  child: FormMenuChild
  menu: FormMenuEntry
  definition: PublishedForm
}

type ChildOpen = null | { kind: 'new' } | { kind: 'record'; token: string }

/**
 * One child form's rows under the open record (0045, 0047): its grid, listed
 * with `parent: { field, record }` and the parent's column left out, and,
 * once a row is opened or New is pressed, the child row's own forms on a
 * rail below it.
 *
 * Its sessions are its own, keyed `<child form>~<field>`, so a form that is
 * its own child -- an employee's manager -- or two sections of one form --
 * an order under its creator and its approver -- never mint one element id
 * twice. A new child row is preset with the parent, whose field is drawn
 * disabled on the page's copy: presentation only; the server checks only
 * that the parent is one this person may reference (0043).
 *
 * The section is mounted again for every parent, so its rows, its open row
 * and its forms are that parent's; the workspace asks before a request drops
 * a child row's work.
 */
export function ChildSection({
  client,
  form,
  index,
  twice,
  parentNoun,
  parent,
  renderer,
  refit,
}: {
  client: DataClient
  form: ChildForm
  index: number
  /** The same child form under this parent through another field too: the heading names the field. */
  twice: boolean
  parentNoun: string
  parent: ParentOpen
  renderer: RendererChoice
  /** How many times the separator has been let go: the grid's columns fit again each time. */
  refit: number
}): ReactElement {
  const { child, menu, definition } = form
  const owner = `${child.form}~${child.field}`
  const { ask } = useGuardContext()
  const after = useAfterRender()
  const grid = useRef<RecordGridHandle>(null)
  const newButton = useRef<HTMLButtonElement>(null)
  const detailHeading = useRef<HTMLHeadingElement>(null)
  const [open, setOpen] = useState<ChildOpen>(null)
  const [line, setLine] = useState<Said>([])
  const [waitingShown, setWaitingShown] = useState(true)
  const openRef = useRef<ChildOpen>(null)
  openRef.current = open

  const title = menu.title
  const fieldLabel = String(definition.form.model.fields.find((field) => field.key === child.field)?.label ?? child.field)
  const headingId = `child-${String(index)}-heading`
  const canCreate = menu.operations.includes('create') && definition.operations.includes('create')
  const waiting = parent.kind === 'new'
  const waitingText = `${title} rows are listed once this ${parentNoun} is saved.`

  const sessions = useMemo(
    () => (['react', 'angular'] as const).map((which) => createSession({ client, formId: child.form, definition, renderer: which, namespace: owner, fixed: [child.field] })),
    [client, child.form, child.field, definition, owner],
  )
  const entries = useMemo<PaneEntry[]>(
    () =>
      sessions.map((session) => ({
        owner,
        renderer: session.renderer,
        session,
        name: (): Said => {
          const now = openRef.current
          return now?.kind === 'record' ? [`${title} `, { code: now.token }] : [`New ${title}`]
        },
      })),
    [sessions, owner, title],
  )
  useRegistered(entries)
  const opening = useOpening({ client, formId: child.form, owner, sessions })
  const columns = useMemo(() => columnsOf(definition, child.field), [definition, child.field])

  const prefix = (discarded: boolean): Said => (discarded ? ['Discarded the unsaved changes. '] : [])

  function askRow(token: string, how: OpenHow, at: RowAt): void {
    if (open?.kind === 'record' && open.token === token) {
      if (how === 'enter') detailHeading.current?.focus()
      return
    }
    const request = { kind: 'child-row', owner, record: token } as const
    const toRow = (): void => grid.current?.focusAt(at)
    ask(
      request,
      (discarded) =>
        opening.read(request, token, discarded, {
          opened: (now) => {
            setOpen({ kind: 'record', token })
            setLine([...prefix(now.discarded), 'Opened ', { code: token }, '.'])
            after(() => {
              if (how === 'enter') detailHeading.current?.focus()
              else if (now.discarded) toRow()
            })
          },
          refused: (message) => setLine([message]),
          back: toRow,
        }),
      toRow,
    )
  }

  function startNew(): void {
    if (parent.kind !== 'record') {
      // Said again, on the line that already says it: emptied, then filled,
      // which a live region hears as a change.
      setWaitingShown(false)
      after(() => setWaitingShown(true))
      return
    }
    const parentToken = parent.token
    ask(
      { kind: 'child-new', owner, title },
      (discarded) => {
        opening.replaced()
        for (const session of sessions) session.open({ record: null, version: null, answers: { [child.field]: parentToken } })
        setOpen({ kind: 'new' })
        setLine([...prefix(discarded), `A new ${title}, for ${parentNoun} `, { code: parentToken }, '.'])
        after(() => detailHeading.current?.focus())
      },
      () => newButton.current?.focus(),
    )
  }

  /** A child row saved or created here: the grid shows what is stored, and a created row is the section's (opening.ts). */
  function answered(result: SaveResult, from: (typeof sessions)[number]): void {
    grid.current?.reload()
    opening.answered(result, from, (now) => {
      setOpen({ kind: 'record', token: now.token })
      if (now.discarded) setLine([...prefix(true), 'Opened ', { code: now.token }, '.'])
    })
  }

  return (
    <section className="child" aria-labelledby={headingId}>
      <div className="section-head">
        <h4 id={headingId} className="child-heading">
          {twice ? `${title}, ${fieldLabel}` : title}
        </h4>
        {canCreate ? (
          <button
            type="button"
            className="button"
            ref={newButton}
            aria-disabled={waiting ? 'true' : undefined}
            aria-describedby={waiting ? `${headingId}-waiting` : undefined}
            onClick={startNew}
          >
            New {title}
          </button>
        ) : null}
      </div>
      {waiting ? (
        <p role="status" id={`${headingId}-waiting`} className="status" data-kind="loading">
          {waitingShown ? waitingText : ''}
        </p>
      ) : (
        <>
          <p className="child-sub">
            <Words said={[`For ${parentNoun} `, { code: parent.token }]} />
          </p>
          <RecordGrid
            ref={grid}
            client={client}
            formId={child.form}
            definition={definition}
            columns={columns}
            labelledBy={headingId}
            noun={title}
            parent={{ field: child.field, record: parent.token }}
            search=""
            openToken={open?.kind === 'record' ? open.token : null}
            canCreate={canCreate}
            quiet
            refit={refit}
            bench="child-bench"
            onOpen={askRow}
          />
        </>
      )}
      {open === null ? null : (
        <div className="child-detail">
          <h5 id={`${headingId}-detail`} className="child-detail-heading" tabIndex={-1} ref={detailHeading}>
            <Words said={open.kind === 'record' ? [`${title} `, { code: open.token }] : [`New ${title}`]} />
          </h5>
          <p role="status" className="status quiet-line">
            <Words said={line} />
          </p>
          <div className="panes" data-count={renderersOf(renderer).length}>
            {sessions
              .filter((session) => renderersOf(renderer).includes(session.renderer))
              .map((session) => (
                // The paper is named for the child row, so it differs from the record's own form of the same title.
                <Pane key={session.renderer} session={session} title={open.kind === 'record' ? `${title} ${open.token}` : `New ${title}`} level={6} idBase={owner} namedBy={`${headingId}-detail`} onAnswer={(result) => answered(result, session)} />
              ))}
          </div>
        </div>
      )}
    </section>
  )
}
