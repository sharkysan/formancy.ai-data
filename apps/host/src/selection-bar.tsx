import type { ReactElement } from 'react'
import { useActionFlow } from './action-flow.js'
import type { ActionFlow, ActionFlowOptions } from './action-flow.js'
import { ActionRegion } from './action-region.js'
import { NONE_CHOSEN, useChosenRows } from './chosen-rows.js'
import type { ChoiceNow, ChosenRows } from './chosen-rows.js'

/*
 * The actions over a selection, above the records grid (0166): a button
 * for each action over a selection the form serves this person, a status
 * line that says how many records are chosen -- and, when a page of
 * another list or another page cleared a choice, that it did and why --
 * Choose every record on this page, and Clear the choice; under them, the
 * region a run is drawn in, as the open record's is under its header
 * (action-region.tsx, 0162).
 *
 * An action pressed with nothing chosen is no dead end and sends nothing:
 * it is `aria-disabled`, never `disabled`, which would drop the keyboard,
 * described by the sentence that says what to do first, which a press says
 * on the status line too -- as the pager and the Columns panel say what
 * cannot be done (0029, 0106) -- and so is Clear the choice, which says
 * there is nothing to clear. Each saying is a new element of the line, as
 * the Columns panel's is, so a press that says what the last one said is
 * heard again. Drawn only on a form with such an action: a form without
 * one has no bar and no column, and no other grid changes.
 */

/** What an action's button is described by, and what a press of it says, while nothing is chosen. */
export const CHOOSE_FIRST = 'Choose records first, with the boxes in the grid’s Choose column, then run an action over them.'

/** What a press of Clear the choice says while nothing is chosen. */
export const NOTHING_TO_CLEAR = 'There is nothing to clear.'

/** The records grid's choice and the flow of the actions over it, where the form offers this person one. */
export interface Selection {
  /** Whether the form serves this person an action over a selection: the bar and the column are drawn only then. */
  offered: boolean
  flow: ActionFlow
  rows: ChosenRows
  now: ChoiceNow
}

/**
 * A form's actions: the open record's flow, which its header offers
 * (0162), and the choice of the records grid's page with a flow over it
 * beside that one, which the bar offers (0166) -- each run of either may
 * be out at once (action-flow.ts).
 */
export function useActions(options: Omit<ActionFlowOptions, 'chosen'>): { running: ActionFlow; selection: Selection } {
  const running = useActionFlow(options)
  const { rows, now } = useChosenRows(options.entry.title)
  const flow = useActionFlow({ ...options, chosen: rows })
  return { running, selection: { offered: flow.actions.length > 0, flow, rows, now } }
}

/** The bar above the records grid, and the region a run over the records chosen is drawn in. */
export function SelectionBar({ selection, idBase }: { selection: Selection; idBase: string }): ReactElement {
  const { flow, rows, now } = selection
  const none = now.chosen.size === 0
  const hint = `${idBase}-hint`
  return (
    <>
      <div className="choice-bar" role="group" aria-label="Chosen records">
        {flow.actions.map((action) => (
          <button
            key={action.name}
            type="button"
            className="button"
            ref={flow.buttonRef(action.name)}
            aria-disabled={none ? 'true' : undefined}
            aria-describedby={none ? hint : undefined}
            onClick={() => (none ? rows.clear(`${NONE_CHOSEN} ${CHOOSE_FIRST}`) : flow.ask(action))}
          >
            {flow.label(action)}
          </button>
        ))}
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
    </>
  )
}
