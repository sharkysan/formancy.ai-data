import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import type { ReactElement } from 'react'
import type { Axis } from './prefs.js'
import { Split, useLine } from './split.js'

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
 * (0145) is dragged, resized and drawn in a short window given a height by
 * hand, which jsdom gives as nothing: the document's, since the
 * accessibility tree has no box.
 */

/** The window `height` pixels tall, as the document says, and told so as a browser tells it. */
function windowOf(height: number): void {
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, get: () => height })
  act(() => {
    window.dispatchEvent(new Event('resize'))
  })
}

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(document.documentElement, 'clientHeight')
})

/** How many times `Lanes` has rendered: what a `resize` costs the page around a line. */
let renders = 0

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
  renders += 1
  const lanes = useRef<HTMLDivElement>(null)
  // The workspace's own: a line where `useLine` gives one, and none elsewhere.
  const line = useLine(axis, { width: share, height: share }, lanes)
  return (
    <div ref={lanes}>
      <h2 id="records-heading">Records</h2>
      <section id="master" aria-labelledby="records-heading" />
      {line === null ? null : <Split line={line} controls="master" lanes={lanes} labelledBy="records-heading" onMove={onMove} onSettle={onSettle} />}
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
  // the split's keys). Its value is said as the records' share of the
  // window's height, which is what it is: the record below takes what the
  // page leaves it, not the rest of the window (watched failing with the
  // split's words, "the record 40%").
  test('is a horizontal separator named by the records, moved by Up and Down', () => {
    const onMove = vi.fn()
    const onSettle = vi.fn()
    render(<Lanes axis="height" share={60} onMove={onMove} onSettle={onSettle} />)
    const line = screen.getByRole('separator', { name: 'Records' })
    expect(line.getAttribute('aria-orientation')).toBe('horizontal')
    expect(line.getAttribute('aria-valuenow')).toBe('60')
    expect(line.getAttribute('aria-valuetext')).toBe("Records 60% of the window's height")
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

describe('a line and the window', () => {
  // Each line says which pane it sizes, the Records panel, as the window
  // splitter pattern has a separator name its primary pane (watched failing
  // with aria-controls left off both).
  test.each([['width'], ['height']] as const)('controls the Records panel, on the %s', (axis) => {
    render(<Lanes axis={axis} onMove={vi.fn()} onSettle={vi.fn()} />)
    expect(screen.getByRole('separator', { name: 'Records' }).getAttribute('aria-controls')).toBe('master')
  })

  // A share kept in a tall window, the window made shorter: the line moves
  // inside the shorter window's limits as it is resized, and the Records
  // panel is drawn where the line says, since both read the one value -- 75
  // in a 900-pixel window, at most 70 in a 640-pixel one (watched failing
  // with the share drawn as kept, unclamped: 75; and with the resize
  // unheard: 75).
  test("stays inside the window's limits as the window is resized", () => {
    windowOf(900)
    render(<Lanes axis="height" share={75} onMove={vi.fn()} onSettle={vi.fn()} />)
    expect(screen.getByRole('separator', { name: 'Records' }).getAttribute('aria-valuenow')).toBe('75')
    windowOf(640)
    expect(screen.getByRole('separator', { name: 'Records' }).getAttribute('aria-valuenow')).toBe('70')
  })

  // A window too short for the records' least and the record's together --
  // a phone on its side, 390 pixels; a laptop at 200% -- has no Stacked line:
  // one there could not move, a tab stop whose keys and drag do nothing; and
  // the line comes back when the window is tall enough again (watched failing
  // with the line drawn pinned at 60 in a 390-pixel window). Side by side's
  // split is drawn, pinned, where its lanes are too narrow, as it was.
  test('is not drawn in a window too short for it to move', () => {
    windowOf(390)
    render(<Lanes axis="height" share={60} onMove={vi.fn()} onSettle={vi.fn()} />)
    expect(screen.queryByRole('separator')).toBeNull()
    windowOf(900)
    expect(screen.getByRole('separator', { name: 'Records' }).getAttribute('aria-valuenow')).toBe('60')
  })
})

describe('a resize that changes nothing', () => {
  // A window that says it was resized and is the height it was -- a phone's
  // toolbar moving, a screenshot of the whole page, which fires one
  // `resize` a shot -- renders nothing again: the open form under the line
  // re-rendered on each, and an input in it changed its name each time, so
  // the README's pictures never settled on CI (watched failing with the
  // height kept as a new object at every `resize`: a render each).
  test('renders nothing again, and a resize that changes the height does', () => {
    windowOf(900)
    render(<Lanes axis="height" share={60} onMove={vi.fn()} onSettle={vi.fn()} />)
    const before = renders
    windowOf(900)
    windowOf(900)
    expect(renders).toBe(before)
    windowOf(700)
    expect(renders).toBeGreaterThan(before)
  })
})
