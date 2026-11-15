import { generateForm } from '../generate/generate.js'
import type { MetadataSnapshot, ObjectMeta } from '../metadata.js'
import type { FormPolicy } from '../policy/types.js'
import type { SaveBundle } from './save-steps.js'
import { CLERK_RW, col, CUSTOMER_POLICY, fk, INT32, ORDER_POLICY, sales, snapshot, table, TENANT, text, togetherOn } from './test-support.js'

/*
 * Saves of a record with its rows (0155), beside the order and its lines:
 * a customer's notes, saved with it -- a table whose foreign key onto the
 * customer is the customer's whole key, its tenant and its number, so a
 * note's tenant is its customer's; the customer's number typed by the
 * person unless a case gives it a default, its tenant the context's -- and
 * an order whose touch column a row filter pins.
 */

/** The snapshot with `sales.customer_note`, edited as a case needs. */
export function noted(edit: (objects: ObjectMeta[]) => void = () => {}): MetadataSnapshot {
  return snapshot('postgres', (objects) => {
    objects.push(
      table('customer_note', [col('tenant_id', 1, INT32), col('customer_no', 2, INT32), col('note_no', 3, INT32), col('body', 4, text(200))], {
        primaryKey: { name: 'pk_customer_note', columns: ['tenant_id', 'customer_no', 'note_no'] },
        foreignKeys: [fk('fk_customer_note_customer', ['tenant_id', 'customer_no'], 'customer', ['tenant_id', 'customer_no'])],
      }),
    )
    edit(objects)
  })
}

/** The customer's number filled by a sequence's default: a key the database fills in a way `numbersKey` does not count as never repeating. */
export function defaultedNumber(objects: ObjectMeta[]): void {
  const number = (objects.find((object) => object.ref.name === 'customer') as ObjectMeta).columns[1] as ObjectMeta['columns'][number]
  Object.assign(number, { hasDefault: true, defaultExpression: "nextval('customer_no')" })
}

/** Clerks read, write and create notes in their tenant, which their row filter pins and the customer lookup's filter holds too. */
export const NOTE_POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: ['clerk'], update: [] },
  fields: { customer: CLERK_RW, note_no: CLERK_RW, body: CLERK_RW },
  rowFilters: TENANT,
  lookups: { customer: TENANT },
}

/** The notes form, saved with its customer, `min` 1 to `max` 3. */
export function notes(source: MetadataSnapshot, policy: FormPolicy = NOTE_POLICY): SaveBundle {
  const bindings = generateForm(source, {
    connection: 'erp',
    root: sales('customer_note'),
    formId: 'notes',
    title: 'Note',
    lookups: [{ foreignKey: 'fk_customer_note_customer', display: ['name'] }],
  }).bindings
  return { connection: 'erp', snapshot: source, bindings: togetherOn(bindings, 'customer'), policy }
}

/**
 * The customer form over PostgreSQL, which has no version column, so it
 * creates and offers no update. Its tenant is pinned, as the policy's row
 * filter pins it, unless a case says it is typed: with a default on the
 * number, the number is then the database's to fill, and no field writes
 * it (0056). Clerks create customers and write what the form writes,
 * unless a case gives another policy.
 */
export function customers(source: MetadataSnapshot, policy?: FormPolicy, tenant: 'pinned' | 'typed' = 'pinned'): SaveBundle {
  const bindings = generateForm(source, {
    connection: 'erp',
    root: sales('customer'),
    formId: 'sales-customer',
    title: 'Customer',
    lookups: [{ foreignKey: 'fk_customer_country', display: ['name'] }],
    ...(tenant === 'pinned' ? { pinned: ['tenant_id'] } : {}),
  }).bindings
  const filled = bindings.fields.find((binding) => binding.field === 'customer_no')?.writes.create !== true
  const fields = { ...CUSTOMER_POLICY.fields, ...(filled ? { customer_no: { read: ['clerk'], write: [] } } : {}) }
  return {
    connection: 'erp',
    snapshot: source,
    bindings,
    policy: policy ?? { ...CUSTOMER_POLICY, operations: { read: ['clerk'], create: ['clerk'], update: [] }, fields },
  }
}

/** The order's policy with its touch column, `notes`, pinned to the context's `note`, which no field may then write: a save of rows alone would write a pinned column. */
export const TOUCH_PINNED: FormPolicy = {
  ...ORDER_POLICY,
  fields: { ...ORDER_POLICY.fields, notes: { read: ['clerk'], write: [] } },
  rowFilters: [...ORDER_POLICY.rowFilters, { column: 'notes', attribute: 'note' }],
}
