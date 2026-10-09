import { describe, expect, test } from 'vitest'
import { toAccess } from './access.js'

const row = { access_object: "[sales].[it's [odd]]]", name: 'amount', can_select: 1, can_insert: 0, can_update: 1 }

describe('toAccess', () => {
  // HAS_PERMS_BY_NAME answers NULL for a name it could not parse (B7). Read as
  // "no", a quoting slip would quietly mark a column unreadable and a form
  // would lose a field for a reason nobody could see; it is a defect, and the
  // error names the column and the securable it was asked about.
  test('a NULL answer is refused as a defect, naming the column and the object', () => {
    expect(() => toAccess({ ...row, can_update: null })).toThrow("HAS_PERMS_BY_NAME could not resolve column amount of [sales].[it's [odd]]] for UPDATE")
  })
})
