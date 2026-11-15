import { describe, expect, test } from 'vitest'
import type { ColumnMeta, MetadataSnapshot, ObjectMeta } from '../metadata.js'
import { driftRefusal } from '../records/drift.js'
import { audited, auditedForm, AUDITED_POLICY } from '../records/test-stamps.js'
import { described, restrict, text } from '../records/test-support.js'
import { diffSnapshots } from './diff.js'

/*
 * A column the server stamps (0153), changed under a published form: what
 * drift review says (0010), and what the runtime then refuses (0041). A
 * stamp is a write of its column on the operations it names, whether or
 * not a field shows it, so a change that could refuse what the server
 * writes stops those operations -- and only those.
 */

const BASE = audited('postgres')
const BINDINGS = auditedForm(BASE).bindings
/** The same form, its creator's column one the account may not read: stamped, and no field shows it. */
const HIDDEN = audited('postgres', (objects) => restrict(objects, 'audited', 'created_by', { select: false }))
const HIDDEN_BINDINGS = auditedForm(HIDDEN).bindings

const auditedTable = (objects: ObjectMeta[]) => objects.find((object) => object.ref.name === 'audited') as ObjectMeta
const columnOf = (objects: ObjectMeta[], name: string) => auditedTable(objects).columns.find((entry) => entry.name === name) as ColumnMeta
const now = (base: MetadataSnapshot, edit: (objects: ObjectMeta[]) => void) =>
  audited('postgres', (objects) => {
    if (base === HIDDEN) restrict(objects, 'audited', 'created_by', { select: false })
    edit(objects)
  })

describe('a stamped column changed', () => {
  // Gone, a column no field shows is still one every create names: create
  // is stopped, and update, which does not stamp it, is not. Watched
  // failing with the stamp unasked: "created_by is gone. No field of this
  // form binds it.", a note, and every create refused by the database.
  test('gone, stops the writes that stamp it, with or without a field', () => {
    expect(HIDDEN_BINDINGS.fields.some((binding) => binding.field === 'created_by')).toBe(false)
    const hidden = diffSnapshots(
      HIDDEN,
      now(HIDDEN, (objects) => auditedTable(objects).columns.splice(3, 1)),
      HIDDEN_BINDINGS,
      AUDITED_POLICY,
    )
    expect(hidden.changes.map((change) => [change.kind, change.severity, change.message])).toEqual([
      ['column-dropped', 'blocking', 'created_by is gone, and the server stamps it on create (0153). Those writes are blocked until the form is reviewed.'],
    ])
    expect(hidden.writable).toEqual({ create: false, update: true, delete: true })
    // Shown as a field, the form cannot read it either, and is blocked whole.
    const shown = diffSnapshots(
      BASE,
      now(BASE, (objects) => auditedTable(objects).columns.splice(3, 1)),
      BINDINGS,
      AUDITED_POLICY,
    )
    expect(shown).toMatchObject({ readable: false, writable: { create: false, update: false, delete: false } })
  })

  // Retyped to a number, a person no longer fits it; narrowed, an id that
  // fitted may not. Each stops the writes that stamp it -- create for the
  // creator, update for who changed it last -- and the runtime refuses
  // those writes and lets the others through (0041). Watched failing with
  // `stampStops` unasked: the narrowed creator was a note, and every
  // create reached the database.
  test('retyped or narrowed under a stamp of who, stops the writes that stamp it', () => {
    const narrowed = now(HIDDEN, (objects) => (columnOf(objects, 'created_by').type = text(20)))
    const report = diffSnapshots(HIDDEN, narrowed, HIDDEN_BINDINGS, AUDITED_POLICY)
    expect(report.writable).toEqual({ create: false, update: true, delete: true })
    expect(report.changes[0]?.message).toContain('The server stamps it (0153), and what it stamps may no longer fit')
    const root = { ...described(narrowed, HIDDEN_BINDINGS) }
    expect(driftRefusal(HIDDEN, HIDDEN_BINDINGS, AUDITED_POLICY, root, 'create')).toMatchObject({ ok: false, code: 'drift' })
    expect(driftRefusal(HIDDEN, HIDDEN_BINDINGS, AUDITED_POLICY, root, 'update')).toBeUndefined()

    const retyped = now(BASE, (objects) => {
      const changed = columnOf(objects, 'changed_by')
      changed.type = { kind: 'integer', min: '-2147483648', max: '2147483647' }
      changed.databaseType = 'integer'
    })
    // Shown as a field it cannot read with its codec any more, so the form is blocked whole.
    expect(diffSnapshots(BASE, retyped, BINDINGS, AUDITED_POLICY)).toMatchObject({ readable: false })
  })

  // A column no field shows breaks no read when it changes, so only the
  // stamp can stop its writes: retyped to a number, the creator's id is no
  // longer something it holds; made computed, the database refuses any
  // value for it. Either stops create, which stamps it, and leaves update.
  // Watched failing with each half of `retyped` removed in turn: create
  // stayed offered, and every insert would be refused by the database.
  test('retyped or now generated under a stamp no field shows, stops the writes that stamp it', () => {
    const changes = {
      retyped: (column: ColumnMeta) => {
        column.type = { kind: 'integer', min: '-2147483648', max: '2147483647' }
        column.databaseType = 'integer'
      },
      computed: (column: ColumnMeta) => {
        column.generated = 'computed'
      },
    }
    for (const [name, change] of Object.entries(changes)) {
      const changed = now(HIDDEN, (objects) => change(columnOf(objects, 'created_by')))
      const report = diffSnapshots(HIDDEN, changed, HIDDEN_BINDINGS, AUDITED_POLICY)
      expect({ name, readable: report.readable, writable: report.writable }).toEqual({
        name,
        readable: true,
        writable: { create: false, update: true, delete: true },
      })
      expect(report.changes[0]?.message, name).toContain('The server stamps it (0153), and what it stamps may no longer fit')
      const root = { ...described(changed, HIDDEN_BINDINGS) }
      expect(driftRefusal(HIDDEN, HIDDEN_BINDINGS, AUDITED_POLICY, root, 'create'), name).toMatchObject({ ok: false, code: 'drift' })
      expect(driftRefusal(HIDDEN, HIDDEN_BINDINGS, AUDITED_POLICY, root, 'update'), name).toBeUndefined()
    }
  })

  // The time still fits a column of less precision, which rounds it, and
  // one that no longer takes NULL, since a stamp is never NULL: a note, and
  // nothing stopped. Watched failing with every narrowing of a stamped
  // column stopping its writes.
  test('narrowed under a stamp of the time, stops nothing', () => {
    const coarser = now(BASE, (objects) => {
      const changed = columnOf(objects, 'changed_at')
      changed.type = { kind: 'timestamp', withTimeZone: false, precision: 0 }
      changed.databaseType = 'timestamp(0) without time zone'
      columnOf(objects, 'changed_on').nullable = false
      columnOf(objects, 'changed_on').hasDefault = true
    })
    const report = diffSnapshots(BASE, coarser, BINDINGS, AUDITED_POLICY)
    expect(report.writable).toEqual({ create: true, update: true, delete: true })
    expect(report.blocking).toBe(false)
  })

  // A revoked grant on a stamped column is the database refusing every
  // write that stamps it (0027): said as the stamp, and only that write.
  // Watched failing with the stamp unasked: update stayed offered, since
  // the field that shows the column writes nothing.
  test('the account may no longer write, stops the write that stamps it', () => {
    const revoked = now(BASE, (objects) => restrict(objects, 'audited', 'changed_on', { update: false }))
    const report = diffSnapshots(BASE, revoked, BINDINGS, AUDITED_POLICY)
    expect(report.writable).toEqual({ create: true, update: false, delete: true })
    expect(report.changes[0]?.message).toContain('The server stamps it on update (0153), so update is blocked.')
  })
})
