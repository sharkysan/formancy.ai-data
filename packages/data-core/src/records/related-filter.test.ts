import { describe, expect, test } from 'vitest'
import type { ColumnMeta, NormalizedType } from '../metadata.js'
import { type RelatedField, relatedFilters, relatedOffer } from './related-filter.js'

const NAME: NormalizedType = { kind: 'text', maxLength: 200, lengthUnit: 'utf16-code-units', fixedLength: false }
const nickname: ColumnMeta = {
  name: 'nickname',
  ordinal: 3,
  databaseType: 'varchar(200)',
  type: NAME,
  nullable: true,
  hasDefault: false,
  defaultExpression: null,
  generated: 'none',
  comment: null,
  access: { select: true, insert: true, update: true },
}
const THROUGH: RelatedField = {
  field: 'customer.nickname',
  lookup: 'customer',
  column: nickname,
  label: 'Nickname',
  reach: {
    columns: [{ name: 'customer_no', type: { kind: 'integer', min: '-2147483648', max: '2147483647' } }],
    target: { schema: 'sales', name: 'customer' },
    targetColumns: [{ name: 'customer_no', type: { kind: 'integer', min: '-2147483648', max: '2147483647' } }],
    filters: { kind: 'unrestricted' },
  },
}

describe('a condition through a lookup on a column that holds NULLs', () => {
  // A row with no customer, or one whose customer the lookup's filter
  // hides, shows an empty nickname as a customer whose nickname is NULL
  // does; an EXISTS over the customer finds the second alone. Offered,
  // `customer.nickname is empty` would leave out rows the page shows
  // empty, so it is neither offered nor planned, and the lookup's own
  // `is empty` answers for a row with no customer. `is not empty` finds
  // exactly the rows the page shows a nickname for, and stays. Watched
  // failing with the column's own offer used through the lookup.
  test('offers and plans is not empty, and refuses is empty', () => {
    expect(relatedOffer(nickname)?.operators).toEqual(['equals', 'contains', 'not-null'])
    expect(relatedFilters([THROUGH], [{ field: 'customer.nickname', op: 'not-null' }])).toMatchObject({
      ok: true,
      related: [{ target: { name: 'customer' }, filter: [{ op: 'not-null', column: 'nickname' }] }],
    })
    expect(relatedFilters([THROUGH], [{ field: 'customer.nickname', op: 'null' }])).toEqual({
      ok: false,
      message: 'customer.nickname offers no empty condition: a row with no customer shows it empty too, and no condition through customer finds that row.',
    })
  })
})
