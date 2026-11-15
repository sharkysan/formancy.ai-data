import { codecFor } from '../codecs/codec.js'
import { stampedOn } from '../generate/stamps.js'
import type { FormBindings } from '../generate/types.js'
import type { ColumnMeta } from '../metadata.js'
import type { PolicyContext } from '../policy/types.js'
import type { PlanRefusal } from './plan-types.js'
import { type Prepared, refuse } from './prepare.js'
import type { ClockColumn, RecordValue } from './types.js'

/*
 * What a write stamps (0153): the columns the server fills on this
 * operation, never from the request. Who is the verified context's -- the
 * actor's id or one of its attributes -- bound as a parameter through the
 * column's codec, as a pinned tenant is; when is the database's own clock,
 * which the adapter writes in the statement itself, so this package reads
 * no clock (formancy.ai 0019).
 */

/** The values of who a write stamps, and the columns it gives the database's clock. */
export interface Stamped {
  values: RecordValue[]
  clock: ClockColumn[]
}

/**
 * What `operation` stamps for this person, or why it cannot: an attribute
 * the context lacks is `missing-attribute`, as a row filter's is; a value
 * the column's codec refuses -- an id longer than the column, in its unit
 * -- is `unstampable`, naming the column and never the value. What the
 * codec accepts and the database then refuses is the database's answer for
 * that column (0153). Never cut to fit: a stamp that is not who wrote the
 * row says something untrue.
 *
 * `prepare` has held every stamp to its column (`stampProblem`), so a stamp
 * of the time is a timestamp or a date, and a column is in the snapshot.
 */
export function stampsOf(
  prepared: Prepared,
  bindings: FormBindings,
  context: PolicyContext,
  operation: 'create' | 'update',
): { ok: true; stamped: Stamped } | PlanRefusal {
  const stamped: Stamped = { values: [], clock: [] }
  for (const stamp of stampedOn(bindings.stamps, operation)) {
    const column = prepared.columns.get(stamp.column) as ColumnMeta
    if (stamp.value.kind === 'time') {
      stamped.clock.push({ name: stamp.column, type: column.type as ClockColumn['type'] })
      continue
    }
    const { value } = stamp
    const who = value.kind === 'actor' ? context.actor.id : Object.hasOwn(context.attributes, value.attribute) ? context.attributes[value.attribute] : undefined
    const what = value.kind === 'actor' ? 'id' : `attribute ${value.attribute}`
    if (who === undefined) return refuse('missing-attribute', `${stamp.column} is stamped with the ${what}, which the context lacks.`)
    const parsed = codecFor(column).parse(who)
    if (!parsed.ok) return refuse('unstampable', `${stamp.column} cannot hold the signed-in person's ${what}: ${parsed.message}`)
    stamped.values.push({ name: stamp.column, type: column.type, value: parsed.value })
  }
  return { ok: true, stamped }
}

/** The columns `operation` stamps, which a write takes from the server and never asks of the answers. */
export function stampedColumns(bindings: FormBindings, operation: 'create' | 'update'): Set<string> {
  return new Set(stampedOn(bindings.stamps, operation).map((stamp) => stamp.column))
}

/** The clock columns a request carries: none is no property, so a request of a form that stamps nothing is what it was before 0153. */
export function clockOf(stamped: Stamped): { clock?: ClockColumn[] } {
  return stamped.clock.length === 0 ? {} : { clock: stamped.clock }
}
