import { useMemo } from 'react'
import type { RefObject } from 'react'
import type { DataClient, PublishedForm } from '@formancy/data-client'
import type { ChildForm } from './children.js'
import type { MasterOpen } from './detail.js'
import { paneEntry, useRegistered } from './guard.js'
import type { PaneEntry } from './guard.js'
import type { Said } from './leave.js'
import { useOpening } from './opening.js'
import type { Opening } from './opening.js'
import type { SaveSet } from './save-set.js'
import { createSession } from './session.js'
import type { Session } from './session.js'
import { useSaveSet } from './together.js'

/**
 * The record's own forms on the page (0029, 0047): one session for each
 * renderer, made once for the form and its definition; each known to the
 * guard by what the detail holds -- the record by its token, the next
 * version of one (0115), or a new record -- through `open`, read as the
 * guard asks; the rows of the record's together children, held for its
 * Save, which every pane's save carries (0155); and how a record opens in
 * them (opening.ts). Kept out of form-view.tsx, which draws the form, as
 * what changes when the forms do.
 */
export function useMasterPanes({
  client,
  formId,
  definition,
  title,
  childForms,
  open,
}: {
  client: DataClient
  formId: string
  definition: PublishedForm
  /** The form's title, which names the record. */
  title: string
  childForms: readonly ChildForm[]
  /** What the detail holds now. */
  open: RefObject<MasterOpen>
}): { saveSet: SaveSet; sessions: Session[]; opening: Opening } {
  const saveSet = useSaveSet(client, formId, title, childForms)
  const sessions = useMemo(
    () => (['react', 'angular'] as const).map((which) => createSession({ client, formId, definition, renderer: which, rows: saveSet.rows })),
    [client, formId, definition, saveSet],
  )
  const entries = useMemo<PaneEntry[]>(
    () =>
      sessions.map((session) =>
        paneEntry('master', session, (): Said => {
          const now = open.current
          return now?.kind === 'record' ? [`${title} `, { code: now.token }] : now?.kind === 'next' ? ['Next version of ', { code: now.of }] : ['New record']
        }),
      ),
    [sessions, title, open],
  )
  useRegistered(entries)
  const opening = useOpening({ client, formId, owner: 'master', sessions })
  return { saveSet, sessions, opening }
}
