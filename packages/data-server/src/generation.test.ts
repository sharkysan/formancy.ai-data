import { describe, expect, test } from 'vitest'
import { format2Problems } from './bundle-format2.js'
import { readGeneration } from './generation.js'

/*
 * One reading of a generation request (0030), as the proposal route and
 * the bundle check share it, for what 0155 adds: a lookup saved with its
 * record and a rowversion's touch column, each carried exactly when given
 * -- and what makes a server that does not read one refuse a bundle that
 * carries it, rather than serve the child's rows one at a time.
 */

const REQUEST = {
  connection: 'erp',
  root: { schema: 'sales', name: 'order_line' },
  formId: 'order-line',
  title: 'Order line',
  lookups: [{ foreignKey: 'fk_line_order', display: ['notes'], together: { min: 1, max: 3 } }],
  pinned: [],
}

describe('readGeneration (0155)', () => {
  // The reading carries a lookup's bounds and a touch column as given, and
  // neither where it is not given, so a request stored before 0155 reads
  // back byte for byte. Watched failing with `touchColumn` not carried:
  // the reading had none.
  test('carries together and a touch column exactly when they are given', () => {
    expect(readGeneration({ ...REQUEST, touchColumn: 'notes' })).toEqual({ ok: true, generation: { ...REQUEST, touchColumn: 'notes' } })
    const { together: _bounds, ...plain } = REQUEST.lookups[0] as (typeof REQUEST.lookups)[number]
    const read = readGeneration({ ...REQUEST, lookups: [plain] })
    expect(read).toEqual({ ok: true, generation: { ...REQUEST, lookups: [plain] } })
    expect(readGeneration({ ...REQUEST, touchColumn: 7 })).toEqual({ ok: false, problems: ['touchColumn must name a column'] })
  })

  // A server that does not read a key of a lookup choice leaves it out of
  // its reading, and a stored request that is not its own reading is not
  // in its normalised form: the bundle is not served. That is how a server
  // older than 0155 treats `together` -- so it never serves a child whose
  // rows are saved with their record, and never creates or deletes them
  // one at a time past the bound -- and how this one treats whatever a
  // later release adds to a choice, here `rank`. Watched failing with the
  // normalised comparison taken out: the request with `rank` was served,
  // its `rank` read by nothing.
  test('an older reading leaves together out, so the bundle is not served', () => {
    const later = { ...REQUEST, lookups: [{ ...(REQUEST.lookups[0] as object), rank: 1 }] }
    const read = readGeneration(later)
    expect(read.ok && read.generation.lookups[0]).toEqual(REQUEST.lookups[0])
    expect(
      format2Problems({ connection: 'erp', generation: later }, { id: 'order-line', title: 'Order line' } as never, { fields: [] } as never, null),
    ).toContainEqual('generation: is not in its normalised form (lookups and pinned as lists, versionColumn only when given, nothing else)')
  })
})
