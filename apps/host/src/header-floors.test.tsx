import type { ReactElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { GridColumn } from './grid-datasource.js'
import { useHeaderFloors } from './use-header-floors.js'

/*
 * When a grid measures its headers' floors again (0151): a canvas measures
 * a word in a fallback face until the web font has loaded, so the floors
 * are measured again each time the page's fonts finish loading -- and the
 * grid is given new floors only when one of them changed. A font load
 * anywhere on the page, a paper's or a typeahead's, that leaves every floor
 * as it was must not have the grid draw its columns again: drawn again on
 * every load, a face drawn late outside the grid made 70 changes inside it
 * (measured in Playwright's Chromium, build 1248, on 2026-11-13, on a page of the grid alone; none
 * since), the likeliest reason the README's camera found the page changing
 * in run 43342524083. jsdom has no FontFaceSet and no canvas; the page's are
 * stood for by a FontFaceSet whose loads the test ends and a canvas whose
 * face is narrower until it has "loaded".
 */

const COLUMNS: GridColumn[] = [
  { key: 'id', label: 'Id', sortable: true, source: null },
  { key: 'approved_by', label: 'Approved by', sortable: false, source: null },
]

/** What each render of the probe gave: the floors, by identity. */
let given: Array<ReadonlyMap<string, number>> = []

function Probe(): ReactElement {
  given.push(useHeaderFloors(COLUMNS))
  return <p>floors</p>
}

/** A FontFaceSet the test ends loads of, and a canvas whose words widen once `loaded` is set. */
function page(): { done: () => Promise<void>; loaded: { now: boolean } } {
  let finish = (): void => {}
  const ready = new Promise<void>((resolve) => {
    finish = resolve
  })
  const set = Object.assign(new EventTarget(), { ready })
  Object.defineProperty(document, 'fonts', { value: set, configurable: true })
  const loaded = { now: false }
  const context = { font: '', measureText: (word: string) => ({ width: word.length * (loaded.now ? 9 : 7) }) }
  Object.defineProperty(globalThis, 'CanvasRenderingContext2D', { value: class {}, configurable: true })
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => context, configurable: true })
  return {
    loaded,
    done: async () => {
      finish()
      set.dispatchEvent(new Event('loadingdone'))
      await Promise.resolve()
    },
  }
}

afterEach(() => {
  cleanup()
  given = []
  Reflect.deleteProperty(document, 'fonts')
  Reflect.deleteProperty(globalThis, 'CanvasRenderingContext2D')
  Reflect.deleteProperty(HTMLCanvasElement.prototype, 'getContext')
})

describe('useHeaderFloors', () => {
  // Fonts that load and leave every floor as it was -- a face no header
  // is drawn in -- give the grid nothing new: the floors are the same Map,
  // and the probe is not drawn again (watched failing with the floors
  // measured anew at every load: a new Map, and a render, for each).
  test('gives the same floors where a font load changed none', async () => {
    const fonts = page()
    render(<Probe />)
    await act(async () => {
      await fonts.done()
      await fonts.done()
    })
    expect(given).toHaveLength(1)
  })

  // The header's face loaded, its words measure wider, and the grid is
  // given the floors measured in it (watched failing with the floors kept
  // from the first measure: Approved by's from the fallback face).
  test('gives new floors once the header’s face has loaded', async () => {
    const fonts = page()
    render(<Probe />)
    const first = given.at(-1)?.get('approved_by') ?? 0
    fonts.loaded.now = true
    await act(async () => {
      await fonts.done()
    })
    expect(given.length).toBeGreaterThan(1)
    expect(given.at(-1)?.get('approved_by')).toBeGreaterThan(first)
  })
})
