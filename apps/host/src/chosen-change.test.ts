import { describe, expect, test } from 'vitest'
import type { ChangedRecordOutcome, PublishedForm, Reconciliation, UpdateChosenOutcome } from '@formancy/data-client'
import type { FormSchema } from '@formancy/spec'
import {
  CHANGE_WORDS,
  changeAnswers,
  changeEngine,
  changeFields,
  changeForm,
  chosenLookups,
  CLEARS,
  EACH_CHANGED,
  lead,
  movesEach,
  MOVED,
  NONE_CHANGED,
  ONE_CHANGED,
  READ_AGAIN_REFUSED,
  stuck,
  untickable,
  valuesSaid,
} from './chosen-change.js'
import {
  answer,
  answered,
  askChange,
  askDelete,
  asking,
  checked,
  checking,
  chosenWork,
  close,
  foundNow,
  frameOf,
  heading,
  IDLE,
  leftOf,
  lines,
  marksOf,
  notSent,
  readRefused,
  readRefusedText,
  send,
  settledText,
  summary,
  toCheck,
} from './chosen-request.js'
import type { ChosenRequest, ChosenTarget } from './chosen-request.js'
import { NOT_FOUND } from './deletion.js'
import type { Said } from './leave.js'
import { DECLINED_BY } from './words.js'

/*
 * A change of the records chosen of a page (0176): which fields it offers
 * and draws on paper, what it sends and how its confirmation says it, and
 * -- through the rule a deletion of them shares (chosen-request.ts, 0174)
 * -- what each answer the client can give makes of each record, said in a
 * change's words. Pure: the bar, the paper under each renderer and the
 * outcome are drawn against the real server on both engines by
 * bulk-update.test.tsx, and what the client reads off the wire is
 * data-client's chosen.test.ts.
 */

/** An order form whose status the policy holds to moves from draft to placed to shipped, its rows in two sections, as the generator lays them out. */
const FORM: FormSchema = {
  specVersion: '3',
  id: 'pg-order',
  title: 'Order',
  model: {
    fields: [
      { key: 'id', type: 'number', label: 'Id' },
      { key: 'customer', type: 'select', label: 'Customer', optionsSource: 'pg-order.customer' },
      { key: 'status', type: 'select', label: 'Status', default: 'draft', options: ['draft', 'placed', 'shipped'].map((value) => ({ value, label: value })) },
      { key: 'notes', type: 'text', label: 'Notes', default: 'none yet' },
      // As the generator draws a NOT NULL boolean with no default on a form that creates: a checkbox, required.
      { key: 'rush', type: 'checkbox', label: 'Rush', required: true },
    ],
  },
  layouts: [
    {
      name: 'default',
      nodes: [
        {
          kind: 'section',
          label: 'Order',
          children: [
            { kind: 'field', path: 'customer' },
            { kind: 'field', path: 'status' },
            { kind: 'field', path: 'notes' },
            { kind: 'field', path: 'rush' },
          ],
        },
        { kind: 'section', label: 'Record', children: [{ kind: 'field', path: 'id' }] },
      ],
    },
  ],
}

const MOVES: NonNullable<PublishedForm['moves']> = {
  field: 'status',
  moves: [
    { from: null, to: 'draft' },
    { from: 'draft', to: 'placed' },
    { from: 'placed', to: 'shipped' },
  ],
  labels: [{ state: 'shipped', label: 'Shipped' }],
}

/** The form as the server serves it to a clerk who may change chosen orders' `fields` together. */
const served = (fields: string[] | null, moves: PublishedForm['moves'] = MOVES): PublishedForm =>
  ({
    form: FORM,
    operations: ['read', 'update'],
    readable: ['id', 'customer', 'status', 'notes', 'rush'],
    writable: { create: null, update: ['customer', 'status', 'notes', 'rush'] },
    moves,
    bulk: { delete: false, update: fields },
  }) as unknown as PublishedForm

const ORDERS = served(['notes', 'status', 'customer'])

/** A Said as the page reads it aloud: the code set as plain text. */
const text = (said: Said): string => said.map((part) => (typeof part === 'string' ? part : part.code)).join('')

const at = (record: string, version = '1') => ({ record, version })
const target = (...records: string[]): ChosenTarget => ({ noun: 'Order', records: records.map((record) => at(record)) })

describe('the fields a change offers, and its paper', () => {
  // The fields are `bulk.update`'s, in the form's order -- never the
  // grant's -- each by its heading; none where the form serves no change.
  // A page that drew the grant's order would list a field before one the
  // form draws above it (watched failing with `bulk.update` mapped as
  // served: "expected [ …(3) ] to deeply equal [ { key: 'customer', …(1)
  // }, …(2) ]").
  test('are the grant’s, in the form’s order, by their headings', () => {
    expect(changeFields(ORDERS)).toEqual([
      { key: 'customer', label: 'Customer' },
      { key: 'status', label: 'Status' },
      { key: 'notes', label: 'Notes' },
    ])
    expect(changeFields(served(null))).toEqual([])
  })

  // The paper is the form narrowed to the fields ticked: the others out of
  // its model, and a section left with none of them out of its layout --
  // its heading would head nothing; no field starts at a default, which is
  // a create's, so a change never sends one the person did not give
  // (watched failing with the Record section kept, empty: "expected [ {
  // kind: 'section', …(2) }, …(1) ] to have a length of 1 but got 2").
  test('is the form narrowed to the fields ticked, with no default', () => {
    const narrowed = changeForm(ORDERS, ['notes'], [])
    expect(narrowed.model.fields.map((field) => field.key)).toEqual(['notes'])
    expect(narrowed.model.fields[0]).not.toHaveProperty('default')
    const nodes = narrowed.layouts?.[0]?.nodes ?? []
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ kind: 'section', label: 'Order', children: [{ kind: 'field', path: 'notes' }] })
  })

  // The state field ticked offers every state some chosen record may move
  // to from the state the page read it in, none first since the records
  // are in no one state -- a draft and a placed order may go to placed or
  // shipped, by the administrator's label; a record whose state the page
  // did not read may be in any, so every state a move from one reaches is
  // offered; and where none may go anywhere it is drawn disabled, as the
  // record's form draws it (0127). The server checks each record's move
  // from its own state (watched failing with the states of the first
  // record alone: "expected [ [ 'placed', 'placed' ] ] to deeply equal [ [
  // 'placed', 'placed' ], …(1) ]").
  test('draws the state field as every state some chosen record may move to', () => {
    const options = (froms: Array<string | null | undefined>) =>
      changeForm(ORDERS, ['status'], froms)
        .model.fields.find((field) => field.key === 'status')
        ?.options?.map((option) => [option.value, option.label])
    expect(options(['draft', 'placed'])).toEqual([
      ['placed', 'placed'],
      ['shipped', 'Shipped'],
    ])
    expect(options(['draft', 'draft'])).toEqual([['placed', 'placed']])
    expect(options([undefined])).toEqual([
      ['placed', 'placed'],
      ['shipped', 'Shipped'],
    ])
    const nowhere = changeForm(ORDERS, ['status'], ['shipped'])
    expect(nowhere.logic?.rules).toContainEqual({ target: 'status', kind: 'disabled', cel: 'true' })
  })

  // A box ticked or unticked draws a new paper, the form narrowed to the
  // fields ticked now, which keeps what was typed into those still ticked
  // -- a person who ticks Notes, types, then ticks Status keeps their
  // notes -- and drops what was typed into one unticked; with nothing
  // ticked there is no paper (watched failing with each paper started
  // empty: "expected {} to deeply equal { notes: 'shipped soon' }").
  test('keeps what was typed into the fields still ticked, from paper to paper', () => {
    const first = changeEngine(ORDERS, 'pg-order', 'react', ['notes', 'rush'], [], null)
    first?.setValue(['notes'], 'shipped soon')
    first?.setValue(['rush'], true)
    const second = changeEngine(ORDERS, 'pg-order', 'react', ['status', 'notes'], ['draft'], first ?? null)
    expect(second?.value()).toEqual({ notes: 'shipped soon' })
    expect(second?.schema().model.fields.map((field) => field.key)).toEqual(['status', 'notes'])
    expect(changeEngine(ORDERS, 'pg-order', 'react', [], [], second ?? null)).toBeNull()
  })

  // The state field ticked is required: every move ends at a state (0127),
  // so one left empty is refused for every record -- or the whole request,
  // where its column may not be NULL -- and Continue sends nothing until it
  // is given. Where no chosen record may move from the state the page read
  // it in, its box cannot be ticked, and says why; a record whose state the
  // page did not read may be in any, so it keeps the box; and a paper drawn
  // over such records all the same still sends nothing, never `null`
  // (watched failing with the field's `required` kept as generated:
  // "expected { key: 'status', type: 'select', …(2) } to match object {
  // required: true }").
  test('requires the state field ticked, and refuses its box where no chosen record may move', () => {
    const paper = changeEngine(ORDERS, 'pg-order', 'react', ['status', 'notes'], ['draft'], null)
    expect(paper?.schema().model.fields.find((field) => field.key === 'status')).toMatchObject({ required: true })
    expect(paper?.submit().ok).toBe(false)
    paper?.setValue(['status'], 'placed')
    expect(paper?.submit().ok).toBe(true)
    expect(changeEngine(ORDERS, 'pg-order', 'react', ['status'], ['shipped'], null)?.submit().ok).toBe(false)
    expect(untickable(ORDERS, ['draft', 'shipped'])).toEqual(new Map())
    expect(untickable(ORDERS, [undefined])).toEqual(new Map())
    expect(untickable(ORDERS, ['shipped'])).toEqual(new Map([['status', stuck('Status', 1)]]))
    expect(untickable(ORDERS, ['shipped', 'shipped'])).toEqual(new Map([['status', stuck('Status', 2)]]))
    expect([untickable(served(['notes']), ['shipped']), untickable(served(['status'], null), ['shipped'])]).toEqual([new Map(), new Map()])
  })

  // A checkbox ticked for the change starts unticked, which is "no", and is
  // sent and said so: its column is a NOT NULL boolean -- a nullable one
  // is a select of three (0095) -- which refuses `null`, and with it the
  // whole request. Never required on the paper either, which formancy
  // reads as ticked (0159), so "no" can be set for every record; ticked,
  // it is kept from paper to paper (watched failing with the paper started
  // empty: "expected {} to deeply equal { rush: false }").
  test('starts a checkbox at no, and sends and says it so', () => {
    const rushes = served(['rush'])
    const paper = changeEngine(rushes, 'pg-order', 'react', ['rush'], [], null)
    expect(paper?.value()).toEqual({ rush: false })
    expect(paper?.submit().ok).toBe(true)
    const answers = changeAnswers(['rush'], (paper?.value() ?? {}) as Record<string, unknown>)
    expect(answers).toEqual({ rush: false })
    expect(valuesSaid(changeForm(rushes, ['rush'], []), answers, new Map()).map(text)).toEqual(['Rush: no'])
    expect(lead(rushes, answers, 2)).toEqual([EACH_CHANGED])
    paper?.setValue(['rush'], true)
    expect(changeEngine(rushes, 'pg-order', 'react', ['rush', 'notes'], [], paper ?? null)?.value()).toEqual({ rush: true })
  })
})

describe('what a change sends, and how its confirmation says it', () => {
  // Each field ticked is sent, a field left empty as `null`, which clears
  // it in every record (0175) -- never left out, which would change
  // nothing, nor sent as an empty text, which the server keeps as text --
  // and the confirmation says each field and its value: an option by its
  // label, a lookup by the label its record is named by or else its
  // token, a yes or no, and "cleared" (watched failing with an empty
  // answer left out of what is sent: "expected { customer: 'k1:42', …(2)
  // } to deeply equal { customer: 'k1:42', …(3) }").
  test('sends each field ticked, null for one left empty, and says each value', () => {
    const ticked = ['customer', 'status', 'notes', 'rush']
    const answers = changeAnswers(ticked, { customer: 'k1:42', status: 'shipped', notes: '', rush: false })
    expect(answers).toEqual({ customer: 'k1:42', status: 'shipped', notes: null, rush: false })
    expect(changeAnswers(['notes'], {})).toEqual({ notes: null })
    const form = changeForm(ORDERS, ticked, ['placed'])
    expect(chosenLookups(form, answers)).toEqual([{ field: 'customer', source: 'pg-order.customer', token: 'k1:42' }])
    expect(valuesSaid(form, answers, new Map([['customer', 'Muster AG']])).map(text)).toEqual([
      'Customer: Muster AG',
      'Status: Shipped',
      'Notes: cleared',
      'Rush: no',
    ])
    expect(valuesSaid(form, { customer: 'k1:42' }, new Map()).map(text)).toEqual(['Customer: k1:42'])
  })

  // What the change does, before it is sent: each record on its own, of
  // one record its update's own words; where the state field is set, that
  // each record moves from its own state -- the confirmation cannot know
  // which will be refused; and where a field is cleared, what that leaves
  // (watched failing with the state's sentence said whatever was set:
  // "expected [ …(2) ] to deeply equal [ Array(1) ]").
  test('says each record is changed on its own, each moves from its own state, and what clearing leaves', () => {
    expect(lead(ORDERS, { notes: 'x' }, 3)).toEqual([EACH_CHANGED])
    expect(lead(ORDERS, { status: 'shipped', notes: null }, 2)).toEqual([EACH_CHANGED, movesEach('Status', 2), CLEARS])
    expect(lead(ORDERS, { status: 'placed' }, 1)).toEqual([ONE_CHANGED, movesEach('Status', 1)])
    expect(heading('change', target('k1:7', 'k1:8', 'k1:9'), true)).toBe('Change 3 chosen Order records?')
  })
})

describe('the question', () => {
  // One question over the choice at a time: a change asked asks for its
  // fields; asked again over the same records it keeps what was ticked; a
  // deletion asked while a change is out is the change asked again, never
  // a second request that would race it for the open record's hold; and a
  // deletion's confirmation is replaced by a change asked, since a
  // question holds nothing (watched failing with a deletion asked
  // replacing the change out: "expected { state: 'confirming', …(5) } to
  // match object { state: 'sending', kind: 'change' }").
  test('asks for fields, keeps them when asked again, and never replaces a request out', () => {
    const fields = askChange(IDLE, target('k1:1', 'k1:2'), ['draft', 'shipped'])
    expect(fields).toMatchObject({ state: 'asking', kind: 'change', asked: { ticked: [], engine: null, reading: false, froms: ['draft', 'shipped'] } })
    const ticked = asking(fields, { ticked: ['notes'], engine: null, reading: false, froms: ['draft', 'shipped'] })
    expect(askChange(ticked, target('k1:2', 'k1:1'), ['shipped', 'draft'])).toMatchObject({ state: 'asking', asked: { ticked: ['notes'] } })
    const confirming = answered(ticked, { answers: { notes: 'x' }, said: [['Notes: x']], lead: [EACH_CHANGED] }, [])
    const out = send(confirming, [at('k1:1', '4'), at('k1:2')])
    expect(out).toMatchObject({ state: 'sending', kind: 'change', change: { answers: { notes: 'x' } }, target: { records: [at('k1:1', '4'), at('k1:2')] } })
    expect(chosenWork(out)).toBe('changing')
    expect(askDelete(out, target('k1:3'), [])).toMatchObject({ state: 'sending', kind: 'change' })
    expect(askChange(askDelete(IDLE, target('k1:1'), []), target('k1:1'), [])).toMatchObject({ state: 'asking', kind: 'change' })
    expect(close(ticked)).toBe(IDLE)
  })
})

describe('what the server answered a change', () => {
  const updated = (record: string): ChangedRecordOutcome => ({ ok: true, value: { record, version: '2', answers: {} } })
  const refused = (status: number, code: string, message: string): ChangedRecordOutcome => ({ ok: false, status, code, message })
  const STALE = 'The record changed since it was read. Reload it, review the changes, and save again.'
  const MOVE = 'status may not move from where it is to where this update puts it, for your roles.'
  const lostOne = (record: string): ChangedRecordOutcome => ({
    ok: false,
    status: 502,
    code: 'unknown-outcome',
    message: 'The connection to the database closed before the answer arrived.',
    operation: 'update',
    record,
    version: '1',
    origin: 'database',
  })
  const notSentOne = (record: string): ChangedRecordOutcome => ({ ok: false, status: 0, code: 'not-sent', message: 'not sent', record, version: '1' })
  const out = (records: readonly string[]): ChosenRequest =>
    send(
      answered(askChange(IDLE, target(...records), []), { answers: { status: 'shipped' }, said: [], lead: [] }, []),
      records.map((record) => at(record)),
    )
  const shown = (now: ChosenRequest): ChosenRequest & { state: 'answered' } => {
    if (now.state !== 'answered') throw new Error(`the change is ${now.state}, not answered`)
    return now
  }

  // Each record as an update of it alone is read (0175): changed; changed
  // since and a move refused from its own state, in the server's words;
  // declined, with whose words those are (0156); not found, never called
  // changed; one whose answer was lost, which may have been; and those
  // the request stopped before. Said in a change's words, by the rule a
  // deletion's are: the count, each record named, "Not changed." on each
  // box kept chosen, those not sent together; the records changed and the
  // one not found leave the choice; the guard counts the one not known and
  // a check reads it as an update (watched failing with the outcome said
  // in a deletion's words: "expected 'Deleted 1 of 7 records.' to be
  // 'Changed 1 of 7 records.'").
  test('is each record’s fate in the order sent, said in a change’s words', () => {
    const value: ChangedRecordOutcome[] = [
      updated('k1:1'),
      refused(409, 'stale', STALE),
      refused(403, 'transition-denied', MOVE),
      refused(404, 'not-found', 'No such record.'),
      refused(422, 'declined', 'Shipped orders are kept.'),
      lostOne('k1:6'),
      notSentOne('k1:7'),
    ]
    const records = ['k1:1', 'k1:2', 'k1:3', 'k1:4', 'k1:5', 'k1:6', 'k1:7']
    const now = shown(answer(out(records), { ok: true, value }))
    expect(summary(now)).toBe('Changed 1 of 7 records.')
    expect(lines(now).map(({ said }) => text(said))).toEqual([
      `Order k1:2: ${STALE}`,
      `Order k1:3: ${MOVE}`,
      `Order k1:4: ${NOT_FOUND}`,
      `Order k1:5: Shipped orders are kept. ${DECLINED_BY}`,
      `Order k1:6: The connection to the database closed before the answer arrived. ${CHANGE_WORDS.mayHave}`,
    ])
    expect(text(notSent(now) ?? [])).toBe('Not sent, so not changed: Order k1:7.')
    expect([...leftOf(now)]).toEqual(['k1:1', 'k1:4'])
    expect(Object.fromEntries(marksOf(now))).toEqual({
      'k1:2': `Not changed. ${STALE}`,
      'k1:3': `Not changed. ${MOVE}`,
      'k1:5': `Not changed. Shipped orders are kept. ${DECLINED_BY}`,
      'k1:6': `The connection to the database closed before the answer arrived. ${CHANGE_WORDS.mayHave}`,
      'k1:7': CHANGE_WORDS.notSentOne,
    })
    expect(chosenWork(now)).toBe('change-unknown')
    expect(toCheck(now)).toMatchObject({ operation: 'update-chosen', records: [at('k1:6')] })
    expect(settledText(now, ['k1:2', 'k1:3'], (token) => `Order ${token}`)).toBe('2 chosen. Still chosen after the change: Order k1:2 and Order k1:3.')
  })

  // A request refused whole -- a value no codec takes, a lookup outside
  // its filter (0175) -- is nothing changed, in the server's words, said
  // as a change's refusal (watched failing with it kept as a deletion's:
  // "expected { state: 'refused', …(5) } to match object { state:
  // 'refused', …(2) }").
  test('refused whole is the server’s sentence, nothing changed', () => {
    const outcome: UpdateChosenOutcome = { ok: false, status: 422, code: 'not-an-option', message: 'Customer is not one of its options.' }
    const now = answer(out(['k1:1']), outcome)
    expect(now).toMatchObject({ state: 'refused', kind: 'change', message: 'Customer is not one of its options.' })
    expect([chosenWork(now), [...leftOf(now)]]).toEqual([null, []])
  })

  // A request whose answer was lost, checked record by record as an
  // update's loss is (0031, 0175): at the version sent, not changed, and
  // kept chosen; moved on, changed -- by this change or somebody else's,
  // which the page cannot tell apart and says -- and gone from the choice;
  // its record gone, not found, as a single update's check answers it,
  // since a change deletes nothing; a read refused, still unknown. Every
  // one at the version sent is none changed (watched failing with a
  // check's 404 read as a deletion's "gone": "expected '2 of 4 records
  // have changed since thi…' to be '1 of 4 records has changed since
  // this…'").
  test('a lost answer is checked as an update’s, and only what is still unknown is read again', () => {
    const LOST = {
      ok: false,
      status: 0,
      code: 'unknown-outcome',
      message: 'The answer to this change of chosen records was lost between this page and the data server. Any of them may have been changed.',
      operation: 'update-chosen',
      records: [at('k1:1'), at('k1:2'), at('k1:3'), at('k1:4')],
      origin: 'transport',
    } as const
    const stored = { record: 'k1:1', version: '1', answers: {}, labels: {} } as never
    const read = (record: string, reconciliation: Reconciliation) => ({ record, reconciliation })
    const lost = shown(answer(out(['k1:1', 'k1:2', 'k1:3', 'k1:4']), { ...LOST, records: [...LOST.records] }))
    expect([summary(lost), chosenWork(lost)]).toEqual([LOST.message, 'change-unknown'])
    const found = shown(
      checked(checking(lost), [
        read('k1:1', { ok: true, state: 'unchanged', current: stored }),
        read('k1:2', { ok: true, state: 'changed', current: stored }),
        read('k1:3', { ok: false, status: 404, code: 'not-found', message: 'No such record.' }),
        read('k1:4', { ok: false, status: 503, code: 'unavailable', message: 'The database is not answering.' }),
      ]),
    )
    expect(summary(found)).toBe('1 of 4 records has changed since this page read it: this change, or somebody else’s, changed it.')
    expect(lines(found).map(({ said }) => text(said))).toEqual([
      'Order k1:1: It is still at the version you saw.',
      `Order k1:3: ${NOT_FOUND}`,
      'Order k1:4: The database is not answering. Whether it was changed is still unknown.',
    ])
    expect([...leftOf(found)]).toEqual(['k1:2', 'k1:3'])
    expect(marksOf(found).get('k1:1')).toBe('Not changed. It is still at the version you saw.')
    expect(toCheck(found)?.records).toEqual([at('k1:4')])
    const none = shown(
      checked(checking(shown(answer(out(['k1:1']), { ...LOST, records: [at('k1:1')] }))), [read('k1:1', { ok: true, state: 'unchanged', current: stored })]),
    )
    expect([summary(none), chosenWork(none)]).toEqual([NONE_CHANGED, null])
    expect(MOVED).toBe(CHANGE_WORDS.found)
  })

  // A record a check reads 404 has a fate the page knows -- not found, its
  // own line says so, the guard no longer counts it -- so the first
  // sentence counts it rather than calling it still unknown, and a check
  // that finds every record so never repeats the client's "Any of them may
  // have been changed." (watched failing with not found counted as
  // neither: the first sentence "1 of 2 records is still at the version
  // this page read, not changed; whether the other was changed is still
  // unknown.").
  test('a check that cannot find a record counts it as known', () => {
    const stored = { record: 'k1:1', version: '1', answers: {}, labels: {} } as never
    const kept = (record: string) => ({ record, reconciliation: { ok: true, state: 'unchanged', current: stored } as const })
    const gone = (record: string) => ({ record, reconciliation: { ok: false, status: 404, code: 'not-found', message: 'No such record.' } as const })
    const unread = (record: string) => ({
      record,
      reconciliation: { ok: false, status: 503, code: 'unavailable', message: 'The database is not answering.' } as const,
    })
    const lost = (records: readonly string[]) =>
      checking(
        answer(out(records), {
          ok: false,
          status: 0,
          code: 'unknown-outcome',
          message: 'The answer to this change of chosen records was lost between this page and the data server. Any of them may have been changed.',
          operation: 'update-chosen',
          records: records.map((record) => at(record)),
          origin: 'transport',
        }),
      )
    const some = shown(checked(lost(['k1:1', 'k1:2']), [kept('k1:1'), gone('k1:2')]))
    expect([summary(some), chosenWork(some), frameOf(some)]).toEqual([
      '1 of 2 records is still at the version this page read, not changed; 1 cannot be found any more.',
      null,
      'refused',
    ])
    const every = shown(checked(lost(['k1:1', 'k1:2']), [gone('k1:1'), gone('k1:2')]))
    expect([summary(every), lines(every).map(({ said }) => text(said))]).toEqual([
      '2 of 2 records cannot be found any more.',
      [`Order k1:1: ${NOT_FOUND}`, `Order k1:2: ${NOT_FOUND}`],
    ])
    const three = shown(checked(lost(['k1:1', 'k1:2', 'k1:3']), [kept('k1:1'), gone('k1:2'), unread('k1:3')]))
    expect(summary(three)).toBe(
      '1 of 3 records is still at the version this page read, not changed; 1 cannot be found any more; whether the other was changed is still unknown.',
    )
    const unreadOnly = shown(checked(lost(['k1:1', 'k1:2']), [gone('k1:1'), unread('k1:2')]))
    expect(summary(unreadOnly)).toBe('1 of 2 records cannot be found any more; whether the other was changed is still unknown.')
  })

  // The open record a change changed, or a check found moved on, whose
  // read again is refused keeps its forms at the version from before:
  // the region says so, naming it, in the server's words, and takes the
  // keyboard to say it, the count's teal left as the answer said it -- as
  // a run's region says it (0162); a request not answered is left as it
  // is (watched failing with the refusal only lifting the hold: "expected
  // [ null, 3, 3 ] to deeply equal [ { record: 'k1:1', …(1) }, 4, 3 ]").
  test('says the open record it changed could not be read again', () => {
    const done = shown(answer(out(['k1:1', 'k1:2']), { ok: true, value: [updated('k1:1'), updated('k1:2')] }))
    expect(done.unread).toBeNull()
    const refused = shown(readRefused(done, 'k1:1', 'The data server could not be reached.'))
    expect([refused.unread, refused.n, refused.said]).toEqual([{ record: 'k1:1', message: 'The data server could not be reached.' }, done.n + 1, done.said])
    expect(text(readRefusedText('Order', { record: 'k1:1', message: 'The data server could not be reached.' }))).toBe(
      `Order k1:1 ${READ_AGAIN_REFUSED} The data server could not be reached.`,
    )
    expect(readRefused(IDLE, 'k1:1', 'x')).toBe(IDLE)
  })

  // The open record is read again once for each finding that it changed:
  // by the answer that changed it, or by the check that found it moved on
  // where the answer was lost -- never again by a later check of another
  // record, which would ask the guard about forms the person has gone on
  // typing into since (watched failing with a check finding again every
  // record found so far: "expected [ true, true ] to deeply equal [ false,
  // true ]").
  test('finds a record changed once, by the answer or by the check that found it', () => {
    const stored = { record: 'k1:1', version: '2', answers: {}, labels: {} } as never
    const sending = out(['k1:1', 'k1:2'])
    const done = answer(sending, { ok: true, value: [updated('k1:1'), lostOne('k1:2')] })
    expect([foundNow(sending, done, 'k1:1'), foundNow(sending, done, 'k1:2')]).toEqual([true, false])
    const lost = answer(out(['k1:1', 'k1:2']), {
      ok: false,
      status: 0,
      code: 'unknown-outcome',
      message: 'lost',
      operation: 'update-chosen',
      records: [at('k1:1'), at('k1:2')],
      origin: 'transport',
    })
    const first = checking(lost)
    const once = checked(first, [
      { record: 'k1:1', reconciliation: { ok: true, state: 'changed', current: stored } },
      { record: 'k1:2', reconciliation: { ok: false, status: 503, code: 'unavailable', message: 'The database is not answering.' } },
    ])
    expect([foundNow(first, once, 'k1:1'), foundNow(first, once, 'k1:2')]).toEqual([true, false])
    const second = checking(once)
    const twice = checked(second, [{ record: 'k1:2', reconciliation: { ok: true, state: 'changed', current: stored } }])
    expect([foundNow(second, twice, 'k1:1'), foundNow(second, twice, 'k1:2')]).toEqual([false, true])
  })
})
