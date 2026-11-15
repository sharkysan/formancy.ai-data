import { describe, expect, test } from 'vitest'
import type { ObjectMeta } from '../metadata.js'
import { audited, auditedForm, DATE, INSTANT, STAMPS, WALL_CLOCK } from '../records/test-stamps.js'
import { col, fk, restrict, snapshot, table, text } from '../records/test-support.js'
import { priced } from '../records/test-versions.js'
import { generateForm } from './generate.js'
import { stampedOn } from './stamps.js'
import type { FieldBinding, StampChoice } from './types.js'

/*
 * The columns the server stamps (0153), as the generator binds them: what
 * it keeps, what it makes of each stamped column's field, what it still
 * offers, and every stamp it refuses to make.
 */

const auditedTable = (objects: ObjectMeta[]) => objects.find((object) => object.ref.name === 'audited') as ObjectMeta
const writesOf = (fields: readonly FieldBinding[]) => Object.fromEntries(fields.map((binding) => [binding.field, binding.writes]))
const STAMPED = ['created_by', 'created_at', 'created_in', 'changed_by', 'changed_at', 'changed_on']

describe('a stamped column', () => {
  // The stamps are kept as confirmed, in catalog order, each with its
  // column's type; each stamped column is a field shown and never written
  // -- no grant can make a person its author -- in the Record section,
  // never required, with a note that says what fills it and when. A NOT
  // NULL created_by with no default does not stop create: the server
  // gives it its value, as it gives a pinned tenant one. Watched failing
  // with the stamp left out of `possible`: every stamped field was written
  // on create and update, created_by was a required input, and the note
  // was missing.
  test('is kept as confirmed, and its field is shown and never written', () => {
    for (const kind of ['postgres', 'sqlserver'] as const) {
      const { form, bindings, notes } = auditedForm(audited(kind))
      expect(bindings.stamps, kind).toEqual([
        { column: 'created_by', value: { kind: 'actor' }, on: 'create', type: text(40) },
        { column: 'created_at', value: { kind: 'time' }, on: 'create', type: INSTANT },
        { column: 'created_in', value: { kind: 'attribute', attribute: 'site' }, on: 'create', type: text(20) },
        { column: 'changed_by', value: { kind: 'actor' }, on: 'update', type: text(40) },
        { column: 'changed_at', value: { kind: 'time' }, on: 'both', type: WALL_CLOCK },
        { column: 'changed_on', value: { kind: 'time' }, on: 'update', type: DATE },
      ])
      const writes = writesOf(bindings.fields)
      for (const field of STAMPED) expect(writes[field], `${kind} ${field}`).toEqual({ create: false, update: false })
      expect(writes['note'], kind).toEqual({ create: true, update: true })
      expect(
        form.model.fields.filter((field) => field.required === true).map((field) => field.key),
        kind,
      ).toEqual([])
      for (const field of STAMPED) expect(form.logic?.rules, `${kind} ${field}`).toContainEqual({ target: field, kind: 'disabled', cel: 'true' })
      expect(bindings.operations, kind).toEqual({ create: true, update: true, delete: true })
      expect(
        notes.filter((note) => note.message.includes('(0153)')).map((note) => `${note.subject}: ${note.message}`),
        kind,
      ).toEqual([
        "created_by: Stamped by the server on create with the signed-in person's id, never by the person filling the form (0153).",
        "created_at: Stamped by the server on create with the time the save runs, by the database's clock, never by the person filling the form (0153).",
        "created_in: Stamped by the server on create with the signed-in person's site, never by the person filling the form (0153).",
        "changed_by: Stamped by the server on update with the signed-in person's id, never by the person filling the form (0153).",
        "changed_at: Stamped by the server on create and on update with the time the save runs, by the database's clock, never by the person filling the form (0153).",
        "changed_on: Stamped by the server on update with the time the save runs, by the database's clock, never by the person filling the form (0153).",
      ])
      const record = form.layouts?.[0]?.nodes.find((node) => node.kind === 'section' && node.label === 'Record')
      expect(JSON.stringify(record), kind).toContain('"path":"created_by"')
      expect(JSON.stringify(record), kind).toContain('"path":"changed_on"')
    }
  })

  // A request without stamps generates as before 0153, byte for byte: no
  // `stamps` in the bindings, so every form published before keeps
  // comparing equal to its regeneration (0030). An empty list is none.
  test('is nowhere in a form that names none', () => {
    for (const stamps of [null, []]) {
      const { bindings } = auditedForm(audited('postgres'), stamps)
      expect(Object.hasOwn(bindings, 'stamps')).toBe(false)
    }
    // Unstamped, created_by is the person's to fill, and a create needs it.
    const { form } = auditedForm(audited('postgres'), null)
    expect(form.model.fields.find((field) => field.key === 'created_by')?.required).toBe(true)
  })

  // Which stamps each write fills: a create's, an update's, and those on both in each.
  test('is written on the operations it names', () => {
    expect(stampedOn(STAMPS, 'create').map((stamp) => stamp.column)).toEqual(['created_by', 'created_at', 'created_in', 'changed_at'])
    expect(stampedOn(STAMPS, 'update').map((stamp) => stamp.column)).toEqual(['changed_by', 'changed_at', 'changed_on'])
    expect(stampedOn(undefined, 'create')).toEqual([])
  })

  // What the account may not write stops the write that stamps it, as a
  // pinned tenant the account may not INSERT stops create (0027): every
  // such save would fail in the database. Said, not thrown, since the
  // stamp itself is sound. Watched failing with `unstampable` unasked:
  // both writes were offered over a column the account may not write.
  test('stops the write that stamps it where the account may not write it', () => {
    const offered = (edit: (objects: ObjectMeta[]) => void) => {
      const { bindings, notes } = auditedForm(audited('postgres', edit))
      return {
        operations: bindings.operations,
        said: notes.filter((note) => note.kind === 'blocked').map((note) => note.message),
      }
    }
    expect(offered((objects) => restrict(objects, 'audited', 'created_at', { insert: false }))).toEqual({
      operations: { create: false, update: true, delete: true },
      said: ["Create is not offered: created_at is stamped by the server on create, and this connection's account may not INSERT it."],
    })
    expect(offered((objects) => restrict(objects, 'audited', 'changed_on', { update: false }))).toEqual({
      operations: { create: true, update: false, delete: true },
      said: ["Update is not offered: changed_on is stamped by the server on update, and this connection's account may not UPDATE it."],
    })
  })

  // Each refusal is a stamp no write could honour, or one that would make
  // the column something else as well. Watched failing with each check
  // taken out in turn: a person stamped into an integer, the time into a
  // text, a pinned tenant stamped -- which would filter every read by the
  // creator -- and a key stamped on update, which would move the record.
  test('is refused where no write could honour it', () => {
    const refused = (stamps: unknown[], edit: (objects: ObjectMeta[]) => void = () => {}, extra = {}) => {
      return () => auditedForm(audited('sqlserver', edit), stamps as StampChoice[], extra)
    }
    const actor = (name: string, on = 'create'): unknown => ({ column: name, value: { kind: 'actor' }, on })
    const time = (name: string, on = 'create'): unknown => ({ column: name, value: { kind: 'time' }, on })
    expect(refused([actor('made_by')])).toThrow('audited has no column made_by to stamp')
    expect(refused([actor('created_by'), time('created_by')])).toThrow('created_by is stamped twice')
    expect(refused([actor('created_by', 'never')])).toThrow('each stamp is { column, value')
    expect(refused([{ column: 'created_by', value: { kind: 'robot' }, on: 'create' }])).toThrow('each stamp is { column, value')
    expect(refused([{ column: 'created_by', value: { kind: 'actor' }, on: 'create', from: 'browser' }])).toThrow('each stamp is { column, value')
    expect(refused([{ column: 'created_in', value: { kind: 'attribute', attribute: ' ' }, on: 'create' }])).toThrow(
      'created_in cannot be stamped: the attribute it is stamped with has no name',
    )
    expect(refused([actor('version')], () => {}, { versionColumn: undefined })).toThrow(
      'version cannot be stamped: it is integer, and a person is stamped as text',
    )
    expect(refused([time('note')])).toThrow('note cannot be stamped: it is text, and the time is stamped into an instant, a wall clock or a date')
    expect(refused([time('due')], (objects) => auditedTable(objects).columns.push(col('due', 12, { kind: 'time', precision: 0 }, { nullable: true })))).toThrow(
      'due cannot be stamped: it is time, and the time is stamped into an instant, a wall clock or a date',
    )
    expect(refused([time('id')])).toThrow('id cannot be stamped: the database generates it (identity-always)')
    expect(
      refused([actor('code', 'update')], (objects) => {
        auditedTable(objects).columns.push(col('code', 12, text(10)))
        auditedTable(objects).primaryKey = { name: 'pk_audited', columns: ['code'] }
      }),
    ).toThrow("code cannot be stamped: it is part of the record's key")
    expect(refused([actor('created_in')], () => {}, { pinned: ['tenant_id', 'created_in'] })).toThrow(
      'created_in cannot be stamped: a row filter pins it, and a stamp filters nothing',
    )
    expect(
      refused(
        [actor('created_by')],
        (objects) => {
          objects.push(table('login', [col('name', 1, text(40))], { primaryKey: { name: 'pk_login', columns: ['name'] } }))
          auditedTable(objects).foreignKeys = [fk('fk_audited_creator', ['created_by'], 'login', ['name'])]
        },
        { lookups: [{ foreignKey: 'fk_audited_creator', display: ['name'] }] },
      ),
    ).toThrow('created_by cannot be stamped: a lookup sets it from what the person selects')
    // A version's end is the server's in a change from a date (0113), and its key says which thing it is of.
    const chained = (name: string) => () =>
      generateForm(priced('sqlserver'), {
        connection: 'erp',
        root: { schema: 'sales', name: 'price' },
        formId: 'sales-price',
        title: 'Price',
        lookups: [],
        validity: { from: 'valid_from', to: 'valid_to' },
        stamps: [{ column: name, value: name === 'valid_to' ? { kind: 'time' } : { kind: 'actor' }, on: 'update' }],
      })
    expect(chained('valid_to')).toThrow("valid_to cannot be stamped: it is part of a version's place in its chain")
  })

  // A view is never written, so nothing of it is stamped.
  test('is refused on a view', () => {
    const source = snapshot('postgres')
    expect(() =>
      auditedForm(source, [{ column: 'customer_no', value: { kind: 'actor' }, on: 'create' }], {
        root: { schema: 'sales', name: 'customer_summary' },
        versionColumn: undefined,
        pinned: [],
      }),
    ).toThrow('customer_no cannot be stamped: customer_summary is a view, which no form writes')
  })
})
