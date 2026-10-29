import type { Renderer } from './session.js'

/*
 * One guard over every way of leaving a form in the workspace (0047): which
 * request discards which panes, what counts as work a pane would lose, and
 * what the notice says. Pure, so the table below is the whole decision and
 * the page only asks it.
 *
 * | Request                                                        | Discards                                 |
 * |----------------------------------------------------------------|------------------------------------------|
 * | another record row; New record; Load; Duplicate record         | the record's panes and every child's     |
 * | another form; Back or Forward; Sign out                        | those, and the records grid's deletion   |
 * | another child row; New <child>                                 | that child's panes                       |
 * | a record created in one of the record's panes                  | the record's other panes and every       |
 * |                                                                | child's                                  |
 * | a child row created in one of a child's panes                  | that child's other panes                 |
 * | a renderer hidden by the renderer switch                       | that renderer's panes, everywhere        |
 * | a layout or view change; paging; search; sort                  | nothing: every view stays mounted        |
 * | Drill down: going down from level n; a delete there            | every level below n (0090)               |
 * | Drill down: going up a level                                   | nothing: every level stays mounted       |
 *
 * A deletion out, or unknown (0053), is listed with its owner's panes and
 * goes where they go, but for a renderer hidden: it is drawn by none. One
 * asked from a grid's row that is not the record open in the detail is its
 * grid's (`gridOwner`): the records grid's goes only with the grid --
 * another form, Back or Forward, Sign out -- and a child grid's with its
 * section, as that child's panes do but for its own rows and its New.
 *
 * In Drill down (0090) a level's panes, its sections' and their grids'
 * deletions are owned under the level's number (`drillOwner`, `drillBase`),
 * which `levelOf` reads back; the record and its sections are level 1, the
 * records grid level 0. What drops the record drops every level under it.
 */

/**
 * What a pane holds that a discard would lose: answers changed since it was
 * opened or saved, a save out, or a save whose outcome is unknown (0031) --
 * and, of a record or a child row, a deletion out or one that may have been
 * done and is not checked (0053).
 */
export type Work = 'changed' | 'saving' | 'unknown' | 'deleting' | 'delete-unknown'

/** Each kind of work, as the notice says it after a pane's name. */
export const WORK: Readonly<Record<Work, string>> = {
  changed: 'changes that are not saved.',
  saving: 'a save the server has not answered yet.',
  unknown: 'a save that may have been stored, not yet checked.',
  deleting: 'a deletion the server has not answered yet.',
  'delete-unknown': 'a deletion that may have been done, not yet checked.',
}

/** How a renderer is written for a person. */
export const RENDERER_NAMES: Readonly<Record<Renderer, string>> = { react: 'React', angular: 'Angular' }

/** Text, and a token or id set as code. */
export type Said = ReadonlyArray<string | { code: string }>

/** Every way a person can ask the workspace to leave what it shows. `owner` names a child section. */
export type LeaveRequest =
  | { kind: 'row'; record: string }
  | { kind: 'new' }
  | { kind: 'load'; record: string }
  /** Duplicate record (0107): a new record copied from `record`, which replaces the detail's. */
  | { kind: 'duplicate'; record: string }
  | { kind: 'form'; title: string }
  | { kind: 'history'; direction: 'back' | 'forward' }
  | { kind: 'sign-out' }
  | { kind: 'child-row'; owner: string; record: string }
  | { kind: 'child-new'; owner: string; title: string }
  /** The detail following a record one of its panes created: `owner`'s pane in `by` holds it already. */
  | { kind: 'created'; owner: string; record: string; by: Renderer }
  | { kind: 'renderer'; hides: readonly Renderer[]; shows: string }
  /** Drill down: going down from level `below` into a row, or a new one when `record` is null, whose form is `title`. */
  | { kind: 'drill'; below: number; record: string | null; title: string }
  /** Drill down: deleting `record`, which drops the levels below `below`. */
  | { kind: 'drill-delete'; below: number; record: string }
  /** Drill down: going up to a level held above. */
  | { kind: 'level' }
  | { kind: 'layout' }
  | { kind: 'view' }
  | { kind: 'page' }
  | { kind: 'search' }
  | { kind: 'sort' }

/** Which panes a request drops: by owner -- `master` for the record's, or a child section's key -- and by renderer, but for the one it `keeps`. */
export interface Discarded {
  /** Every owner, the ones named, or in Drill down every level deeper than a number. */
  owners: 'all' | readonly string[] | { deeperThan: number }
  /** Owners `all` leaves out: the records grid's deletion, which a request that replaces only the record leaves where it is. */
  spares?: readonly string[]
  renderers: 'all' | readonly Renderer[]
  keeps?: { owner: string; renderer: Renderer }
}

/**
 * One mounted pane, as the guard sees it: whose it is, which renderer, how it
 * is named, and what it holds. A deletion is its owner's, the record's or a
 * child section's, and no renderer's (`null`): what drops its owner drops
 * it, and hiding a renderer does not.
 */
export interface PaneWork {
  owner: string
  renderer: Renderer | null
  name: Said
  work: Work | null
}

/**
 * The owner of a deletion asked from a row of `owner`'s grid that is not the
 * record open in its detail (0053): the grid's, not the detail's. A request
 * that replaces the record leaves the records grid where it is, and its
 * deletion with it; a child's grid is its section's, which goes with the
 * record.
 */
export function gridOwner(owner: string): string {
  return `${owner} grid`
}

/** What the record's requests leave: the records grid stays, and so does a deletion asked from one of its rows. */
const RECORDS_GRID: readonly string[] = [gridOwner('master')]

/** The owner of a Drill down level's own panes and of its deletion: the level, then the child form and its field. */
export function drillOwner(level: number, form: string, field: string): string {
  return `drill-${String(level)}~${form}~${field}`
}

/** What the owners of a Drill down level's child sections start with. */
export function drillBase(level: number): string {
  return `drill-${String(level)}/`
}

/**
 * The level `owner` is drawn at: a Drill down level's number, 0 for the
 * records grid, and 1 for the record and its sections. Read from the
 * owner's shape, not its start: a form may be called `drill-3`, so the
 * record's section of it is `drill-3~<field>`, while a level's own owner
 * holds a second `~` and its sections' a `/`, which no form id or field
 * key holds.
 */
export function levelOf(owner: string): number {
  const level = /^drill-([1-9]\d*)(?:\/|~[^~/]+~)/.exec(owner)
  if (level !== null) return Number(level[1])
  return owner === gridOwner('master') ? 0 : 1
}

/** What `request` would discard, or null when it discards nothing. */
export function discards(request: LeaveRequest): Discarded | null {
  switch (request.kind) {
    case 'row':
    case 'new':
    case 'load':
    case 'duplicate':
      return { owners: 'all', spares: RECORDS_GRID, renderers: 'all' }
    case 'form':
    case 'history':
    case 'sign-out':
      return { owners: 'all', renderers: 'all' }
    case 'child-row':
    case 'child-new':
      return { owners: [request.owner], renderers: 'all' }
    case 'created': {
      // The record's own: its children are the record's, and go with it.
      const keeps = { owner: request.owner, renderer: request.by }
      return request.owner === 'master' ? { owners: 'all', spares: RECORDS_GRID, renderers: 'all', keeps } : { owners: [request.owner], renderers: 'all', keeps }
    }
    case 'renderer':
      return { owners: 'all', renderers: request.hides }
    case 'drill':
    case 'drill-delete':
      return { owners: { deeperThan: request.below }, renderers: 'all' }
    case 'level':
    case 'layout':
    case 'view':
    case 'page':
    case 'search':
    case 'sort':
      return null
  }
}

/** The panes `request` would discard that hold work, in the order given. */
export function atRisk(request: LeaveRequest, panes: readonly PaneWork[]): PaneWork[] {
  const dropped = discards(request)
  if (dropped === null) return []
  const { keeps, owners } = dropped
  const dropsOwner = (owner: string): boolean =>
    owners === 'all' ? !(dropped.spares?.includes(owner) ?? false) : 'deeperThan' in owners ? levelOf(owner) > owners.deeperThan : owners.includes(owner)
  return panes.filter(
    (pane) =>
      pane.work !== null &&
      dropsOwner(pane.owner) &&
      (dropped.renderers === 'all' || (pane.renderer !== null && dropped.renderers.includes(pane.renderer))) &&
      !(keeps !== undefined && keeps.owner === pane.owner && keeps.renderer === pane.renderer),
  )
}

/** The notice's lead: what was asked for, named, and that it closes the forms listed under it. */
export function lead(request: LeaveRequest): Said {
  const closes = ' closes these forms:'
  switch (request.kind) {
    case 'row':
    case 'child-row':
      return ['Opening ', { code: request.record }, closes]
    case 'drill':
      return request.record === null ? [`Starting a new ${request.title}${closes}`] : ['Opening ', { code: request.record }, closes]
    case 'drill-delete':
      return ['Deleting ', { code: request.record }, closes]
    case 'load':
      return ['Loading ', { code: request.record }, closes]
    case 'duplicate':
      return ['Copying ', { code: request.record }, ` into a new record${closes}`]
    case 'created':
      return ['Opening ', { code: request.record }, `, just created in ${RENDERER_NAMES[request.by]},${closes}`]
    case 'new':
      return [`Starting a new record${closes}`]
    case 'child-new':
      return [`Starting a new ${request.title}${closes}`]
    case 'form':
      return [`Opening ${request.title}${closes}`]
    case 'history':
      return [`Going ${request.direction}${closes}`]
    case 'sign-out':
      return [`Signing out${closes}`]
    case 'renderer':
      return [`Showing ${request.shows}${closes}`]
    default:
      return [`This${closes}`]
  }
}
