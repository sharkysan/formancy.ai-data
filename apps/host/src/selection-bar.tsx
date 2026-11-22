import { useEffect } from 'react'
import type { ReactElement } from 'react'
import { useActionFlow } from './action-flow.js'
import type { ActionFlow, ActionFlowOptions } from './action-flow.js'
import { ActionRegion } from './action-region.js'
import { CHANGE_CHOSEN } from './chosen-change.js'
import { DELETE_CHOSEN } from './chosen-deletion.js'
import { useChosen } from './chosen-flow.js'
import type { ChosenFlow } from './chosen-flow.js'
import type { ChosenOptions } from './chosen-flow-state.js'
import { ChosenRegion } from './chosen-region.js'
import { hearForms, NONE_CHOSEN, useChosenRows } from './chosen-rows.js'
import type { ChoiceNow, ChosenRows } from './chosen-rows.js'

/*
 * What a person does with the records chosen, above the records grid
 * (0166, 0174, 0176): a button for each action over a selection the form
 * serves this person, Change the chosen… where it serves them a change of
 * chosen records in some field (`bulk.update`, 0175), and Delete the
 * chosen… where it serves them their deletion (`bulk.delete`, 0173); a
 * status line that says how many records are chosen -- and, when a page
 * of another list or another page cleared a choice, that it did and why,
 * or which records a deletion or a change left chosen; Choose every record
 * on this page, and Clear the choice; under them, the regions a run and a
 * request over the choice are drawn in, as the open record's are under
 * its header (action-region.tsx, 0162; delete-confirm.tsx, 0053).
 *
 * A button pressed with nothing chosen is no dead end and sends nothing:
 * it is `aria-disabled`, never `disabled`, which would drop the keyboard,
 * described by the sentence that says what to do first, which a press says
 * on the status line too -- as the pager and the Columns panel say what
 * cannot be done (0029, 0106) -- and so is Clear the choice, which says
 * there is nothing to clear. Each saying is a new element of the line, as
 * the Columns panel's is, so a press that says what the last one said is
 * heard again. Drawn only on a form that offers one of them: a form
 * without has no bar and no column, and no other grid changes.
 */

/** What a button over the choice is described by, and what a press of it says, while nothing is chosen. */
export const CHOOSE_FIRST = 'Choose records first, with the boxes in the grid’s Choose column.'

/** What a press of Clear the choice says while nothing is chosen. */
export const NOTHING_TO_CLEAR = 'There is nothing to clear.'

/** The records grid's choice, the flow of the actions over it and of its deletion or change, where the form offers this person one. */
export interface Selection {
  /** Whether the form serves this person an action over a selection, or a deletion or a change of chosen records: the bar and the column are drawn only then. */
  offered: boolean
  flow: ActionFlow
  request: ChosenFlow
  rows: ChosenRows
  now: ChoiceNow
}

/** What the form's actions and a request over its chosen records are given: a run's options, and what a deletion closes and lists of the Drill down levels. */
export type ActionsOptions = Omit<ActionFlowOptions, 'chosen' | 'drill'> &
  Pick<ChosenOptions, 'onGone'> & { drill: ActionFlowOptions['drill'] & ChosenOptions['drill'] }

/**
 * A form's actions: the open record's flow, which its header offers
 * (0162), and the choice of the records grid's page with a flow over it
 * beside that one and its deletion or change, which the bar offers (0166,
 * 0174, 0176) -- each of them may be out at once (action-flow.ts,
 * chosen-flow.ts).
 */
export function useActions(options: ActionsOptions): { running: ActionFlow; selection: Selection } {
  const running = useActionFlow(options)
  const { rows, now } = useChosenRows(options.entry.title)
  const flow = useActionFlow({ ...options, chosen: rows })
  const request = useChosen({ ...options, chosen: rows })
  // What the record's forms hear, the choice hears too: the version a chosen record is sent at (chosen-rows.ts).
  useEffect(() => hearForms(rows, options.sessions), [rows, options.sessions])
  const offered = flow.actions.length > 0 || request.deletes || request.changes.length > 0
  return { running, selection: { offered, flow, request, rows, now } }
}

/** The bar above the records grid, and the regions a run over the records chosen and their deletion or change are drawn in. */
export function SelectionBar({ selection, idBase }: { selection: Selection; idBase: string }): ReactElement {
  const { flow, request, rows, now } = selection
  const none = now.chosen.size === 0
  const hint = `${idBase}-hint`
  /** What a press of a button over the choice does while nothing is chosen: says what to do first, sending nothing. */
  const first = (): void => rows.clear(`${NONE_CHOSEN} ${CHOOSE_FIRST}`)
  const waiting = { 'aria-disabled': none ? 'true' : undefined, 'aria-describedby': none ? hint : undefined } as const
  return (
    <>
      <div className="choice-bar" role="group" aria-label="Chosen records">
        {flow.actions.map((action) => (
          <button
            key={action.name}
            type="button"
            className="button"
            ref={flow.buttonRef(action.name)}
            {...waiting}
            onClick={() => (none ? first() : flow.ask(action))}
          >
            {flow.label(action)}
          </button>
        ))}
        {request.changes.length > 0 ? (
          <button type="button" className="button" ref={request.changeRef} {...waiting} onClick={() => (none ? first() : request.askChange())}>
            {CHANGE_CHOSEN}
          </button>
        ) : null}
        {request.deletes ? (
          <button type="button" className="button" ref={request.deleteRef} {...waiting} onClick={() => (none ? first() : request.askDelete())}>
            {DELETE_CHOSEN}
          </button>
        ) : null}
        <p role="status" id={`${idBase}-status`} className="choice-status">
          <span key={now.count}>{now.said}</span>
        </p>
        <button type="button" className="button quiet" onClick={() => rows.all()}>
          Choose every record on this page
        </button>
        <button
          type="button"
          className="button quiet"
          aria-disabled={none ? 'true' : undefined}
          onClick={() => rows.clear(none ? `${NONE_CHOSEN} ${NOTHING_TO_CLEAR}` : undefined)}
        >
          Clear the choice
        </button>
        {none ? (
          <p id={hint} className="hint choice-hint">
            {CHOOSE_FIRST}
          </p>
        ) : null}
      </div>
      <ActionRegion flow={flow} idBase={`${idBase}-run`} />
      <ChosenRegion flow={request} idBase={`${idBase}-chosen`} />
    </>
  )
}
