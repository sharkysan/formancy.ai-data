import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { ServerDid, STILL } from './server-did.js'

/**
 * Words that say what the server did, in the room's teal for a moment
 * (0146). jsdom applies no CSS and runs no animation, so what is held here
 * is what the stylesheet's colour hangs off: the words in an element of
 * their own inside the line's live region, a new one each time the line
 * says what the server did, and marked still where the person asks for
 * reduced motion. Those are DOM reads -- a class, an attribute and an
 * element's identity, which no role or name carries; the line itself is
 * found by its role. What the colour is, and its contrast, the host's
 * browser gate measures.
 */

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const line = (): HTMLElement => screen.getByRole('status')

function Line({ said, words }: { said: number; words: string }): ReactElement {
  return (
    <p role="status">
      <ServerDid said={said}>{words}</ServerDid>
    </p>
  )
}

describe('what the server did', () => {
  // The colour is an animation that runs once on an element as it is drawn:
  // the same element kept for the next answer -- "Saved." twice, or a second
  // page -- would say it in the line's own colour, as though nothing had
  // happened. The live region stays one element, so what changes in it is
  // heard (watched failing with the key left off the words: the same
  // element both times).
  test('is said in an element of its own, a new one each time', () => {
    const { rerender } = render(<Line said={1} words="Saved." />)
    const first = line().querySelector('.server-did')
    expect(first?.textContent).toBe('Saved.')
    const region = line()
    rerender(<Line said={2} words="Saved." />)
    const second = line().querySelector('.server-did')
    expect(second?.textContent).toBe('Saved.')
    expect(second).not.toBe(first)
    expect(line()).toBe(region)
  })

  // Under reduced motion the colour changes at the end of the moment, with
  // no transition, which the stylesheet hangs off `data-still`; elsewhere
  // it fades (watched failing with the query never asked: no `data-still`
  // under reduced motion).
  test('holds still where the person asks for reduced motion', () => {
    render(<Line said={1} words="Rows 1–50." />)
    expect(line().querySelector('.server-did')?.hasAttribute('data-still')).toBe(false)
    cleanup()
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === STILL,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    render(<Line said={1} words="Rows 1–50." />)
    expect(line().querySelector('.server-did')?.hasAttribute('data-still')).toBe(true)
  })
})
