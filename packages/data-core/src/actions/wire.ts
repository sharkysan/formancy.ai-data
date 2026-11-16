import type { FormSchema, Text } from '@formancy/spec'
import type { RuntimeRefusal } from '../runtime.js'

/*
 * The runtime plane's shapes for an action (0159), declared once so that
 * the server that will send them and the client that will read them
 * compile against the same shape, as `runtime.ts`'s are (0029). Nothing
 * serves or sends one yet: the route is a later record's.
 */

/**
 * A view on a person's screen a run reads again, beyond the records it
 * addressed, which are always read again: `list`, this form's grid, and
 * `children`, its child grids, as the menu derives them (0045). It names no
 * other form, so it discloses nothing about a form the person may not read.
 */
export type ActionRefresh = 'list' | 'children'

/** Every refresh, in the one order a presentation spells them. */
export const ACTION_REFRESH: readonly ActionRefresh[] = ['list', 'children']

/**
 * An action as a page is offered it: its name, the words a person reads --
 * a label, the sentence asked before a run or `null` for none, and the one
 * shown after it or `null` for "Done." -- the dialog it asks first, or
 * `null` for none, served as stored with its words applied, and what to
 * read again when it is done. A page draws an ask step from `dialog` and a
 * confirm step from `confirm`, then sends one run; the server keeps no
 * conversation between them.
 */
export interface FormAction {
  name: string
  label: Text
  scope: 'record'
  confirm: Text | null
  done: Text | null
  dialog: FormSchema | null
  refresh: ActionRefresh[]
}

/**
 * The body of a run: the records it addresses, each by its token and the
 * version its person read -- exactly one for an action over the open
 * record -- and the answers to its dialog by field key, `{}` for none.
 */
export interface ActionRunBody {
  records: Array<{ record: string; version: string }>
  answers: Record<string, unknown>
}

/** A run that committed: each record it addressed by its token, as the database holds its key. Never a version: the routine may have moved it after the run did. */
export interface ActionDone {
  records: string[]
}

/**
 * A run whose answer was lost (0031): it may have committed. Nothing here
 * runs it again. What was addressed travels in `records`, with the versions
 * sent, which a host reconciles with: run again from them, it is refused
 * as changed if the first committed.
 */
export interface ActionUnknownOutcome extends RuntimeRefusal {
  code: 'unknown-outcome'
  operation: 'action'
  action: string
  records: Array<{ record: string; version: string }>
}
