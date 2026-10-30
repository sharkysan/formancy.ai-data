import { describe, expect, test } from 'vitest'
import type { ColumnMeta, ObjectMeta } from '../metadata.js'
import { orderForm, restrict, snapshot } from '../records/test-support.js'
import { priced, priceForm } from '../records/test-versions.js'
import type { FieldBinding } from './types.js'

/*
 * A form over a table of versions (0113): the chain the generator binds,
 * what it narrows the form to write, what it no longer offers, and every
 * pair of columns it refuses to hold a chain to.
 */

const price = (objects: ObjectMeta[]) => objects.find((object) => object.ref.name === 'price') as ObjectMeta
const column = (objects: ObjectMeta[], name: string) => price(objects).columns.find((entry) => entry.name === name) as ColumnMeta
const writesOf = (fields: readonly FieldBinding[]) => Object.fromEntries(fields.map((binding) => [binding.field, binding.writes]))

describe('a chain of versions', () => {
  // The chain's key is the key less the start: one product's prices, per
  // tenant. The end is the server's, never the form's; the start and the
  // chain's key are written on create only, so no save moves a version to
  // another place or another chain; delete is gone -- said where it would
  // otherwise be offered, as SQL Server's rowversion offers it -- and a
  // change from a date is offered. Watched failing with the narrowing left
  // out: the end was written on create and update alike.
  test('is bound with its key, and narrows what the form writes', () => {
    for (const kind of ['postgres', 'sqlserver'] as const) {
      const { form, bindings, notes } = priceForm(priced(kind))
      expect(bindings.validity, kind).toEqual({ from: 'valid_from', to: 'valid_to', key: ['tenant_id', 'product_no'] })
      expect(writesOf(bindings.fields), kind).toMatchObject({
        product_no: { create: true, update: false },
        valid_from: { create: true, update: false },
        valid_to: { create: false, update: false },
        amount: { create: true, update: true },
        note: { create: true, update: true },
      })
      expect(bindings.operations, kind).toEqual({ create: true, update: true, delete: false, supersede: true })
      expect(form.logic?.rules, kind).toContainEqual({ target: 'valid_to', kind: 'disabled', cel: 'true' })
      expect(
        notes.filter((note) => note.message.includes('(0113)')).map((note) => `${note.subject}: ${note.kind}`),
        kind,
      ).toEqual(['product_no: read-only', 'valid_from: read-only', 'valid_to: read-only', ...(kind === 'sqlserver' ? ['price: blocked'] : [])])
    }
  })

  // A request without a chain generates as before 0113, byte for byte: no
  // `validity`, and no `supersede` among the operations, so every form
  // published before keeps comparing equal to its regeneration.
  test('is nowhere in a form that names none', () => {
    const { bindings } = orderForm(snapshot('postgres'))
    expect(Object.hasOwn(bindings, 'validity')).toBe(false)
    expect(Object.hasOwn(bindings.operations, 'supersede')).toBe(false)
    expect(priceForm(priced('postgres'), null).bindings.operations).toEqual({ create: true, update: true, delete: false })
  })

  // A change from a date ends one version and starts the next: without
  // UPDATE on the end it could end nothing, and without create it could
  // start nothing. Each is a note, not a refusal of the chain.
  test('offers no change from a date where it could not end one version or start the next', () => {
    const blocked = (edit: (objects: ObjectMeta[]) => void) => {
      const { bindings, notes } = priceForm(priced('sqlserver', edit))
      return {
        supersede: bindings.operations.supersede,
        said: notes.filter((note) => note.kind === 'blocked' && note.message.startsWith('Change from a date')).map((note) => note.message),
      }
    }
    expect(blocked((objects) => restrict(objects, 'price', 'valid_to', { update: false }))).toEqual({
      supersede: false,
      said: ["Change from a date is not offered: it ends a version by writing valid_to, and this connection's account may not UPDATE it."],
    })
    expect(blocked((objects) => restrict(objects, 'price', 'tenant_id', { insert: false }))).toEqual({
      supersede: false,
      said: ['Change from a date is not offered: it ends a version and starts the next, and this form offers no create or no update.'],
    })
  })

  // Each refusal is a pair no chain can be held to. Watched failing with a
  // key of the start alone let through: it bound a chain whose key was
  // empty, every row one thing's version.
  test('is refused where no chain could be held to it', () => {
    const refused =
      (edit: (objects: ObjectMeta[]) => void, validity = { from: 'valid_from', to: 'valid_to' }) =>
      () =>
        priceForm(priced('sqlserver', edit), validity)
    const none = () => {}
    expect(refused(none, { from: 'starts', to: 'valid_to' })).toThrow('price has no column starts for a version to start at')
    expect(refused((objects) => restrict(objects, 'price', 'valid_to', { select: false }))).toThrow(
      "valid_to cannot say where a version ends: this connection's account may not read it",
    )
    expect(refused((objects) => (column(objects, 'valid_to').generated = 'computed'))).toThrow(
      'valid_to cannot say where a version ends: the database computes it',
    )
    expect(refused(none, { from: 'tenant_id', to: 'valid_to' })).toThrow('tenant_id cannot say where a version starts: the policy pins it')
    expect(refused(none, { from: 'amount', to: 'valid_to' })).toThrow('amount is decimal: a version starts at a date or at an instant')
    expect(refused(none, { from: 'valid_from', to: 'valid_from' })).toThrow('a version cannot start and end at one column, valid_from')
    expect(refused((objects) => (column(objects, 'valid_to').type = { kind: 'timestamp', withTimeZone: true, precision: 6 }))).toThrow(
      'valid_from and valid_to are not both dates or both instants',
    )
    expect(refused((objects) => (column(objects, 'valid_to').type = { kind: 'timestamp', withTimeZone: false, precision: 6 }))).toThrow(
      'a version ends at a date or at an instant',
    )
    expect(refused((objects) => (column(objects, 'valid_from').nullable = true))).toThrow('valid_from may be NULL, and every version starts somewhere')
    expect(refused((objects) => (column(objects, 'valid_to').nullable = false))).toThrow('valid_to may not be NULL, and the open version holds NULL there')
    expect(refused((objects) => (price(objects).primaryKey = { name: 'pk_price', columns: ['tenant_id', 'product_no', 'valid_from', 'valid_to'] }))).toThrow(
      'no primary or unique key of price holds valid_from with another column and not valid_to',
    )
    expect(refused((objects) => (price(objects).primaryKey = { name: 'pk_price', columns: ['valid_from'] }))).toThrow(
      'no primary or unique key of price holds valid_from with another column',
    )
    expect(refused((objects) => restrict(objects, 'price', 'product_no', { select: false }))).toThrow(
      "product_no says which thing a version belongs to, and this connection's account may not read it",
    )
    expect(refused((objects) => price(objects).columns.splice(6, 1))).toThrow('has no rowversion and no version column: confirm one')
  })

  // A unique key holds the chain where the primary key is a surrogate: the
  // primary key is asked first, then each unique key in order.
  test('takes its key from a unique key where the primary key is a surrogate', () => {
    const source = priced('sqlserver', (objects) => {
      price(objects).columns.unshift({ ...column(objects, 'tenant_id'), name: 'id', ordinal: 0, generated: 'identity-always' })
      price(objects).primaryKey = { name: 'pk_price', columns: ['id'] }
      price(objects).uniqueKeys = [{ name: 'uq_price_start', columns: ['tenant_id', 'product_no', 'valid_from'] }]
    })
    expect(priceForm(source).bindings.validity).toEqual({ from: 'valid_from', to: 'valid_to', key: ['tenant_id', 'product_no'] })
  })
})
