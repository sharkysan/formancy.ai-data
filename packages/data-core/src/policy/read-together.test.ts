import type { FormSchema, LogicRule } from '@formancy/spec'
import { describe, expect, test } from 'vitest'
import { readTogether, readTogetherProblems, readTogetherReason } from './read-together.js'
import type { FormPolicy } from './types.js'

/*
 * What a form's rules read together (0175): the fields no change of chosen
 * records may set, since the page cannot run such a rule over each
 * record's other answers and the server runs none. Read from the rules'
 * targets and expressions, each expression as formancy's own parser reads
 * it.
 */

const FIELDS = ['status', 'amount', 'notes', 'items', 'due']
const form = (rules: LogicRule[]): FormSchema =>
  ({
    specVersion: '5',
    id: 'order',
    title: 'Order',
    model: { fields: FIELDS.map((key) => ({ key, type: 'text' })) },
    ...(rules.length === 0 ? {} : { logic: { rules } }),
  }) as unknown as FormSchema

const policy = (fields: string[]): FormPolicy => ({
  version: 1,
  operations: { read: ['clerk'], create: [], update: ['clerk'] },
  fields: {},
  rowFilters: [],
  lookups: {},
  bulk: { update: { roles: ['clerk'], fields } },
})

describe('readTogether', () => {
  // The generator's rules are `disabled` over `true`, which read nothing
  // but their target, and a rule about one field alone is run by the page
  // over the value given: neither reads a field together with another.
  test('finds nothing in a rule about one field alone', () => {
    expect(readTogether(form([]))).toEqual(new Map())
    expect(
      readTogether(
        form([
          { target: 'notes', kind: 'disabled', cel: 'true' },
          { target: 'amount', kind: 'validate', cel: 'amount >= 0', code: 'negative' },
          { target: 'items[].qty', kind: 'required', cel: 'size(items) > 0' },
        ]),
      ),
    ).toEqual(new Map())
  })

  // A rule that decides one field by another reads both: changed for
  // every chosen record, either would leave the rule unrun over each
  // record's other answer. Each field is named with the first rule's
  // target that reads it so. Watched failing with the target left out of
  // what a rule reads: the field a rule hides was granted.
  test('reads the target and every field its expression names together', () => {
    const together = readTogether(
      form([
        { target: 'notes', kind: 'visible', cel: 'status == "shipped"' },
        { target: 'due', kind: 'required', cel: 'amount > 100 && status != "draft"' },
      ]),
    )
    expect(together).toEqual(
      new Map([
        ['notes', 'notes'],
        ['status', 'notes'],
        ['due', 'due'],
        ['amount', 'due'],
      ]),
    )
  })

  // What an expression reads is formancy's own answer, `referencedPaths`
  // over `parse`, the reading its engine builds a form's dependencies
  // from, each path's first key a field: a raw string's escaped quote ends
  // no literal, a comprehension's local named like a field reads no field,
  // and a comment's text is none. Watched failing on this repository's
  // former scan of the tokens, which ended `r'\''` at its second quote and
  // so read `shipped` as a name and `status` as text: the rule on notes
  // read nothing beside it, and both fields were granted.
  test("reads an expression as formancy's parser does", () => {
    const raw = form([{ target: 'notes', kind: 'visible', cel: String.raw`r'\'' != '' && status == 'shipped'` }])
    expect(readTogether(raw)).toEqual(
      new Map([
        ['notes', 'notes'],
        ['status', 'notes'],
      ]),
    )
    const local = form([{ target: 'due', kind: 'required', cel: 'items.exists(amount, amount > 0) // notes' }])
    expect(readTogether(local)).toEqual(
      new Map([
        ['due', 'due'],
        ['items', 'due'],
      ]),
    )
  })

  // An expression the parser refuses is one whose reads nobody can say, so
  // it reads every field, and none of them is granted on a guess: fail
  // closed. Watched failing on the former scan, which read `status ==` as
  // naming status alone and granted amount beside it.
  test('reads every field for an expression that does not parse', () => {
    expect(readTogether(form([{ target: 'notes', kind: 'visible', cel: 'status ==' }]))).toEqual(new Map(FIELDS.map((key) => [key, 'notes'])))
  })

  // A check's validator is answered with the whole submission, and a
  // page's skip hides every field on it by what it reads: each reads every
  // field of the form, whatever its expression names. A skip that names no
  // field hides nothing by an answer. Watched failing with a check read by
  // its target alone: notes was granted under a check on amount.
  test('reads every field for a check, and for a skip that names one', () => {
    const everything = new Map(FIELDS.map((key) => [key, 'amount']))
    expect(readTogether(form([{ target: 'amount', kind: 'check', check: 'credit' }]))).toEqual(everything)
    expect(readTogether(form([{ target: 'page-2', kind: 'skip', cel: 'status == "draft"' }]))).toEqual(new Map(FIELDS.map((key) => [key, 'page-2'])))
    expect(readTogether(form([{ target: 'page-2', kind: 'skip', cel: 'true' }]))).toEqual(new Map())
  })
})

describe('readTogetherProblems', () => {
  // Each field the grant lists that a rule reads together with another is
  // refused, in the grant's order, naming the rule's target; a policy that
  // grants no change of chosen records has nothing to refuse. Watched
  // failing with the problems listed in the rules' order: notes came
  // before status.
  test("refuses each granted field a rule reads together with another, in the grant's order", () => {
    const visible = form([{ target: 'notes', kind: 'visible', cel: 'status == "shipped"' }])
    expect(readTogetherProblems(visible, policy(['amount', 'status', 'notes']))).toEqual([
      "bulk.update.fields: status is read by the rule on notes together with another field, which a change of chosen records cannot run over each record's other answers",
      "bulk.update.fields: notes is read by the rule on notes together with another field, which a change of chosen records cannot run over each record's other answers",
    ])
    expect(readTogetherProblems(visible, policy(['amount']))).toEqual([])
    const { bulk: _bulk, ...granting } = policy([])
    expect(readTogetherProblems(visible, granting)).toEqual([])
  })

  // The studio says why it offers no such field in these words (0176):
  // the reason after the key is readTogetherReason's, one function for
  // the check and the box (watched failing with the check worded on its
  // own: "expected [ Array(1) ] to deeply equal [ Array(1) ]").
  test('says why in the words the studio shows beside the field', () => {
    const visible = form([{ target: 'notes', kind: 'visible', cel: 'status == "shipped"' }])
    expect(readTogetherProblems(visible, policy(['status']))).toEqual([`bulk.update.fields: status ${readTogetherReason('notes')}`])
  })
})
