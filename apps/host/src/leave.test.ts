import { describe, expect, test } from 'vitest'
import { atRisk, discards, gridOwner, lead, WORK } from './leave.js'
import type { LeaveRequest, PaneWork } from './leave.js'

/*
 * The one guard over every way of leaving a form (0047), as a table: what
 * each request a person can make in the workspace would discard, and which
 * panes are then at risk. Pure: the suites in workspace.test.tsx and
 * children.test.tsx drive the same table through the page.
 */

/** Every pane a workspace can hold at once: the record's two, and two children's two each. */
const PANES: PaneWork[] = [
  { owner: 'master', renderer: 'react', name: ['Order ', { code: 'k1:1' }], work: 'changed' },
  { owner: 'master', renderer: 'angular', name: ['Order ', { code: 'k1:1' }], work: null },
  { owner: 'lines', renderer: 'react', name: ['Order line ', { code: 'k1:1,1' }], work: 'saving' },
  { owner: 'lines', renderer: 'angular', name: ['Order line ', { code: 'k1:1,1' }], work: 'unknown' },
  { owner: 'staff', renderer: 'react', name: ['New Order'], work: 'changed' },
  { owner: 'staff', renderer: 'angular', name: ['New Order'], work: null },
]

const owners = (request: LeaveRequest): string[] => atRisk(request, PANES).map((pane) => `${pane.owner} ${pane.renderer}`)

describe('what each way of leaving a form discards', () => {
  // The table of 0047: a request that drops the record drops every child
  // section under it, because the children are that record's. A guard that
  // asked only about the record's own panes would let "Open another order"
  // throw away a line someone was typing.
  test.each<LeaveRequest>([
    { kind: 'row', record: 'k1:2' },
    { kind: 'new' },
    { kind: 'load', record: 'k1:3' },
    { kind: 'form', title: 'Customer' },
    { kind: 'history', direction: 'back' },
    { kind: 'history', direction: 'forward' },
    { kind: 'sign-out' },
  ])('$kind drops the record and every child section', (request) => {
    expect(discards(request)).toMatchObject({ owners: 'all', renderers: 'all' })
    expect(owners(request)).toEqual(['master react', 'lines react', 'lines angular', 'staff react'])
  })

  // A child's own row or its New replaces that child's panes and nothing
  // else: asking about the record or about another child would stop a person
  // for work the request leaves alone.
  test('a child row or a new child row drops that child section alone', () => {
    expect(owners({ kind: 'child-row', owner: 'lines', record: 'k1:1,2' })).toEqual(['lines react', 'lines angular'])
    expect(owners({ kind: 'child-new', owner: 'staff', title: 'Order' })).toEqual(['staff react'])
  })

  // A record created in one pane is the detail's from then on: the record's
  // other panes are opened on it and the children are its, so their work is
  // asked about -- and the pane that created it keeps what it holds, newer
  // typing included, so it is never on the list (watched failing with the
  // creating pane listed, which Discard would then have emptied).
  test('a record created in a pane drops the others: the record and its children, or that child', () => {
    expect(owners({ kind: 'created', owner: 'master', record: 'k1:5', by: 'react' })).toEqual(['lines react', 'lines angular', 'staff react'])
    expect(owners({ kind: 'created', owner: 'master', record: 'k1:5', by: 'angular' })).toEqual(['master react', 'lines react', 'lines angular', 'staff react'])
    expect(owners({ kind: 'created', owner: 'lines', record: 'k1:1,3', by: 'react' })).toEqual(['lines angular'])
  })

  // The renderer switch hides a renderer's forms everywhere on the page,
  // and a hidden form is not mounted: its work goes with it, so it is asked
  // about, in the record and in every child, and the shown renderer's is not.
  test('hiding a renderer drops its forms, in the record and in every child', () => {
    expect(owners({ kind: 'renderer', hides: ['react'], shows: 'Angular' })).toEqual(['master react', 'lines react', 'staff react'])
    expect(owners({ kind: 'renderer', hides: ['angular'], shows: 'React' })).toEqual(['lines angular'])
    expect(owners({ kind: 'renderer', hides: [], shows: 'Both' })).toEqual([])
  })

  // A deletion out, or one that may have been done, is the record's or the
  // child row's work too (0053), drawn by no renderer: what drops its owner
  // asks about it, and hiding a renderer, which drops no record, does not
  // (watched failing with a deletion dropped by every renderer request:
  // hiding React asked about an order's unanswered delete).
  test("a deletion is its owner's work, and no renderer's", () => {
    const deletions: PaneWork[] = [...PANES, { owner: 'master', renderer: null, name: ['Order ', { code: 'k1:1' }], work: 'deleting' }, { owner: 'lines', renderer: null, name: ['Order line ', { code: 'k1:1,1' }], work: 'delete-unknown' }]
    const of = (request: LeaveRequest): string[] => atRisk(request, deletions).map((pane) => `${pane.owner} ${String(pane.renderer)}`)
    expect(of({ kind: 'row', record: 'k1:2' })).toEqual(['master react', 'lines react', 'lines angular', 'staff react', 'master null', 'lines null'])
    expect(of({ kind: 'child-row', owner: 'lines', record: 'k1:1,2' })).toEqual(['lines react', 'lines angular', 'lines null'])
    expect(of({ kind: 'renderer', hides: ['react'], shows: 'Angular' })).toEqual(['master react', 'lines react', 'staff react'])
    expect(of({ kind: 'created', owner: 'lines', record: 'k1:1,3', by: 'react' })).toEqual(['lines angular', 'lines null'])
  })

  // A deletion asked from a grid's row that is not open in the detail is
  // that grid's (0053): what replaces the detail -- another row, New, Load,
  // a record created in a pane -- leaves the records grid where it is, so it
  // asks nothing about its deletion, and only what takes the grid away does:
  // another form, Back or Forward, Sign out. A child's grid goes with its
  // section, so the record's requests ask about it, and its own section's
  // rows do not (watched failing with the row's deletion its detail's work:
  // a record created in New asked about it, and Discard dropped what its
  // answer would have said).
  test("a deletion from a row not open is its grid's, asked about only by what takes the grid away", () => {
    const grids: PaneWork[] = [
      { owner: gridOwner('master'), renderer: null, name: ['Order ', { code: 'k1:8' }], work: 'deleting' },
      { owner: gridOwner('lines'), renderer: null, name: ['Order line ', { code: 'k1:1,3' }], work: 'delete-unknown' },
    ]
    const of = (request: LeaveRequest): string[] => atRisk(request, grids).map((pane) => pane.owner)
    const keeps: LeaveRequest[] = [{ kind: 'row', record: 'k1:2' }, { kind: 'new' }, { kind: 'load', record: 'k1:3' }, { kind: 'created', owner: 'master', record: 'k1:5', by: 'react' }]
    for (const request of keeps) expect({ request: request.kind, asks: of(request) }).toEqual({ request: request.kind, asks: [gridOwner('lines')] })
    const takes: LeaveRequest[] = [{ kind: 'form', title: 'Customer' }, { kind: 'history', direction: 'back' }, { kind: 'sign-out' }]
    for (const request of takes) expect({ request: request.kind, asks: of(request) }).toEqual({ request: request.kind, asks: [gridOwner('master'), gridOwner('lines')] })
    const leaves: LeaveRequest[] = [{ kind: 'child-row', owner: 'lines', record: 'k1:1,2' }, { kind: 'child-new', owner: 'lines', title: 'Order line' }, { kind: 'created', owner: 'lines', record: 'k1:1,4', by: 'angular' }, { kind: 'renderer', hides: ['react', 'angular'], shows: 'Both' }]
    for (const request of leaves) expect({ request: request.kind, asks: of(request) }).toEqual({ request: request.kind, asks: [] })
  })

  // Everything stays mounted across a layout or view change, a page, a
  // search and a sort, so none of them can lose a draft and none asks.
  test.each<LeaveRequest>([{ kind: 'layout' }, { kind: 'view' }, { kind: 'page' }, { kind: 'search' }, { kind: 'sort' }])('$kind discards nothing', (request) => {
    expect(discards(request)).toBeNull()
    expect(owners(request)).toEqual([])
  })
})

describe('what the notice says', () => {
  // The lead names what was asked for, so the person can tell which press
  // they are being asked about: "closes these forms" alone would not say.
  test('names the target of each request', () => {
    const text = (request: LeaveRequest) => lead(request).map((part) => (typeof part === 'string' ? part : `\`${part.code}\``)).join('')
    expect(text({ kind: 'row', record: 'k1:1004' })).toBe('Opening `k1:1004` closes these forms:')
    expect(text({ kind: 'new' })).toBe('Starting a new record closes these forms:')
    expect(text({ kind: 'load', record: 'k1:1999' })).toBe('Loading `k1:1999` closes these forms:')
    expect(text({ kind: 'form', title: 'Customer' })).toBe('Opening Customer closes these forms:')
    expect(text({ kind: 'history', direction: 'back' })).toBe('Going back closes these forms:')
    expect(text({ kind: 'history', direction: 'forward' })).toBe('Going forward closes these forms:')
    expect(text({ kind: 'sign-out' })).toBe('Signing out closes these forms:')
    expect(text({ kind: 'child-row', owner: 'lines', record: 'k1:1003,4' })).toBe('Opening `k1:1003,4` closes these forms:')
    expect(text({ kind: 'child-new', owner: 'lines', title: 'Order line' })).toBe('Starting a new Order line closes these forms:')
    expect(text({ kind: 'renderer', hides: ['react'], shows: 'Angular' })).toBe('Showing Angular closes these forms:')
    expect(text({ kind: 'created', owner: 'master', record: 'k1:7', by: 'angular' })).toBe('Opening `k1:7`, just created in Angular, closes these forms:')
  })

  // Each kind of unsaved work in its own words: a save the server has not
  // answered and one that may have been stored are not "changes", and
  // discarding them is not the same loss.
  test('says each kind of work in its own sentence', () => {
    expect(WORK).toEqual({
      changed: 'changes that are not saved.',
      saving: 'a save the server has not answered yet.',
      unknown: 'a save that may have been stored, not yet checked.',
      deleting: 'a deletion the server has not answered yet.',
      'delete-unknown': 'a deletion that may have been done, not yet checked.',
    })
  })
})
