import type { ReactElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useFontsLoaded } from './use-fonts-loaded.js'

/*
 * When a grid measures its headers' floors again (0151): a canvas measures
 * a word in a fallback face until the web font has loaded, so the grid
 * counts each time the page's fonts finish loading, and measures again
 * with every count. jsdom has no FontFaceSet; the page's is stood for by
 * one whose loading the test ends. Read as the text of an element with no
 * role, which is what the hook gives a component.
 */

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(document, 'fonts')
})

function Count(): ReactElement {
  return <p>{String(useFontsLoaded())}</p>
}

/** A FontFaceSet whose first load ends when `done` is called, and whose later loads end by `again`. */
function fontsOf(): { done: () => void; again: () => void } {
  let done = (): void => {}
  const ready = new Promise<void>((resolve) => {
    done = resolve
  })
  const set = new EventTarget() as EventTarget & { ready: Promise<void> }
  set.ready = ready
  Object.defineProperty(document, 'fonts', { value: set, configurable: true })
  return { done, again: () => set.dispatchEvent(new Event('loadingdone')) }
}

describe('useFontsLoaded', () => {
  // A floor measured once, before the face has loaded, stays the fallback
  // face's: the count moves when the page's fonts are ready and again when
  // a later load ends, a face the header asks for first among them
  // (watched failing with the count left where it began: 0 after both).
  test('counts each time the page’s fonts finish loading', async () => {
    const fonts = fontsOf()
    render(<Count />)
    expect(screen.getByText('0')).toBeTruthy()
    await act(async () => {
      fonts.done()
      await Promise.resolve()
    })
    expect(screen.getByText('1')).toBeTruthy()
    act(() => fonts.again())
    expect(screen.getByText('2')).toBeTruthy()
  })

  // No FontFaceSet -- jsdom, or a browser without one -- is nothing to
  // wait for, and nothing thrown.
  test('stays at nothing where the page has no fonts to wait for', () => {
    render(<Count />)
    expect(screen.getByText('0')).toBeTruthy()
  })
})
