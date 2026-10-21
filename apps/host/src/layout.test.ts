import { describe, expect, test } from 'vitest'
import { arrival, fragmentOf, LAYOUTS, readFragment } from './layout.js'

/*
 * The workspace's address (0047): a fragment that says which form is open,
 * in which layout and view, and never which record -- a record token spells
 * its key, and a URL, fragment included, goes into the browser's history,
 * which a browser may sync. Pure; workspace.test.tsx holds the page to it.
 */

describe('the fragment', () => {
  // Written from the page's state, and nothing else: there is no argument a
  // record could arrive through, and the keys are exactly these three.
  test('holds the form, the layout and the view, and no record', () => {
    expect(fragmentOf({ form: 'pg-order', layout: 'separate', view: 'record' })).toBe('#form=pg-order&layout=separate&view=record')
    expect(fragmentOf({ form: null, layout: 'stacked', view: 'records' })).toBe('#layout=stacked&view=records')
    for (const layout of LAYOUTS) {
      const keys = [...new URLSearchParams(fragmentOf({ form: 'pg-order', layout, view: 'records' }).slice(1)).keys()]
      expect(keys).toEqual(['form', 'layout', 'view'])
    }
  })

  // A form id is one of the menu's, but the fragment is typed by anybody:
  // read back, it is the same id however it was spelled in the address.
  test('reads back what it wrote, and an id with characters a URL escapes', () => {
    expect(readFragment(fragmentOf({ form: 'pg.order_2', layout: 'stacked', view: 'record' }))).toEqual({ form: 'pg.order_2', layout: 'stacked', view: 'record', level: null })
    expect(readFragment('#form=pg%2Dorder&layout=side-by-side&view=records')).toEqual({ form: 'pg-order', layout: 'side-by-side', view: 'records', level: null })
  })

  // What the page cannot read asks for nothing: an unknown key is left out
  // -- a record token pasted into an address included -- a value it does not
  // know is no value, and a key said twice is read once, as first said. A
  // reader that took the last spelling, or a layout it does not draw, would
  // let anybody who writes a link choose for it (watched failing with every
  // value taken as written).
  test.each([
    ['an unknown key', '#form=pg-order&record=k1:1', { form: 'pg-order', layout: null, view: null, level: null }],
    ['an unknown layout', '#layout=sideways', { form: null, layout: null, view: null, level: null }],
    ['an unknown view', '#view=grid', { form: null, layout: null, view: null, level: null }],
    ['a key twice', '#form=a&form=b', { form: 'a', layout: null, view: null, level: null }],
  ])('reads nothing of %s', (_, hash, asked) => {
    expect(readFragment(hash)).toEqual(asked)
  })

  // A page opened with no fragment, or a bare `#`, asks for nothing, so the
  // layout is the window's (UX-SPEC D14): a reader that filled in a default
  // here would put a phone in Side by side.
  test('an empty fragment is read as nothing asked for', () => {
    expect(readFragment('')).toEqual({ form: null, layout: null, view: null, level: null })
    expect(readFragment('#')).toEqual({ form: null, layout: null, view: null, level: null })
  })
})

describe('the level Drill down shows', () => {
  // A level is a number, never a record: the fragment says how deep, and the
  // levels themselves are in memory only (0090). Written only where it means
  // something -- Drill down's record view -- so no other layout's address
  // gains a key a reader would have to explain away (watched failing: no
  // drill layout, no level key).
  test('is written only in Drill down, in the record view', () => {
    expect(LAYOUTS).toContain('drill')
    expect(fragmentOf({ form: 'pg-order', layout: 'drill', view: 'record', level: 3 })).toBe('#form=pg-order&layout=drill&view=record&level=3')
    expect(fragmentOf({ form: 'pg-order', layout: 'drill', view: 'record' })).toBe('#form=pg-order&layout=drill&view=record&level=1')
    expect(fragmentOf({ form: 'pg-order', layout: 'drill', view: 'records', level: 3 })).toBe('#form=pg-order&layout=drill&view=records')
    expect(fragmentOf({ form: 'pg-order', layout: 'separate', view: 'record', level: 3 })).toBe('#form=pg-order&layout=separate&view=record')
  })

  // Read as a whole number from one up, as first said: anything else asks
  // for no level, so a typed `level=0` or `level=2x` cannot point the page
  // at a level it would have to invent.
  test('reads a whole number from one, and nothing else', () => {
    expect(readFragment('#layout=drill&view=record&level=2&level=5')).toEqual({ form: null, layout: 'drill', view: 'record', level: 2 })
    for (const level of ['0', '-1', '2x', '', '1.5', '01'])
      expect(readFragment(`#layout=drill&view=record&level=${level}`).level).toBeNull()
  })

  // The levels are in memory only: a reload, a shared link or a typed
  // address with a level arrives on the records, as every other layout does.
  test('is never where a person arrives', () => {
    expect(arrival({ hash: '#form=pg-order&layout=drill&view=record&level=3', menu: ['pg-order'], phone: false })).toEqual({ form: 'pg-order', layout: 'drill', view: 'records' })
  })
})

describe('arriving with an address', () => {
  const menu = ['pg-customer', 'pg-order']

  // A fragment's form is opened only when the menu names it: a form outside
  // the menu is never asked for, and the address is then the page's own.
  test('opens the form the fragment names only when the menu names it', () => {
    expect(arrival({ hash: '#form=pg-order&layout=stacked&view=records', menu, phone: false })).toEqual({ form: 'pg-order', layout: 'stacked', view: 'records' })
    expect(arrival({ hash: '#form=ms-secret&layout=stacked&view=records', menu, phone: false })).toEqual({ form: null, layout: 'stacked', view: 'records' })
  })

  // No record is open on arrival, so a record view has nothing to show and
  // the records view is what the page writes back.
  test('starts in the records view, whatever the fragment says', () => {
    expect(arrival({ hash: '#form=pg-order&layout=separate&view=record', menu, phone: false })).toEqual({ form: 'pg-order', layout: 'separate', view: 'records' })
  })

  // The layout the fragment names wins; otherwise a phone starts in Separate
  // views (UX-SPEC D14) and every other window side by side.
  test('takes the layout from the fragment, else from the window', () => {
    expect(arrival({ hash: '', menu, phone: true })).toEqual({ form: null, layout: 'separate', view: 'records' })
    expect(arrival({ hash: '', menu, phone: false }).layout).toBe('side-by-side')
    expect(arrival({ hash: '#layout=stacked', menu, phone: true }).layout).toBe('stacked')
  })
})
