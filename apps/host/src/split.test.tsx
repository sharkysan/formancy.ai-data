import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import type { ReactElement } from 'react'
import { Split } from './split.js'

/*
 * The separator's pointer handling (0047), alone: a drag starts on press,
 * moves the split while the pointer moves, and is kept where it is
 * released. A drag the browser takes over -- a touch that turns into a
 * scroll, a capture lost to another element -- ends it without keeping
 * anything. The keys are choices.test.tsx's, against the page.
 *
 * jsdom lays nothing out, so every position reads as the share the
 * separator already has: what is held here is whether a move or a release is
 * acted on at all, which is what a cancelled drag got wrong.
 */

afterEach(cleanup)

function Lanes({ onMove, onSettle }: { onMove: (share: number) => void; onSettle: (share: number) => void }): ReactElement {
  const lanes = useRef<HTMLDivElement>(null)
  return (
    <div ref={lanes}>
      <h2 id="records-heading">Records</h2>
      <Split share={55} lanes={lanes} labelledBy="records-heading" onMove={onMove} onSettle={onSettle} />
    </div>
  )
}

describe('the separator under a pointer', () => {
  // The control case: the handlers below are the ones a cancelled drag must
  // not reach, so the test first shows that they are reached by a real one.
  test('moves while dragged and keeps where it is released', () => {
    const onMove = vi.fn()
    const onSettle = vi.fn()
    render(<Lanes onMove={onMove} onSettle={onSettle} />)
    const split = screen.getByRole('separator', { name: 'Records' })
    fireEvent.pointerDown(split, { pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(split, { pointerId: 1, clientX: 80 })
    fireEvent.pointerUp(split, { pointerId: 1, clientX: 80 })
    expect(onMove).toHaveBeenCalledTimes(1)
    expect(onSettle).toHaveBeenCalledTimes(1)
  })

  // A drag the browser cancelled -- or whose capture went elsewhere -- is
  // over: a later move over the separator moves nothing, and a later
  // release keeps nothing, although nobody is dragging (watched failing:
  // the move and the release after the cancel were both acted on).
  test.each([
    ['cancelled', (split: HTMLElement) => fireEvent.pointerCancel(split, { pointerId: 1 })],
    ['whose capture was lost', (split: HTMLElement) => fireEvent.lostPointerCapture(split, { pointerId: 1 })],
  ])('acts on nothing after a drag %s', (_, end) => {
    const onMove = vi.fn()
    const onSettle = vi.fn()
    render(<Lanes onMove={onMove} onSettle={onSettle} />)
    const split = screen.getByRole('separator', { name: 'Records' })
    fireEvent.pointerDown(split, { pointerId: 1, clientX: 100 })
    end(split)
    fireEvent.pointerMove(split, { pointerId: 1, clientX: 60 })
    fireEvent.pointerUp(split, { pointerId: 1, clientX: 60 })
    expect(onMove).not.toHaveBeenCalled()
    expect(onSettle).not.toHaveBeenCalled()
  })
})
