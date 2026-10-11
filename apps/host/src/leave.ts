import type { Renderer } from './session.js'

/*
 * One guard over every way of leaving a form in the workspace (0047): which
 * request discards which panes, what counts as work a pane would lose, and
 * what the notice says. Pure, so the table below is the whole decision and
 * the page only asks it.
 *
 * | Request                                                        | Discards                                 |
 * |----------------------------------------------------------------|------------------------------------------|
 * | another record row; New record; Load; another form; Back or    | the record's panes and every child's     |
 * | Forward; Sign out                                              |                                          |
 * | another child row; New <child>                                 | that child's panes                       |
 * | a record created in one of the record's panes                  | the record's other panes and every       |
 * |                                                                | child's                                  |
 * | a child row created in one of a child's panes                  | that child's other panes                 |
 * | a renderer hidden by the renderer switch                       | that renderer's panes, everywhere        |
 * | a layout or view change; paging; search; sort                  | nothing: every view stays mounted        |
 */

/** What a pane holds that a discard would lose: answers changed since it was opened or saved, a save out, or a save whose outcome is unknown (0031). */
export type Work = 'changed' | 'saving' | 'unknown'

/** Each kind of work, as the notice says it after a pane's name. */
export const WORK: Readonly<Record<Work, string>> = {
  changed: 'changes that are not saved.',
  saving: 'a save the server has not answered yet.',
  unknown: 'a save that may have been stored, not yet checked.',
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
  | { kind: 'form'; title: string }
  | { kind: 'history'; direction: 'back' | 'forward' }
  | { kind: 'sign-out' }
  | { kind: 'child-row'; owner: string; record: string }
  | { kind: 'child-new'; owner: string; title: string }
  /** The detail following a record one of its panes created: `owner`'s pane in `by` holds it already. */
  | { kind: 'created'; owner: string; record: string; by: Renderer }
  | { kind: 'renderer'; hides: readonly Renderer[]; shows: string }
  | { kind: 'layout' }
  | { kind: 'view' }
  | { kind: 'page' }
  | { kind: 'search' }
  | { kind: 'sort' }

/** Which panes a request drops: by owner -- `master` for the record's, or a child section's key -- and by renderer, but for the one it `keeps`. */
export interface Discarded {
  owners: 'all' | readonly string[]
  renderers: 'all' | readonly Renderer[]
  keeps?: { owner: string; renderer: Renderer }
}

/** One mounted pane, as the guard sees it: whose it is, which renderer, how it is named, and what it holds. */
export interface PaneWork {
  owner: string
  renderer: Renderer
  name: Said
  work: Work | null
}

/** What `request` would discard, or null when it discards nothing. */
export function discards(request: LeaveRequest): Discarded | null {
  switch (request.kind) {
    case 'row':
    case 'new':
    case 'load':
    case 'form':
    case 'history':
    case 'sign-out':
      return { owners: 'all', renderers: 'all' }
    case 'child-row':
    case 'child-new':
      return { owners: [request.owner], renderers: 'all' }
    case 'created':
      // The record's own: its children are the record's, and go with it.
      return { owners: request.owner === 'master' ? 'all' : [request.owner], renderers: 'all', keeps: { owner: request.owner, renderer: request.by } }
    case 'renderer':
      return { owners: 'all', renderers: request.hides }
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
  const { keeps } = dropped
  return panes.filter(
    (pane) =>
      pane.work !== null &&
      (dropped.owners === 'all' || dropped.owners.includes(pane.owner)) &&
      (dropped.renderers === 'all' || dropped.renderers.includes(pane.renderer)) &&
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
    case 'load':
      return ['Loading ', { code: request.record }, closes]
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
