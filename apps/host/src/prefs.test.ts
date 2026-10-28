import { describe, expect, test } from 'vitest'
import { gridKey, PREFERENCES, readPreference, readRenderer, readSplit, removePreference, SPLIT, splitLimits, stepSplit, writePreference, writeRenderer, writeSplit } from './prefs.js'

/*
 * What one viewer's browser keeps of the workspace (0047): which renderer
 * the record is drawn with, and where the split between the records and the
 * record sits -- the person's two decisions of 2026-10-10 -- and under one
 * key per form and kind of section, a grid's columns and list (0106,
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
    expect(readSplit(storage)).toBe(SPLIT.initial)
    expect(SPLIT.initial).toBe(55)
    writeSplit(storage, 62)
    expect(readSplit(storage)).toBe(62)
    storage.setItem(PREFERENCES.split, 'wide')
    expect(readSplit(storage)).toBe(SPLIT.initial)
  })

  // Neither side narrower than what it holds needs: the limits come from the
  // width the two lanes share. With no width -- a hidden lane, or jsdom --
  // they are the outer bounds.
  test('keeps each side at least as wide as its content needs', () => {
    expect(splitLimits(1200, 16)).toEqual({ min: 27, max: 68 })
    expect(splitLimits(900, 16)).toEqual({ min: 36, max: 57 })
    expect(splitLimits(0, 16)).toEqual({ min: SPLIT.outer.min, max: SPLIT.outer.max })
    // Narrower than both minimums together: the default, pinned.
    expect(splitLimits(500, 16)).toEqual({ min: SPLIT.initial, max: SPLIT.initial })
  })

  // The separator's keys, as the ARIA pattern for a window splitter has
  // them: arrows step, Home and End go to the limits, and nothing passes them.
  test('moves by its keys and stops at its limits', () => {
    const limits = { min: 30, max: 70 }
    expect(stepSplit(55, 'ArrowLeft', limits)).toBe(50)
    expect(stepSplit(55, 'ArrowRight', limits)).toBe(60)
    expect(stepSplit(55, 'Home', limits)).toBe(30)
    expect(stepSplit(55, 'End', limits)).toBe(70)
    expect(stepSplit(32, 'ArrowLeft', limits)).toBe(30)
    expect(stepSplit(68, 'ArrowRight', limits)).toBe(70)
    expect(stepSplit(55, 'Tab', limits)).toBeNull()
  })
})

describe("a grid's key", () => {
  // One value per form and kind of section, under the prefix a test can
  // name: the Records panel's and a child section's of one form are two
  // grids -- the child's leaves out its parent's field -- and the kind goes
  // first, so no form id spells another form's key (watched failing with
  // the form id alone: one key for the Records panel's grid and a child
  // section's).
  test('is one per form and kind of section, under the grid prefix', () => {
    const keys = [gridKey('records', 'pg-order'), gridKey('child', 'pg-order'), gridKey('records', 'pg-delivery')]
    expect(new Set(keys).size).toBe(3)
    for (const key of keys) expect(key.startsWith(PREFERENCES.grid)).toBe(true)
    expect(gridKey('records', 'pg-order')).toBe('formancy-data-host.grid.records.pg-order')
  })

  // Reset columns with no list kept leaves nothing to keep, and the key
  // goes rather than a value saying nothing (watched failing with a remove
  // that did nothing: the value read back).
  test('is removed when nothing is left to keep', () => {
    const storage = memory()
    writePreference(storage, gridKey('child', 'pg-delivery'), '{"version":1,"sort":[]}')
    removePreference(storage, gridKey('child', 'pg-delivery'))
    expect(readPreference(storage, gridKey('child', 'pg-delivery'))).toBeNull()
    expect(storage.length).toBe(0)
  })
})

// A browser with site data blocked throws on every call to storage. The page
// must still draw, with the defaults, and saving a choice must not break it.
test('works when storage throws', () => {
  expect(readRenderer(refusing)).toBe('react')
  expect(readSplit(refusing)).toBe(SPLIT.initial)
  expect(() => writeRenderer(refusing, 'both')).not.toThrow()
  expect(() => writeSplit(refusing, 60)).not.toThrow()
  expect(readRenderer(undefined)).toBe('react')
  expect(readPreference(refusing, gridKey('records', 'pg-order'))).toBeNull()
  expect(() => writePreference(refusing, gridKey('records', 'pg-order'), '{}')).not.toThrow()
  expect(() => removePreference(refusing, gridKey('records', 'pg-order'))).not.toThrow()
})
