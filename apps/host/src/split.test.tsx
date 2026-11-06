import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import type { ReactElement } from 'react'
import type { Axis } from './prefs.js'
import { Split, useShareLimits } from './split.js'

/*
 * The separator's pointer handling (0047), alone: a drag starts on press,
 * moves the split while the pointer moves, and is kept where it is
 * released. A drag the browser takes over -- a touch that turns into a
 * scroll, a capture lost to another element -- ends it without keeping
 * anything. The keys are choices.test.tsx's, against the page.
 *
 * jsdom lays nothing out, so every position reads as the share the
 * separator already has: what is held here is whether a move or a release is
 * acted on at all, which is what a cancelled drag got wrong. Stacked's line
 * (0145) is dragged once in a window given a height by hand, which jsdom
 * gives as nothing: the document's, since the accessibility tree has no box.
 */

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(document.documentElement, 'clientHeight')
})

function Lanes({
  axis = 'width',
  share = 55,
  onMove,
  onSettle,
}: {
  axis?: Axis
  share?: number
  onMove: (share: number) => void
  onSettle: (share: number) => void
}): ReactElement {
  const lanes = useRef<HTMLDivElement>(null)
  const limits = useShareLimits(axis, lanes)
  return (
    <div ref={lanes}>
      <h2 id="records-heading">Records</h2>
      <Split axis={axis} share={share} limits={limits} lanes={lanes} labelledBy="records-heading" onMove={onMove} onSettle={onSettle} />
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

describe("Stacked's line", () => {
  // Drawn across, so its orientation is horizontal, and named by the records
  // it sizes, as the split is; Down moves it down and Left is not its key
  // (watched failing with the line given the split's orientation, and with
  // the split's keys).
  test('is a horizontal separator named by the records, moved by Up and Down', () => {
    const onMove = vi.fn()
    const onSettle = vi.fn()
    render(<Lanes axis="height" share={60} onMove={onMove} onSettle={onSettle} />)
    const line = screen.getByRole('separator', { name: 'Records' })
    expect(line.getAttribute('aria-orientation')).toBe('horizontal')
    expect(line.getAttribute('aria-valuenow')).toBe('60')
    fireEvent.keyDown(line, { key: 'ArrowLeft' })
    fireEvent.keyDown(line, { key: 'ArrowRight' })
    expect(onMove).not.toHaveBeenCalled()
    fireEvent.keyDown(line, { key: 'ArrowDown' })
    expect(onMove).toHaveBeenLastCalledWith(65)
    expect(onSettle).toHaveBeenLastCalledWith(65)
  })

  // Dragged, it moves as far as the pointer does, as a share of the
  // window's height, from where the drag began: a pointer moved 160 pixels
  // up an 800-pixel window takes the records from 60 to 40, wherever the
  // lanes are (watched failing with the split's reading, across the lanes'
  // width: the drag left the line at 60; and with the share read from the
  // lanes' top, at the window's own in jsdom: 40 became 53).
  test("is dragged down the window's height", () => {
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, get: () => 800 })
    const onMove = vi.fn()
    const onSettle = vi.fn()
    render(<Lanes axis="height" share={60} onMove={onMove} onSettle={onSettle} />)
    const line = screen.getByRole('separator', { name: 'Records' })
    fireEvent.pointerDown(line, { pointerId: 1, clientX: 300, clientY: 580 })
    fireEvent.pointerMove(line, { pointerId: 1, clientX: 300, clientY: 420 })
    fireEvent.pointerUp(line, { pointerId: 1, clientX: 300, clientY: 420 })
    expect(onMove).toHaveBeenCalledWith(40)
    expect(onSettle).toHaveBeenCalledWith(40)
  })
})
