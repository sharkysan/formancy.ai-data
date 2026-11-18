import type { FormSchema, Text } from '@formancy/spec'
import type { RuntimeRefusal } from '../runtime.js'
import type { ActionScope } from './types.js'

/*
 * The runtime plane's shapes for an action (0159), declared once so that
 * the server that sends them and the client that reads them
 * compile against the same shape, as `runtime.ts`'s are (0029): the data
 * server's `POST /v1/forms/:id/actions/:action/run` sends them and
 * data-client's `runAction` reads them (0161).
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
 * shown after it or `null` for "Done." -- what it runs over, the dialog it
 * asks first, or `null` for none, served as stored with its words applied,
 * and what to read again when it is done. A page draws an ask step from
 * `dialog` and a confirm step from `confirm`, then sends one run; the
 * server keeps no conversation between them. A `record` action runs over
 * the open record; a `selection` one over the records a person chose of
 * the page a list shows (0165).
 */
export interface FormAction {
  name: string
  label: Text
  scope: ActionScope
  confirm: Text | null
  done: Text | null
  dialog: FormSchema | null
  refresh: ActionRefresh[]
}

/**
 * The body of a run: the records it addresses, each by its token and the
 * version its person read -- exactly one for an action over the open
 * record, one to `LIST_PAGE_SIZE` for a selection (0165), each once -- and
 * the answers to its dialog by field key, `{}` for none.
 */
export interface ActionRunBody {
  records: Array<{ record: string; version: string }>
  answers: Record<string, unknown>
}

/** A run that committed: each record it addressed by its token, as the database holds its key, in the order they were sent. Never a version: the routine may have moved it after the run did. */
export interface ActionDone {
  records: string[]
}

/**
 * A run refused over some of the records it addressed (0165), nothing
 * done: `not-found` (404), `stale` and `version-ended` (409), and
 * `duplicate-record` (400), with the records it is about by the tokens
 * sent, so a page knows which of a selection to read again. Every record
 * the run addressed was rolled back with them.
 */
export interface ActionRecordsRefusal extends RuntimeRefusal {
  code: 'not-found' | 'stale' | 'version-ended' | 'duplicate-record'
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
