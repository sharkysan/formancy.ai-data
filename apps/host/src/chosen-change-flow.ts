import { changeAnswers, changeEngine, changeFields, chosenLookups, lead, valuesSaid } from './chosen-change.js'
import { atStake, dropped } from './chosen-flow-state.js'
import type { FlowState } from './chosen-flow-state.js'
import { answered, asking } from './chosen-request.js'
import type { ChosenTarget } from './chosen-request.js'
import type { Submitted } from './session.js'

/*
 * A change of the records chosen, before its confirmation (0176): the
 * fields ticked, each drawn on paper, and Continue, which runs the
 * engine's submit -- the renderer's own, so a field's rule refuses an
 * answer there as it would on the record's form -- and then names each
 * lookup it sets by its record's label, read as the typeahead reads one,
 * before the confirmation says each field and its value. Kept out of
 * chosen-flow.ts, which runs what a change and a deletion share, as what
 * changes when a change's question does.
 */

/** Each chosen record's state as the page read it, where the form holds one to moves (0127): what the change's state field offers moves from. */
function statesOf(flow: FlowState, target: ChosenTarget): Array<string | null | undefined> {
  const { definition, chosen } = flow.latest.current
  const { moves } = definition
  if (moves === null) return []
  return target.records.map(({ record }) => {
    const held = chosen.answers(record)?.[moves.field]
    return held === null ? null : typeof held === 'string' || typeof held === 'number' ? String(held) : undefined
  })
}

/**
 * A field's box ticked or unticked: the fields ticked, in the order
 * offered, drawn on a paper of their own that keeps what was typed into
 * those still ticked; nothing while Continue reads its lookups' labels.
 */
export function tickField(flow: FlowState, field: string, on: boolean): void {
  const now = flow.current.current
  if (now.state !== 'asking' || now.asked.reading) return
  const { definition, entry, renderer } = flow.latest.current
  const ticked = changeFields(definition)
    .map(({ key }) => key)
    .filter((key) => (key === field ? on : now.asked.ticked.includes(key)))
  const engine = changeEngine(definition, entry.id, renderer === 'angular' ? 'angular' : 'react', ticked, statesOf(flow, now.target), now.asked.engine)
  flow.set(asking(now, { ticked, engine, reading: false }))
}

/** Whether what a renderer submitted is a form's answers. */
const isAnswers = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Continue, once the engine took the answers: the values each field ticked
 * is set to -- `null` for one left empty -- each lookup named by its
 * record's label, read under the policy's filter for an update; then the
 * confirmation, listing the open record's forms its reading again drops.
 * A second press while the labels are read sends nothing, and a choice
 * changed meanwhile closes it, nothing asked.
 */
export function continueChange(flow: FlowState, submitted: Submitted): void {
  const now = flow.current.current
  if (now.state !== 'asking' || now.asked.reading || now.asked.engine === null || !submitted.ok || !isAnswers(submitted.data) || dropped(flow)) return
  const { client, entry, definition } = flow.latest.current
  const form = now.asked.engine.schema()
  const answers = changeAnswers(now.asked.ticked, submitted.data)
  const reading = { ...now, asked: { ...now.asked, reading: true } }
  flow.set(reading)
  const named = chosenLookups(form, answers).map(({ field, source, token }) =>
    client
      .resolve(entry.id, source, { operation: 'update', tokens: [token] })
      .then((found) => (found.ok ? found.value.find((row) => row.token === token)?.label : undefined))
      // A label that cannot be read is said by its token: the change sends the token either way.
      .catch(() => undefined)
      .then((label) => ({ field, label })),
  )
  void Promise.all(named).then((labels) => {
    // Closed, or asked again over another choice since: this Continue is not what the page shows.
    if (flow.current.current !== reading) return
    const said = new Map(labels.flatMap(({ field, label }) => (label === undefined ? [] : [[field, label] as const])))
    const change = { answers, said: valuesSaid(form, answers, said), lead: lead(definition, answers, reading.target.records.length) }
    flow.set(answered(reading, change, atStake(flow, 'change', reading.target)))
  })
}
