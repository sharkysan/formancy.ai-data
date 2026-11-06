import { describe, expect, test } from 'vitest'
import { ORDER, snapshot } from '../drift/fixture.js'
import { generateForm } from '../generate/generate.js'
import { presentationShapeProblems } from './apply.js'
import { defaultGroup, formGroup, GROUP_LIMIT, groupProblem, groupProblems } from './group.js'
import { rebasePresentation } from './rebase.js'
import { EMPTY_PRESENTATION } from './types.js'

/*
 * The group a form is listed under (0143), as data: its default from the
 * root's schema and the engine, its shape on every read, its fit at a
 * write -- the default spelled out is the property left out -- and its
 * carry through a regeneration. Over the fixture's order, whose table is
 * in `sales`.
 */

const SALES = { schema: 'sales', name: 'order' }
/** A root in `schema`: the default reads its schema and nothing else of it. */
const inSchema = (schema: string) => ({ schema, name: 'order' })

describe('a form’s group', () => {
  // The default is the schema's name in words, as generation words a
  // column's label (`labelFor`), so `order_entry` reads "Order entry" and
  // not the identifier a person never chose. Watched failing with the
  // schema's name returned as it is: "sales" was the default.
  test('is the root schema’s name in words unless the presentation says otherwise', () => {
    for (const engine of ['postgres', 'sqlserver'] as const) {
      expect(defaultGroup(SALES, engine), engine).toBe('Sales')
      expect(defaultGroup(inSchema('order_entry'), engine), engine).toBe('Order entry')
      expect(defaultGroup(inSchema('OrderEntry'), engine), engine).toBe('Order entry')
      expect(defaultGroup(inSchema('x'.repeat(GROUP_LIMIT + 1)), engine), engine).toBeNull()
    }
    expect(formGroup(undefined, SALES, 'postgres')).toBe('Sales')
    expect(formGroup('Orders', SALES, 'postgres')).toBe('Orders')
    expect(formGroup(null, SALES, 'postgres')).toBeNull()
  })

  // A schema whose words hold no letter or digit gives no group, never a
  // heading of punctuation or spaces: `labelFor` hands such a name back as
  // it is, and "---" or "_" names nothing a person reads as a group.
  // Watched failing with `labelFor`'s answer taken as words whatever it
  // held: "---" was the default.
  test('is no group for a schema whose words hold no letter or digit', () => {
    for (const engine of ['postgres', 'sqlserver'] as const)
      for (const schema of ['---', '_', '  ', '-_-']) expect(defaultGroup(inSchema(schema), engine), `${engine} ${JSON.stringify(schema)}`).toBeNull()
  })

  // The engine's own default schema -- PostgreSQL's public, SQL Server's
  // dbo -- is where tables go when nobody chose a schema, so it names
  // nothing a person reads as a group: its forms are in no group. Matched
  // exactly as each catalog spells it. PostgreSQL folds an unquoted name to
  // lower case, so "Public" is another schema someone quoted; SQL Server's
  // catalog spells its built-in schema dbo whatever the database's
  // collation, and DBO can only be another schema under a case-sensitive
  // one. Each engine's default is any other schema on the other engine.
  // Watched failing with the default schema worded as any other: public
  // was "Public".
  test('is no group for the engine’s own default schema, as its catalog spells it', () => {
    expect(defaultGroup(inSchema('public'), 'postgres')).toBeNull()
    expect(defaultGroup(inSchema('dbo'), 'sqlserver')).toBeNull()
    expect(defaultGroup(inSchema('Public'), 'postgres')).toBe('Public')
    expect(defaultGroup(inSchema('DBO'), 'sqlserver')).toBe('Dbo')
    expect(defaultGroup(inSchema('dbo'), 'postgres')).toBe('Dbo')
    expect(defaultGroup(inSchema('public'), 'sqlserver')).toBe('Public')
    expect(formGroup(undefined, inSchema('public'), 'postgres')).toBeNull()
  })

  // What the default gets wrong, held so the limitations that say it stay
  // true: it words a schema as generation words a label, so an acronym
  // reads as a word and a letter outside A-Z splits the word it is in --
  // generation's own behaviour for labels too, not changed here. An
  // administrator types the group. A release that words them better fails
  // here first, and the register is read again. Watched failing with the
  // schema's name returned as it is: HR was "HR".
  test('words acronyms as words and drops letters outside A-Z, as a label is worded', () => {
    expect(defaultGroup(inSchema('HR'), 'postgres')).toBe('Hr')
    expect(defaultGroup(inSchema('CRM'), 'sqlserver')).toBe('Crm')
    expect(defaultGroup(inSchema('HRData'), 'sqlserver')).toBe('Hrdata')
    expect(defaultGroup(inSchema('Verkäufe'), 'postgres')).toBe('Verk ufe')
  })

  // What a stored presentation may hold: words with no space around them,
  // no control character and no lone surrogate, at most GROUP_LIMIT long,
  // or null for no group. An empty or blank group is a second spelling of
  // null and is refused, never read as it. Watched failing with the
  // group's shape left unasked: "" was read as a group.
  test('is words of at most GROUP_LIMIT, or null for none, by shape', () => {
    for (const group of [null, 'Sales', 'x'.repeat(GROUP_LIMIT)]) expect(presentationShapeProblems({ ...EMPTY_PRESENTATION, group }), String(group)).toEqual([])
    const refused = (group: unknown) => presentationShapeProblems({ ...EMPTY_PRESENTATION, group })
    expect(refused('')).toEqual(['group needs words a person can read; no group is null'])
    expect(refused('   ')).toEqual(['group needs words a person can read; no group is null'])
    expect(refused(' Sales')).toEqual(['group cannot start or end with a space'])
    expect(refused('Sa\tles')).toEqual(['group cannot contain a control character'])
    expect(refused('Sales \uD800')).toEqual(['group cannot contain an unpaired UTF-16 surrogate'])
    expect(refused('x'.repeat(GROUP_LIMIT + 1))).toEqual([`group is at most ${String(GROUP_LIMIT)} characters`])
    expect(refused(7)).toEqual(['group must be words, or null for no group'])
    expect(groupProblem('Sales')).toBeNull()
  })

  // The default spelled out is the property left out, so a presentation
  // has one spelling and two files meaning one thing are byte-equal: what
  // the studio sends as nothing, a write refuses. Watched failing with
  // every group let through: "Sales" over sales was not refused.
  test('is refused at a write where it spells out the default', () => {
    expect(groupProblems(undefined, SALES, 'postgres')).toEqual([])
    expect(groupProblems('Orders', SALES, 'postgres')).toEqual([])
    expect(groupProblems(null, SALES, 'postgres')).toEqual([])
    expect(groupProblems('Sales', SALES, 'postgres')).toEqual(['/group: equals the default, from schema "sales"; leave it out'])
    expect(groupProblems(null, inSchema('  '), 'sqlserver')).toEqual(['/group: equals the default, from schema "  "; leave it out'])
    expect(groupProblems(null, inSchema('public'), 'postgres')).toEqual(['/group: equals the default, from schema "public"; leave it out'])
    expect(groupProblems(null, inSchema('public'), 'sqlserver')).toEqual([])
  })

  // The group is the form's, bound to no field: a regeneration carries it
  // as it is, a cleared one included. Watched failing with group left out
  // of the carried presentation: Orders was the default again.
  test('is carried through a regeneration as it is', () => {
    const { form, bindings } = generateForm(snapshot(), ORDER)
    const next = generateForm(snapshot(), ORDER)
    for (const group of ['Orders', null]) {
      const rebased = rebasePresentation({ base: form, presentation: { ...EMPTY_PRESENTATION, group }, bindings }, { base: next.form, bindings: next.bindings })
      expect(rebased.presentation.group, String(group)).toBe(group)
    }
    const silent = rebasePresentation({ base: form, presentation: EMPTY_PRESENTATION, bindings }, { base: next.form, bindings: next.bindings })
    expect(Object.hasOwn(silent.presentation, 'group')).toBe(false)
  })
})
