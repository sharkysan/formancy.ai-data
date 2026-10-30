import type { DatabaseKind } from '../adapter.js'
import { generateForm } from '../generate/generate.js'
import type { GeneratedForm, GenerationRequest } from '../generate/types.js'
import type { MetadataSnapshot, ObjectMeta } from '../metadata.js'
import type { FormPolicy } from '../policy/types.js'
import { AMOUNT, col, DATE, INT32, INT64, sales, snapshot, table, TENANT, text, withDeleteFacts } from './test-support.js'

/*
 * A table of versions (0113): a product's price per tenant, each row valid
 * from `valid_from` until the next row of the same product starts, the open
 * one NULL in `valid_to`. Its key is the chain's key and the start, so one
 * product's prices are one chain.
 */

/** The snapshot with `sales.price`, its account allowed to delete as one taken since 0049 says, edited as a case needs. */
export function priced(kind: DatabaseKind, edit: (objects: ObjectMeta[]) => void = () => {}): MetadataSnapshot {
  return snapshot(kind, (objects) => {
    objects.push(
      table(
        'price',
        [
          col('tenant_id', 1, INT32),
          col('product_no', 2, INT32),
          col('valid_from', 3, DATE),
          col('valid_to', 4, DATE, { nullable: true }),
          col('amount', 5, AMOUNT),
          col('note', 6, text(100), { nullable: true }),
          kind === 'sqlserver'
            ? col('row_version', 7, { kind: 'rowversion' }, { generated: 'rowversion' })
            : col('row_version', 7, INT64, { hasDefault: true }),
        ],
        { primaryKey: { name: 'pk_price', columns: ['tenant_id', 'product_no', 'valid_from'] } },
      ),
    )
    withDeleteFacts(objects)
    edit(objects)
  })
}

/** The price form: its versions' chain named -- `null` for none -- the tenant pinned, and on PostgreSQL the version column confirmed. */
export function priceForm(source: MetadataSnapshot, validity: GenerationRequest['validity'] | null = { from: 'valid_from', to: 'valid_to' }): GeneratedForm {
  return generateForm(source, {
    connection: 'erp',
    root: sales('price'),
    formId: 'sales-price',
    title: 'Price',
    lookups: [],
    pinned: ['tenant_id'],
    ...(source.kind === 'postgres' ? { versionColumn: 'row_version' } : {}),
    ...(validity === null || validity === undefined ? {} : { validity }),
  })
}

const PRICE_RW = { read: ['clerk'], write: ['clerk'] }

/** Clerks do everything with tenant 1's prices; an auditor reads them. */
export const PRICE_POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk', 'auditor'], create: ['clerk'], update: ['clerk'] },
  fields: {
    tenant_id: { read: ['clerk', 'auditor'], write: [] },
    product_no: PRICE_RW,
    valid_from: PRICE_RW,
    valid_to: { read: ['clerk', 'auditor'], write: [] },
    amount: PRICE_RW,
    note: PRICE_RW,
  },
  rowFilters: TENANT,
  lookups: {},
}
