import { describe, expect, test } from 'vitest'
import {
  axisOf,
  gridKey,
  PREFERENCES,
  readLayout,
  readPreference,
  readRenderer,
  readShare,
  removePreference,
  shareLimits,
  SPLITS,
  stepShare,
  writeLayout,
  writePreference,
  writeRenderer,
  writeShare,
} from './prefs.js'

/*
 * What one viewer's browser keeps of the workspace (0047): which renderer
 * the record is drawn with, and where the split between the records and the
 * record sits -- the person's two decisions of 2026-10-10 -- the layout
 * they chose last and where Stacked's line sits (0145), and under one key
 * per form and kind of section, a grid's columns and list (0106,
 * columns.test.ts). Nothing else is kept, and the page works when the
 * browser keeps nothing: storage can be refused, full or throw.
 */

/** A Storage that holds what it is given, for one test. */
function memory(): Storage {
  const held = new Map<string, string>()
  return {
    get length() {
      return held.size
    },
    clear: () => held.clear(),
    getItem: (key) => held.get(key) ?? null,
    key: (index) => [...held.keys()][index] ?? null,
    removeItem: (key) => void held.delete(key),
    setItem: (key, value) => void held.set(key, value),
  }
}

/** A Storage whose every call throws, as a browser with site data blocked does. */
const refusing: Storage = new Proxy({} as Storage, {
  get: () => () => {
    throw new DOMException('The operation is insecure.', 'SecurityError')
  },
})

describe('the renderer choice', () => {
  // React is the default, decided by the person: the page opens with one
  // form drawn, not two.
  test('is React until the viewer chooses, and what they chose after', () => {
    const storage = memory()
    expect(readRenderer(storage)).toBe('react')
    writeRenderer(storage, 'both')
    expect(readRenderer(storage)).toBe('both')
    writeRenderer(storage, 'angular')
    expect(readRenderer(memory())).toBe('react')
    expect(readRenderer(storage)).toBe('angular')
  })

  // A value the page did not write -- another version's, or a hand edit --
  // is not trusted to name a renderer.
  test('ignores a value it does not know', () => {
    const storage = memory()
    storage.setItem(PREFERENCES.renderer, 'vue')
    expect(readRenderer(storage)).toBe('react')
  })
})

describe('the split', () => {
  // The person's default until they move it, then theirs: a split read back
  // as anything else -- the default after a move, or a word kept by hand --
  // would put the separator where nobody left it.
  test('is 55 to 45 until the viewer moves it, and where they left it after', () => {
    const storage = memory()
    expect(readShare(storage, 'width')).toBe(SPLITS.width.initial)
    expect(SPLITS.width.initial).toBe(55)
    writeShare(storage, 'width', 62)
    expect(readShare(storage, 'width')).toBe(62)
    storage.setItem(PREFERENCES.split, 'wide')
    expect(readShare(storage, 'width')).toBe(SPLITS.width.initial)
  })

  // Neither side narrower than what it holds needs: the limits come from the
  // width the two lanes share. With no width -- a hidden lane, or jsdom --
  // they are the outer bounds.
  test('keeps each side at least as wide as its content needs', () => {
    expect(shareLimits('width', 1200, 16)).toEqual({ min: 27, max: 68 })
    expect(shareLimits('width', 900, 16)).toEqual({ min: 36, max: 57 })
    expect(shareLimits('width', 0, 16)).toEqual({ min: SPLITS.width.outer.min, max: SPLITS.width.outer.max })
    // Narrower than both minimums together: the default, pinned.
    expect(shareLimits('width', 500, 16)).toEqual({ min: SPLITS.width.initial, max: SPLITS.width.initial })
  })

  // The separator's keys, as the ARIA pattern for a window splitter has
  // them: arrows step, Home and End go to the limits, and nothing passes them.
  test('moves by its keys and stops at its limits', () => {
    const limits = { min: 30, max: 70 }
    expect(stepShare('width', 55, 'ArrowLeft', limits)).toBe(50)
    expect(stepShare('width', 55, 'ArrowRight', limits)).toBe(60)
    expect(stepShare('width', 55, 'Home', limits)).toBe(30)
    expect(stepShare('width', 55, 'End', limits)).toBe(70)
    expect(stepShare('width', 32, 'ArrowLeft', limits)).toBe(30)
    expect(stepShare('width', 68, 'ArrowRight', limits)).toBe(70)
    expect(stepShare('width', 55, 'Tab', limits)).toBeNull()
  })
})

describe("Stacked's line", () => {
  // Its own share, under its own key: Side by side's split moved is not
  // where Stacked's line sits, nor the other way round (watched failing with
  // both read from the split's key: the line came back at Side by side's 62).
  test('is 60 to 40 until the viewer moves it, and kept apart from the split', () => {
    const storage = memory()
    expect(readShare(storage, 'height')).toBe(60)
    writeShare(storage, 'width', 62)
    expect(readShare(storage, 'height')).toBe(60)
    writeShare(storage, 'height', 45)
    expect(readShare(storage, 'height')).toBe(45)
    expect(readShare(storage, 'width')).toBe(62)
    expect(storage.getItem(PREFERENCES.stack)).toBe('45')
    storage.setItem(PREFERENCES.stack, '90')
    expect(readShare(storage, 'height')).toBe(60)
  })

  // A share of the window's height, so neither the records nor the record
  // collapses: the records at least 18rem -- their heading, the search and
  // the grid's header with a row -- and the record at least 12rem, the app
  // bar and the form's header above the lanes with the record's heading
  // below the line. With no height to go by -- jsdom -- the outer bounds;
  // shorter than both together, the default, pinned (watched failing with
  // the limits read from the width's minimums: a 900-pixel window gave 36
  // to 57).
  test('keeps the records and the record each at least as tall as they need', () => {
    expect(shareLimits('height', 900, 16)).toEqual({ min: 32, max: 75 })
    expect(shareLimits('height', 600, 16)).toEqual({ min: 48, max: 68 })
    expect(shareLimits('height', 480, 16)).toEqual({ min: 60, max: 60 })
    expect(shareLimits('height', 0, 16)).toEqual({ min: 25, max: 75 })
    expect(shareLimits('height', 400, 16)).toEqual({ min: 60, max: 60 })
  })

  // A horizontal line, as the window splitter pattern has it: Up and Down
  // step it, Home and End go to its limits, and Left and Right are not its
  // keys -- they move a vertical one (watched failing with Side by side's
  // keys for both: ArrowLeft moved the line up).
  test('moves by Up and Down, Home and End, and not by Left and Right', () => {
    const limits = { min: 30, max: 70 }
    expect(stepShare('height', 55, 'ArrowUp', limits)).toBe(50)
    expect(stepShare('height', 55, 'ArrowDown', limits)).toBe(60)
    expect(stepShare('height', 55, 'Home', limits)).toBe(30)
    expect(stepShare('height', 55, 'End', limits)).toBe(70)
    expect(stepShare('height', 68, 'ArrowDown', limits)).toBe(70)
    expect(stepShare('height', 55, 'ArrowLeft', limits)).toBeNull()
    expect(stepShare('height', 55, 'ArrowRight', limits)).toBeNull()
  })

  // A line where two parts share the room, and none where one view is
  // shown at a time (watched failing with a line for every layout).
  test('is drawn in Stacked, as the split is in Side by side, and in neither other layout', () => {
    expect(axisOf('side-by-side')).toBe('width')
    expect(axisOf('stacked')).toBe('height')
    expect(axisOf('separate')).toBeNull()
    expect(axisOf('drill')).toBeNull()
  })
})

describe('the layout', () => {
  // Nothing kept until the viewer chooses, then what they chose last: a
  // layout read back where none was chosen would take arrival away from the
  // window (watched failing with the default written in place of nothing).
  test('is nothing until the viewer chooses one, and the one they chose last after', () => {
    const storage = memory()
    expect(readLayout(storage)).toBeNull()
    writeLayout(storage, 'drill')
    expect(readLayout(storage)).toBe('drill')
    writeLayout(storage, 'separate')
    expect(readLayout(storage)).toBe('separate')
  })

  // A value the page did not write is not trusted to name a layout, as the
  // fragment's is not (watched failing with the value taken as written).
  test('ignores a value it does not know', () => {
    const storage = memory()
    storage.setItem(PREFERENCES.layout, 'sideways')
    expect(readLayout(storage)).toBeNull()
  })
})

describe("a grid's key", () => {
  // One value per form in its Records panel, and per form and parent field
  // in a child section, under the prefix a test can name: the Records
  // panel's grid and a child section's are two grids -- the child's leaves
  // out its parent's field -- and an employee's orders created and
  // approved, both on screen, are two child sections, each keeping its own
  // (watched failing with one key per form and kind: the second section's
  // change wrote over the first's view). The kind goes first, so no form id
  // spells another form's key.
  test('is one per form and section, a child section by its field, under the grid prefix', () => {
    const keys = [
      gridKey({ kind: 'records' }, 'pg-order'),
      gridKey({ kind: 'child', field: 'created_by' }, 'pg-order'),
      gridKey({ kind: 'child', field: 'approved_by' }, 'pg-order'),
      gridKey({ kind: 'records' }, 'pg-delivery'),
    ]
    expect(new Set(keys).size).toBe(4)
    for (const key of keys) expect(key.startsWith(PREFERENCES.grid)).toBe(true)
    expect(keys.slice(0, 2)).toEqual(['formancy-data-host.grid.records.pg-order', 'formancy-data-host.grid.child.pg-order/created_by'])
  })

  // Reset columns with no list kept leaves nothing to keep, and the key
  // goes rather than a value saying nothing (watched failing with a remove
  // that did nothing: the value read back).
  test('is removed when nothing is left to keep', () => {
    const storage = memory()
    const key = gridKey({ kind: 'child', field: 'order' }, 'pg-delivery')
    writePreference(storage, key, '{"version":1,"sort":[]}')
    removePreference(storage, key)
    expect(readPreference(storage, key)).toBeNull()
    expect(storage.length).toBe(0)
  })
})

// A browser with site data blocked throws on every call to storage. The page
// must still draw, with the defaults, and saving a choice must not break it.
test('works when storage throws', () => {
  expect(readRenderer(refusing)).toBe('react')
  expect(readShare(refusing, 'width')).toBe(SPLITS.width.initial)
  expect(readShare(refusing, 'height')).toBe(SPLITS.height.initial)
  expect(readLayout(refusing)).toBeNull()
  expect(() => writeRenderer(refusing, 'both')).not.toThrow()
  expect(() => writeShare(refusing, 'width', 60)).not.toThrow()
  expect(() => writeShare(refusing, 'height', 40)).not.toThrow()
  expect(() => writeLayout(refusing, 'stacked')).not.toThrow()
  expect(readRenderer(undefined)).toBe('react')
  expect(readPreference(refusing, gridKey({ kind: 'records' }, 'pg-order'))).toBeNull()
  expect(() => writePreference(refusing, gridKey({ kind: 'records' }, 'pg-order'), '{}')).not.toThrow()
  expect(() => removePreference(refusing, gridKey({ kind: 'records' }, 'pg-order'))).not.toThrow()
})
