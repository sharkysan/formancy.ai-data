import type { ReactElement, ReactNode } from 'react'
import type { DataClient } from '@formancy/data-client'
import { ChildSection } from './children.js'
import type { ChildForm, ParentOpen } from './children.js'
import type { Said } from './leave.js'
import { OneChild } from './one-child.js'
import type { RendererChoice } from './prefs.js'
import { sectionShown } from './section.js'
import { TabList } from './tab-list.js'
import type { TabEntry } from './tab-list.js'
import { childTabs, RECORD_TAB } from './tabs.js'
import type { Drill } from './use-drill.js'
import { Words } from './words.js'

/**
 * A record and its child forms, in tabs beside it (0142): the record's own
 * tab, named as its heading names it, holds its panes and the sections of
 * it (0109), each shown while the record as stored holds its condition's
 * answer; then one tab per other child the menu names, in the menu's
 * order, holding that child's section and grid (0047). A record with no
 * such child draws no tabs, and no record -- `parent` null -- none either.
 *
 * Drawn for the open record and for every Drill down level below it (0090),
 * whose sections are owned under the level (`ownerBase`, `childIdBase`).
 * Where `drilling`, a section's row goes a level down from `level`. A
 * section's deletion asking something while its tab or its view is hidden
 * shows both before it takes the keyboard; a refused save's notice in a pane
 * of a hidden tab, and a row opened by Enter whose read lands there, show
 * that tab. Another `record`, by identity,
 * starts again on the record's tab (`TabList`'s `start`).
 */
export function RecordTabs({
  client,
  childForms,
  record,
  heading,
  headingId,
  idBase,
  childIdBase = 'child',
  ownerBase = '',
  parentNoun,
  parent,
  stored,
  renderer,
  refit,
  onShow,
  drill,
  level,
  drilling,
  children,
}: {
  client: DataClient
  childForms: readonly ChildForm[]
  /** What the tabs are for: the record the detail or the level holds now. */
  record: unknown
  /** The record's heading, which its tab says, and the heading's id, which names the row. */
  heading: Said
  headingId: string
  /** What the tabs' and panels' ids start with. */
  idBase: string
  /** What the sections' element ids start with: `child` at level 1. */
  childIdBase?: string
  /** What the sections' owners start with: a Drill down level's (`drillBase`), or nothing at level 1. */
  ownerBase?: string
  parentNoun: string
  parent: ParentOpen | null
  /** The record as stored, which a section's condition is read from (0109); null for a new one. */
  stored: Readonly<Record<string, unknown>> | null
  renderer: RendererChoice
  refit: number
  /** The record's view or level shown, where the layout hides it: true when it was hidden. */
  onShow: () => boolean
  drill: Drill
  /** The level the record is at: 1 for the open record. */
  level: number
  drilling: boolean
  /** The record's own panes, given how to show the record's tab, which a pane's refused save shows first. */
  children: (show: () => boolean) => ReactNode
}): ReactElement {
  const below = parent?.kind === 'record' ? parent.token : 'new'
  const sections = (show: () => boolean): ReactNode =>
    parent === null
      ? null
      : childForms.map((form, index) =>
          form.child.one && sectionShown(form.child, stored) ? (
            <OneChild
              key={`${form.child.form}~${form.child.field} ${below}`}
              client={client}
              form={form}
              index={index}
              parentNoun={parentNoun}
              parent={parent}
              renderer={renderer}
              ownerBase={ownerBase}
              idBase={childIdBase}
              onTab={show}
            />
          ) : null,
        )
  const tabs: TabEntry[] = [
    {
      key: RECORD_TAB,
      name: <Words said={heading} />,
      panel: (show) => (
        <>
          {children(show)}
          {sections(show)}
        </>
      ),
    },
    ...(parent === null
      ? []
      : childTabs(childForms).map(({ key, form, index, twice, name }): TabEntry => ({
          key,
          name,
          panel: (show) => (
            <ChildSection
              key={`${key} ${below}`}
              client={client}
              form={form}
              index={index}
              twice={twice}
              parentNoun={parentNoun}
              parent={parent}
              renderer={renderer}
              refit={refit}
              ownerBase={ownerBase}
              idBase={childIdBase}
              onShow={() => {
                const tabHidden = show()
                const viewHidden = onShow()
                return tabHidden || viewHidden
              }}
              onTab={show}
              levels={drill.levels}
              drill={
                drilling && parent.kind === 'record' ? drill.section({ level, owner: `${ownerBase}${key}`, form, parentNoun, parent: parent.token }) : undefined
              }
            />
          ),
        }))),
  ]
  return <TabList idBase={idBase} labelledBy={headingId} start={record} tabs={tabs} />
}
