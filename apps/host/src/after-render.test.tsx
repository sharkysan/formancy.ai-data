import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useAfterRender } from './after-render.js'
import { focusedName } from './test-accessible.js'

/*
 * When an action asked with `useAfterRender` runs: after the render that
 * draws what was asked, and never before. React runs the effects an earlier
 * commit still has pending before it renders again, so a press that lands
 * between a commit and its effects -- an answer from the server drawn just
 * before a crumb is pressed -- has that earlier commit's effect run first.
 * No database: a level hidden until its state says otherwise stands in for
 * a Drill down level, and a layout effect for the press, which asks while
 * the commit before it still has its effects to run.
 *
 * Found by role and accessible name.
 */

afterEach(cleanup)

/** A level, hidden until it is shown, whose heading is asked for the keyboard as it is shown. */
function Level({ pressed }: { pressed: boolean }): ReactElement {
  const after = useAfterRender()
  const [shown, setShown] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => {
    if (!pressed) return
    // The press: the level shown, and the keyboard asked onto its heading once it is.
    setShown(true)
    after(() => heading.current?.focus())
  }, [pressed, after])
  return (
    <section hidden={!shown} aria-labelledby="level-heading">
      <h2 id="level-heading" tabIndex={-1} ref={heading}>
        Order line k1:400,1
      </h2>
    </section>
  )
}

describe('an action asked after the next render', () => {
  // The crumb's keyboard, asked while the render before the press still had
  // its effects to run: run by that render's effect, it asked a heading
  // still hidden for the keyboard, which nothing hidden takes, and the
  // keyboard fell to the page as the crumb pressed went (open-lookup.test's
  // case on PostgreSQL, run 42159267480; watched failing with the queue
  // drained by any render's effect).
  test('waits for the render that draws what it asked, not an earlier one still to run its effects', () => {
    const { rerender } = render(<Level pressed={false} />)
    rerender(<Level pressed />)
    expect(screen.getByRole('heading', { name: 'Order line k1:400,1' })).toBeTruthy()
    expect(focusedName()).toBe('Order line k1:400,1')
  })

  // Asked twice before a render, both run, each once and in the order
  // asked: the second press moves the keyboard after the first (watched
  // failing with the last request alone run).
  test('runs every action a render took, each once and in order', () => {
    const ran: string[] = []
    function Twice(): ReactElement {
      const after = useAfterRender()
      useLayoutEffect(() => {
        after(() => void ran.push('first'))
        after(() => void ran.push('second'))
      }, [after])
      return <p>Asked</p>
    }
    const { rerender } = render(<Twice />)
    rerender(<Twice />)
    expect(ran).toEqual(['first', 'second'])
  })
})
