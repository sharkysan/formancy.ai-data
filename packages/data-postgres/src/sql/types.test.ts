import { describe, expect, test } from 'vitest'
import { sqlTypeOf } from './types.js'
import { canonicalText } from './values.js'

/*
 * How a value of an enum is bound and read (0170), as SQL text: what the
 * server does with it is held in states-records.integration.test.ts,
 * which runs first in CI.
 */

describe('an enum', () => {
  // Text has no cast to an enum but through its input function: left as
  // text, an insert is refused with 42804 and a comparison with 42883, and
  // compared as text an enum would sort by the alphabet, not its own order.
  // So a parameter is cast to the type, named from the snapshot, each part
  // quoted. Watched failing with the enum bound as text: pg_catalog.text.
  test('is bound cast to its own type, each name quoted', () => {
    expect(sqlTypeOf({ kind: 'enum', name: { schema: 'states', name: 'order_state' }, labels: ['draft'] })).toBe('"states"."order_state"')
    expect(sqlTypeOf({ kind: 'enum', name: { schema: 'Odd States', name: 'Ticket "Kind"' }, labels: ['bug'] })).toBe('"Odd States"."Ticket ""Kind"""')
  })

  // Its label is its text, which no session setting spells otherwise.
  test('is read as its label', () => {
    expect(canonicalText({ kind: 'enum', name: { schema: 'states', name: 'order_state' }, labels: ['draft'] }, '"r"."state"')).toBe(
      '"r"."state"::pg_catalog.text',
    )
  })
})
