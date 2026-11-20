import { describe, expect, test } from 'vitest'
import { generateForm } from '../generate/generate.js'
import type { GenerationRequest } from '../generate/types.js'
import type { CheckMeta, ColumnMeta, DomainMeta, NormalizedType, ObjectMeta } from '../metadata.js'
import type { DriftReport } from './types.js'
import { addColumn, col, column, diffSnapshots, NO_FILTERS, ORDER, snapshot } from './fixture.js'

/*
 * An enum and a domain's list against a published form (0170), as drift
 * review weighs them (0010) and as the runtime does over the root's
 * description (0041), which the fixture's `diffSnapshots` holds to give the
 * same verdict wherever only the root changed.
 *
 * An enum's labels are its type: one gone -- RENAME VALUE takes the old
 * away -- is a value the select offers and the database refuses, a
 * tightened column whose writes stop, in review and at runtime alike; one
 * added is a value the select cannot show, for review only, since the
 * select refuses it rather than writing another back (formancy.ai 0076).
 * A domain's list is a check, weighed as a table's is (0152): review's,
 * and the runtime compares no check. And a snapshot taken before 0170,
 * where such a column is unsupported, reviewed against one that reads it,
 * changes nothing a form that never bound it offers.
 */

const ORDER_STATE: NormalizedType = { kind: 'enum', name: { schema: 'sales', name: 'order_state' }, labels: ['draft', 'placed', 'shipped'] }
const VARCHAR10: NormalizedType = { kind: 'text', maxLength: 10, lengthUnit: 'code-points', fixedLength: false }
/** `colour as varchar(10) check (value in ('red', 'green', 'blue'))`, as PostgreSQL 17.11 deparses it. */
const COLOUR_LIST = "((VALUE)::text = ANY ((ARRAY['red'::character varying, 'green'::character varying, 'blue'::character varying])::text[]))"
const listOf = (...values: string[]) => `((VALUE)::text = ANY ((ARRAY[${values.map((value) => `'${value}'::character varying`).join(', ')}])::text[]))`

/** On PostgreSQL, where a confirmed version column offers update. */
const REQUEST: GenerationRequest = { ...ORDER, versionColumn: 'row_version' }

const enumState = (type: NormalizedType = ORDER_STATE, extra: Partial<ColumnMeta> = {}): ColumnMeta =>
  col('state', 'sales.order_state', type, { hasDefault: true, defaultExpression: "'placed'::sales.order_state", ...extra })
const colourCheck = (expression = COLOUR_LIST, extra: Partial<CheckMeta> = {}): CheckMeta => ({
  name: 'colour_check',
  expression,
  enforced: true,
  validated: true,
  ...extra,
})
const colourDomain = (checks: CheckMeta[] = [colourCheck()]): DomainMeta => ({ ref: { schema: 'sales', name: 'colour' }, checks })
const colour = (domains: DomainMeta[] = [colourDomain()], extra: Partial<ColumnMeta> = {}): ColumnMeta =>
  col('colour', 'sales.colour', VARCHAR10, { nullable: true, domains, ...extra })

/** The domain column as discovery before 0170 read it: unsupported, with no domains. */
const colourBefore = (): ColumnMeta => col('colour', 'sales.colour', { kind: 'unsupported' }, { nullable: true })

const adding =
  (...columns: ColumnMeta[]) =>
  (objects: ObjectMeta[]): void => {
    for (const added of columns) addColumn(objects, 'order', added)
  }

/** The order form published over `before`'s columns, reviewed against `after`'s. */
function review(before: ColumnMeta[], after: ColumnMeta[]): DriftReport {
  const base = snapshot(adding(...before), { kind: 'postgres' })
  return diffSnapshots(base, snapshot(adding(...after), { kind: 'postgres' }), generateForm(base, REQUEST).bindings, NO_FILTERS)
}

const shape = (report: DriftReport) => report.changes.map((change) => [change.kind, change.severity, 'name' in change.subject ? change.subject.name : ''])

describe('a snapshot taken before 0170 against one that reads its enums and domains', () => {
  // Every enum and every domain was unsupported before 0170, and no form
  // bound one: read now, the column is noted, and nothing the form offers
  // stops. Watched failing with the message as it was: "its type changed
  // from sales.order_state to sales.order_state".
  test('an enum, and a domain over a list, never bound, are noted and stop nothing', () => {
    const unsupported: NormalizedType = { kind: 'unsupported' }
    const report = review([enumState(unsupported), colourBefore()], [enumState(), colour()])
    expect(shape(report)).toEqual([
      ['column-type-changed', 'info', 'colour'],
      ['column-type-changed', 'info', 'state'],
    ])
    expect(report.changes.map((change) => change.message)).toEqual([
      'colour: its type, sales.colour, was unsupported and is now read as text. No field of this form binds it.',
      'state: its type, sales.order_state, was unsupported and is now read as enum. No field of this form binds it.',
    ])
    expect(report).toMatchObject({ blocking: false, readable: true, writable: { create: true, update: true } })
    expect(report.runtime).toMatchObject({ readable: true, writable: { create: true, update: true } })
  })

  // The one case where reading a domain stops something: a domain NOT NULL
  // with no default, on a column the form never wrote, refused every
  // create already -- PostgreSQL holds an INSERT that leaves the column out
  // to the domain, NULL and all -- and review now says so, and stops create
  // until the form is generated again with the column in it.
  test('a domain NOT NULL with no default, never bound, stops create, which the database refused already', () => {
    const report = review([colourBefore()], [colour(undefined, { nullable: false })])
    expect(shape(report)).toEqual([['column-type-changed', 'blocking', 'colour']])
    expect(report.writable).toMatchObject({ create: false, update: true })
  })
})

describe('a published select of an enum against its labels', () => {
  test('the base form binds the enum as a select of its labels', () => {
    const base = snapshot(adding(enumState()), { kind: 'postgres' })
    expect(generateForm(base, REQUEST).bindings.fields.find((binding) => binding.field === 'state')).toMatchObject({ kind: 'column', type: ORDER_STATE })
  })

  // ADD VALUE: a value a row may now hold, which the select does not offer,
  // and refuses to save until an offered one is chosen. For review; nothing
  // stops, in review or at runtime. Watched failing with the label read as
  // the type loosened alone: "Every value the form accepts is still
  // accepted", a note.
  test('a label added is a field the column outgrew, for review, and stops nothing', () => {
    const report = review([enumState()], [enumState({ ...ORDER_STATE, labels: ['draft', 'placed', 'shipped', 'cancelled'] })])
    expect(shape(report)).toEqual([['column-outgrew-field', 'review', 'state']])
    expect(report.changes[0]?.message).toBe(
      'state: its type, sales.order_state, now has “cancelled” too. state does not offer “cancelled”, which a row may now hold: the select refuses to save a record holding one until an offered label is chosen; generate the form again to offer what the column now holds.',
    )
    expect(report).toMatchObject({ blocking: false, writable: { create: true, update: true } })
    expect(report.runtime.writable).toMatchObject({ create: true, update: true })
  })

  // RENAME VALUE: the select still offers placed, which the database now
  // refuses with 22P02 -- a tightened column, whose writes stop until the
  // form is generated again, in review and at runtime, which reads the
  // labels with the type (0041). Watched failing with the labels left out
  // of the comparison: the rename was the same type, and nothing stopped.
  test('a label renamed is a tightened column, whose writes stop, in review and at runtime', () => {
    const report = review([enumState()], [enumState({ ...ORDER_STATE, labels: ['draft', 'ordered', 'shipped'] })])
    expect(shape(report)).toEqual([['column-tightened', 'blocking', 'state']])
    expect(report.changes[0]?.message).toBe(
      'state: its type, sales.order_state, no longer has “placed” and now has “ordered”. The form would accept values the database now refuses, so writes of state are blocked until its validation is reviewed.',
    )
    expect(report).toMatchObject({ readable: true, writable: { create: false, update: false } })
    expect(report.runtime).toMatchObject({ readable: true, writable: { create: false, update: false } })
  })

  // Another type is cast to another name: the published binding would cast
  // a value to one that is gone (42704). Read with the codec it was
  // published with, the form is blocked until it is reviewed.
  test('the type renamed or moved is another type, and the form is blocked', () => {
    const moved = { ...ORDER_STATE, name: { schema: 'sales', name: 'order_status' } } as NormalizedType
    const report = review([enumState()], [enumState(moved, { databaseType: 'sales.order_status' })])
    expect(shape(report)).toEqual([['column-type-changed', 'blocking', 'state']])
    expect(report.readable).toBe(false)
  })
})

describe("a published select of a domain's list against the domain", () => {
  test("the base form binds the domain's list", () => {
    const base = snapshot(adding(colour()), { kind: 'postgres' })
    expect(generateForm(base, REQUEST).bindings.fields.find((binding) => binding.field === 'colour')).toMatchObject({
      listed: { check: 'colour_check', domain: { schema: 'sales', name: 'colour' }, values: ['blue', 'green', 'red'] },
    })
  })

  // The domain's list narrowed: a value the select offers that the
  // database now refuses, a tightened column for review; the runtime, which
  // compares no check, leaves it to the database (0152). Watched failing
  // with the domains left out of review's lists: nothing stopped.
  test('a value gone from the domain stops writes of the field in review, and the runtime leaves it to the database', () => {
    const report = review([colour()], [colour([colourDomain([colourCheck(listOf('red', 'green'))])])])
    expect(shape(report)).toEqual([['column-tightened', 'blocking', 'colour']])
    expect(report.changes[0]?.message).toBe(
      'colour_check of sales.colour no longer lists “blue”, which colour still offers and the database now refuses, so writes of colour are blocked until the form is generated again.',
    )
    expect(report.writable).toMatchObject({ create: false, update: false })
    expect(report.runtime.writable).toMatchObject({ create: true, update: true })
  })

  test('a value added to the domain is a field the column outgrew, for review', () => {
    const report = review([colour()], [colour([colourDomain([colourCheck(listOf('red', 'green', 'blue', 'black'))])])])
    expect(shape(report)).toEqual([['column-outgrew-field', 'review', 'colour']])
    expect(report.changes[0]?.message).toMatch(/^colour_check of sales\.colour now lists “black” too, and colour does not offer it\./)
    expect(report.blocking).toBe(false)
  })

  // The check dropped from the domain, or the domain's list no longer
  // validated: a row may hold any value, which the select cannot show.
  test.each([
    ['dropped', [colourDomain([])], 'colour_check of sales.colour, whose values colour offers, is gone from colour.'],
    [
      'no longer validated',
      [colourDomain([colourCheck(COLOUR_LIST, { validated: false })])],
      'colour offers the values colour_check of sales.colour listed, and colour_check of sales.colour no longer holds colour to a list: it was not validated, so a row from before it may hold a value it does not list, which a select could not show.',
    ],
  ])('the list %s is a field the column outgrew, for review', (_case, domains, because) => {
    const report = review([colour()], [colour(domains)])
    expect(shape(report)).toEqual([['column-outgrew-field', 'review', 'colour']])
    expect(report.changes[0]?.message.startsWith(because)).toBe(true)
  })

  // A second list, added NOT VALID to the column's domain, still holds
  // every new or changed row: one that leaves out an offered value stops
  // writes, as one of the table's does.
  test('a list beside it, NOT VALID, that leaves out an offered value stops writes', () => {
    const report = review([colour()], [colour([colourDomain([colourCheck(), { ...colourCheck(listOf('red')), name: 'colour_red', validated: false }])])])
    expect(shape(report)[0]).toEqual(['column-tightened', 'blocking', 'colour'])
    expect(report.writable).toMatchObject({ create: false, update: false })
  })
})

describe('the drift fixture', () => {
  // A guard on this file's own helper: the column it adds is where review looks.
  test('adds the column to the order table', () => {
    const made = snapshot(adding(colour()), { kind: 'postgres' })
    expect(column(made.objects, 'order', 'colour').domains).toHaveLength(1)
  })
})
