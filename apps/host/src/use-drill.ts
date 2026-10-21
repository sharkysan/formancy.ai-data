import { useCallback, useEffect, useRef, useState } from 'react'
import type { DataClient, FormRecord } from '@formancy/data-client'
import { useAfterRender } from './after-render.js'
import type { ChildForm } from './children.js'
import { recordName } from './crumbs.js'
import { gone as goneLine } from './deletion.js'
import type { DeleteTarget } from './deletion.js'
import { useGuardContext } from './guard.js'
import { levelShown } from './layout.js'
import type { Layout, View } from './layout.js'
import type { LeaveRequest, Said } from './leave.js'

/*
 * Drill down's levels (0090), as one open form holds them: level 0 is its
 * records, level 1 the record, and each level below a child row of the
 * level above, opened from one of that level's child sections. The levels
 * from 2 down are a path in memory -- never in the address, the history
 * state or storage (0047) -- and every one of them stays mounted, shown or
 * not, as every lane does: going up only changes which level is shown.
 *
 * - **Down.** Opening a row of a section, or its New, goes down a level.
 *   Into the row the level below already holds, it is shown again as it
 *   was; into any other, the levels below are replaced, through the guard,
 *   which asks when one of them holds work. A row is read first and shown
 *   once the server answers; an answer for a request the person has since
 *   replaced, or one that arrives while the page waits for them, is
 *   dropped, as `opening.ts` drops one.
 * - **Up.** A crumb, or Back, shows a level above; it drops nothing.
 * - **Where.** The level shown is the workspace's place, `view` and
 *   `level`, so Back and Forward move between levels as they move between
 *   Separate views' views. An entry asking for a level no longer held
 *   shows the deepest one above it, written over that entry.
 * - **Gone.** A record deleted at a level takes the levels below it with
 *   it, and the level above is shown, its section saying the row is gone.
 */

/** What a section asks to go down into: a row by its token, or a new one. */
export type DrillWant = { kind: 'record'; token: string } | { kind: 'new' }

/** One level from 2 down: the child row it shows, opened from the level above. */
export interface DrillStep {
  /** New for each step placed: a level replaced is mounted again. */
  key: number
  level: number
  /** The owner of the section it was opened from, one level up. */
  from: string
  form: ChildForm
  /** The record of the level above, which this row's parent field names. */
  parent: string
  /** The form of the level above, as its sections name it: "For Order k1:4711". */
  parentNoun: string
  /** As it was read, or null for a new row. */
  record: FormRecord | null
  /** Its token once it has one: a new row has none until a save creates it. */
  token: string | null
  /** What its crumb calls it, from what is stored (crumbs.ts). */
  name: string | null
  /** What its line says when it is first shown. */
  said: Said
}

/** What a section does when its level is told something by the levels below. */
export interface SectionHandle {
  /** The row the level below held is gone: said on the grid, which asks for its page again. */
  removed(line: Said): void
  /** The keyboard on the section's heading. */
  focusHeading(): void
  /** The grid asks for its page again: a row was saved one level down. */
  reload(): void
}

/** How a child section goes down, in Drill down: what one level asks of the levels below it. */
export interface SectionDrill {
  /** The row the level below holds when it was opened from this section: the grid marks it open. */
  held: string | null
  /** Go down into `want`; `toRow` gives the keyboard back on Keep editing, `refused` says a read the server refused. */
  descend(want: DrillWant, toRow: () => void, refused: (message: string) => void): void
  /** Before a row's Delete: the held row's asks about the levels below first, then `go`; `back` on Keep editing. */
  beforeDelete(token: string, go: () => void, back: () => void): void
  /** A row of this section's grid is gone: the level below goes with it when it held that row. */
  rowGone(token: string): void
  /** The section's handle, by its owner, while it is mounted. */
  register(owner: string, handle: SectionHandle | null): void
}

export interface Drill {
  path: readonly DrillStep[]
  /** The level shown in Drill down: 0, 1, or a held level from 2 down. */
  shown: number
  /** Where entering Drill down goes: the level last shown there while it is held, else the record when one is open, else the records. */
  enter(open: boolean): { view: View; level?: number }
  /** A section of `from.level` goes down. */
  descend(from: SectionAt, want: DrillWant, back: { toRow(): void; refused(message: string): void }): void
  /** A crumb: the level shown is `level`, an entry pushed; `back` on Keep editing. */
  up(level: number, back: () => void): void
  /** What a section at `level` is given. */
  section(at: SectionAt): SectionDrill
  /** A level's record saved: its token, and what its crumb calls it now. */
  saved(level: number, token: string, name: string | null): void
  /** The record at `level` deleted, or not found and closed. */
  gone(level: number, target: DeleteTarget, word: 'Deleted' | 'Closed', quiet: boolean): void
  /** Shown, when Drill down draws it and it is held: a deletion's region at that level must be on screen. True when it was hidden. */
  reveal(level: number): boolean
  /** The record at level 1 replaced: every level below goes. */
  dropAll(): void
  /** The keyboard on `level`'s heading, once it is drawn. */
  focusLevel(level: number): void
  /** Where a level's heading registers itself. */
  headingRef(level: number): (heading: HTMLHeadingElement | null) => void
  /** The children of `formId` as the menu names them, once asked; null until they answer. */
  childrenOf(formId: string): readonly ChildForm[] | null
}

/** A section as a level holds it: the level, its owner, its child form, and the record above it. */
export interface SectionAt {
  level: number
  owner: string
  form: ChildForm
  parentNoun: string
  parent: string
}

const DISCARDED: Said = ['Discarded the unsaved changes. ']

export function useDrill({
  client,
  layout,
  view,
  level,
  historyView,
  open,
  onView,
  headingOf,
  childFormsOf,
}: {
  client: DataClient
  layout: Layout
  view: View
  level: number | undefined
  /** How many times Back or Forward has changed the view. */
  historyView: number
  /** A record, or a new one, is open at level 1. */
  open: boolean
  onView: (view: View, replace?: boolean, level?: number) => void
  /** The heading of level 0 or 1, which the form holds. */
  headingOf: (level: 0 | 1) => HTMLElement | null
  childFormsOf: (formId: string) => Promise<ChildForm[]>
}): Drill {
  const guard = useGuardContext()
  const after = useAfterRender()
  const [path, setPathState] = useState<readonly DrillStep[]>([])
  const pathRef = useRef(path)
  const keys = useRef(0)
  // How many times the levels have been asked to show something else: a
  // read for an earlier request is not the person's latest.
  const asked = useRef(0)
  const sections = useRef(new Map<string, SectionHandle>())
  const headings = useRef(new Map<number, HTMLHeadingElement>())
  const [children, setChildren] = useState<Readonly<Record<string, readonly ChildForm[]>>>({})
  const askedChildren = useRef(new Set<string>())

  const setPath = useCallback((next: readonly DrillStep[]) => {
    pathRef.current = next
    setPathState(next)
  }, [])

  const deepest = 1 + path.length
  const held = (at: number): boolean => at === 0 || (at === 1 && open) || (at >= 2 && at <= 1 + pathRef.current.length)
  const asking = levelShown({ view, level })
  const shown = layout === 'drill' ? Math.min(asking, open ? deepest : 0) : asking === 0 ? 0 : 1
  // The level Drill down last showed, for entering it again.
  const last = useRef<number | null>(null)
  if (layout === 'drill') last.current = shown

  function focusLevel(at: number): void {
    after(() => (at < 2 ? headingOf(at as 0 | 1) : (headings.current.get(at) ?? null))?.focus())
  }

  /** `at` shown: an entry pushed, or written over the one the browser is on. */
  function show(at: number, replace: boolean, focus = true): void {
    onView(at === 0 ? 'records' : 'record', replace, at === 0 ? undefined : at)
    if (focus) focusLevel(at)
  }

  function want(formId: string): void {
    if (askedChildren.current.has(formId)) return
    askedChildren.current.add(formId)
    void childFormsOf(formId).then((found) => setChildren((now) => ({ ...now, [formId]: found })))
  }

  /** The levels down to `from.level`, and `step` below them. */
  function place(from: SectionAt, record: FormRecord | null, said: Said): void {
    keys.current += 1
    const { form } = from
    const step: DrillStep = {
      key: keys.current,
      level: from.level + 1,
      from: from.owner,
      form,
      parent: from.parent,
      parentNoun: from.parentNoun,
      record,
      token: record?.record ?? null,
      name: record === null ? null : recordName(form.definition.form.model.fields, record.answers, form.child.field),
      said,
    }
    want(form.child.form)
    setPath([...pathRef.current.slice(0, from.level - 1), step])
  }

  function descend(from: SectionAt, wanted: DrillWant, back: { toRow(): void; refused(message: string): void }): void {
    const below = pathRef.current[from.level - 1]
    if (wanted.kind === 'record' && below !== undefined && below.from === from.owner && below.token === wanted.token) {
      show(from.level + 1, false)
      return
    }
    const title = from.form.menu.title
    const request: LeaveRequest = { kind: 'drill', below: from.level, record: wanted.kind === 'record' ? wanted.token : null, title }
    guard.ask(
      request,
      (discarded) => {
        asked.current += 1
        const mine = asked.current
        if (wanted.kind === 'new') {
          place(from, null, [...(discarded ? DISCARDED : []), `A new ${title}, for ${from.parentNoun} `, { code: from.parent }, '.'])
          show(from.level + 1, false)
          return
        }
        void client.read(from.form.child.form, wanted.token).then((answer) => {
          if (asked.current !== mine || guard.waiting()) return
          if (!answer.ok) {
            back.refused(answer.message)
            return
          }
          const record = answer.value
          // Asked again: the person may have typed one level down while the
          // read was out. An answer's question closes nothing they may be
          // answering meanwhile -- a delete's confirmation (0053).
          guard.askOnAnswer(
            request,
            (again) => {
              place(from, record, [...(discarded || again ? DISCARDED : []), 'Opened ', { code: record.record ?? wanted.token }, '.'])
              show(from.level + 1, false)
            },
            back.toRow,
          )
        })
      },
      back.toRow,
    )
  }

  function up(at: number, back: () => void): void {
    guard.ask(
      { kind: 'level' },
      () => {
        asked.current += 1
        show(at, false)
      },
      back,
    )
  }

  const register = useCallback((owner: string, handle: SectionHandle | null) => {
    if (handle === null) sections.current.delete(owner)
    else sections.current.set(owner, handle)
  }, [])

  function section(at: SectionAt): SectionDrill {
    const below = path[at.level - 1]
    const mine = below !== undefined && below.from === at.owner ? below : undefined
    return {
      held: mine?.token ?? null,
      descend: (wanted, toRow, refused) => descend(at, wanted, { toRow, refused }),
      beforeDelete: (token, go, back) => {
        const now = pathRef.current[at.level - 1]
        if (now === undefined || now.from !== at.owner || now.token !== token) {
          go()
          return
        }
        guard.ask({ kind: 'drill-delete', below: at.level, record: token }, go, back)
      },
      rowGone: (token) => {
        const now = pathRef.current[at.level - 1]
        if (now !== undefined && now.from === at.owner && now.token === token) setPath(pathRef.current.slice(0, at.level - 1))
      },
      register,
    }
  }

  function saved(at: number, token: string, name: string | null): void {
    const step = pathRef.current[at - 2]
    if (step === undefined) return
    setPath(pathRef.current.map((each) => (each === step ? { ...each, token, name } : each)))
    sections.current.get(step.from)?.reload()
  }

  function gone(at: number, target: DeleteTarget, word: 'Deleted' | 'Closed', quiet: boolean): void {
    const step = pathRef.current[at - 2]
    if (step === undefined) return
    setPath(pathRef.current.slice(0, at - 2))
    const above = sections.current.get(step.from)
    above?.removed(goneLine(target, word))
    // Shown at or below the level gone, the level above is shown in its place, with no step of its own in the history.
    if (layout === 'drill' && shown >= at) show(at - 1, true, false)
    if (!quiet) after(() => above?.focusHeading())
  }

  function reveal(at: number): boolean {
    if (layout !== 'drill' || shown === at || !held(at)) return false
    show(at, true, false)
    return true
  }

  function dropAll(): void {
    asked.current += 1
    if (pathRef.current.length > 0) setPath([])
  }

  function enter(isOpen: boolean): { view: View; level?: number } {
    const was = last.current
    const at = was !== null && (was === 0 || (was === 1 && isOpen) || (was >= 2 && was <= 1 + pathRef.current.length)) ? was : isOpen ? 1 : 0
    return at === 0 ? { view: 'records' } : { view: 'record', level: at }
  }

  const headingRef = useCallback(
    (at: number) => (heading: HTMLHeadingElement | null) => {
      if (heading === null) headings.current.delete(at)
      else headings.current.set(at, heading)
    },
    [],
  )

  // Back or Forward onto a level of Drill down: the level asked for is shown,
  // or the deepest one above it while it is no longer held -- written over
  // the entry, which says so from then on -- and the keyboard on its heading.
  // Levels 0 and 1 are the form's, which move the keyboard as Separate views'
  // views do.
  useEffect(() => {
    if (historyView === 0 || layout !== 'drill') return
    if (shown !== asking) show(shown, true, false)
    if (shown >= 2) focusLevel(shown)
    // On each change made by history, and only then.
  }, [historyView])

  return {
    path,
    shown,
    enter,
    descend,
    up,
    section,
    saved,
    gone,
    reveal,
    dropAll,
    focusLevel,
    headingRef,
    childrenOf: (formId) => children[formId] ?? null,
  }
}
