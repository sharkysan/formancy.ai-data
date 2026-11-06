import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { focusedName } from './test-accessible.js'
import { chooseForm, chooseRenderer, gridSection, mount, newRecord, openDemo, signIn } from './test-host.js'
import type { User } from './test-host.js'
import { PREFERENCES } from './prefs.js'
import { ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * The person's two decisions of 2026-10-10 (0047), through the page: the
 * renderer switch -- React, Angular or Both, React until the viewer chooses
 * -- and the split between the records and the record in Side by side,
 * moved with the keys of the ARIA window splitter. And 0145's: Stacked's
 * line, the same splitter drawn across, and the layout the viewer chose
 * last, which an arrival whose address names none opens in. Each is kept
 * for the viewer in this browser and nowhere else.
 *
 * What the stylesheet does with them -- two papers side by side, the split
 * hidden where Side by side is drawn stacked, the Records panel as tall as
 * Stacked's line says -- is the browser gate's. `localStorage` is read
 * directly, and the address from the browser's location: they are the
 * browser's, not the tree's.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane()
})

afterAll(async () => {
  await plane?.close()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

const ARRIVES = { timeout: 15_000 }

/** The line between the records and the record: its orientation and where it sits. */
function lineAt(): [string | null, string | null] {
  const line = screen.getByRole('separator', { name: 'Records' })
  return [line.getAttribute('aria-orientation'), line.getAttribute('aria-valuenow')]
}

async function workspace(formId: string): Promise<User> {
  const user = mount(plane.fetch)
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, formId)
  return user
}

describe.each(ENGINES)("the viewer's choices on $engine", ({ formId }) => {
  // One form drawn by default, React's; Both draws the two, Angular alone
  // draws Angular's -- each renderer mounted only while chosen -- and the
  // choice is there the next time the page is opened in this browser.
  test('draws React until the viewer chooses, and keeps what they chose', async () => {
    const user = await workspace(formId)
    await newRecord(user)
    await waitFor(() => expect(screen.getByRole('region', { name: 'React' })).toBeTruthy())
    expect(screen.queryByRole('region', { name: 'Angular' })).toBeNull()
    await openDemo(user)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'React' }).checked).toBe(true)

    await user.click(screen.getByRole('radio', { name: 'Angular' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'React' })).toBeNull())
    await within(screen.getByRole('region', { name: 'Angular' })).findByRole('combobox', { name: 'Customer' }, ARRIVES)
    await user.click(screen.getByRole('radio', { name: 'Both' }))
    expect(screen.getByRole('region', { name: 'React' })).toBeTruthy()
    expect(localStorage.getItem(PREFERENCES.renderer)).toBe('both')
    cleanup()

    const again = await workspace(formId)
    await newRecord(again)
    await waitFor(() => expect(screen.getByRole('region', { name: 'Angular' })).toBeTruthy())
    expect(screen.getByRole('region', { name: 'React' })).toBeTruthy()
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Both' }).checked).toBe(true)
  })

  // The demo's controls closed hide the switch and not the choice (0146):
  // the renderer chosen draws the record with them closed, on this page and
  // the next. That they are closed where a person arrives, and stay as the
  // viewer left them, is demo-tools.test.tsx's and the browser gate's (to
  // be watched failing in CI with the record drawn by the switch only while
  // it is shown: React alone, once closed).
  test("draws the renderer chosen with the demo's controls closed", async () => {
    const user = await workspace(formId)
    const disclosure = (): HTMLElement => screen.getByRole('button', { name: 'For the demo' })
    await chooseRenderer(user, 'Angular')
    await user.click(disclosure())
    expect(screen.queryByRole('radio', { name: 'Angular' })).toBeNull()
    await newRecord(user)
    await within(await screen.findByRole('region', { name: 'Angular' }, ARRIVES)).findByRole('combobox', { name: 'Customer' }, ARRIVES)
    expect(screen.queryByRole('region', { name: 'React' })).toBeNull()
    cleanup()

    const again = await workspace(formId)
    await newRecord(again)
    await within(await screen.findByRole('region', { name: 'Angular' }, ARRIVES)).findByRole('combobox', { name: 'Customer' }, ARRIVES)
    expect(screen.queryByRole('region', { name: 'React' })).toBeNull()
  })

  // The separator: named by the records it sizes, 55 to 45 until moved, by
  // the arrows a step at a time and by Home and End to its limits, kept for
  // the viewer -- and its own: Stacked's line keeps its share apart (to be
  // watched failing in CI with one share moved for both lines: Stacked's
  // line came at the split's 30).
  test('splits the records and the record at 55, moves by its keys, and keeps where it was left', async () => {
    const user = await workspace(formId)
    await user.click(screen.getByRole('radio', { name: 'Side by side' }))
    const split = screen.getByRole('separator', { name: 'Records' })
    expect({
      now: split.getAttribute('aria-valuenow'),
      min: split.getAttribute('aria-valuemin'),
      max: split.getAttribute('aria-valuemax'),
      orientation: split.getAttribute('aria-orientation'),
    }).toEqual({ now: '55', min: '25', max: '75', orientation: 'vertical' })
    split.focus()
    await user.keyboard('{ArrowRight}')
    expect(split.getAttribute('aria-valuenow')).toBe('60')
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(split.getAttribute('aria-valuenow')).toBe('50')
    await user.keyboard('{End}')
    expect(split.getAttribute('aria-valuenow')).toBe('75')
    await user.keyboard('{Home}')
    expect(split.getAttribute('aria-valuenow')).toBe('25')
    await user.keyboard('{ArrowRight}')
    expect(focusedName()).toBe('Records')
    expect(localStorage.getItem(PREFERENCES.split)).toBe('30')
    // Stacked's line where it was: the split's share is the split's.
    await user.click(screen.getByRole('radio', { name: 'Stacked' }))
    expect(lineAt()).toEqual(['horizontal', '60'])
    await user.click(screen.getByRole('radio', { name: 'Side by side' }))
    cleanup()

    const again = await workspace(formId)
    expect(screen.getByRole('separator', { name: 'Records' }).getAttribute('aria-valuenow')).toBe('30')
    await again.click(screen.getByRole('radio', { name: 'Stacked' }))
    expect(lineAt()).toEqual(['horizontal', '60'])
    expect(within(gridSection('Records')).getByRole('grid', { name: 'Records' })).toBeTruthy()
  })

  // Stacked's line (0145), where a person arrives: named by the records it
  // sizes, drawn across, 60 to 40 until moved, by Down and Up a step at a
  // time -- not by Left and Right, a vertical one's -- and by Home and End to
  // its limits, the outer bounds where jsdom gives no window height; kept
  // for the viewer under its own key, and the keyboard left on it (to be
  // watched failing in CI with the split's keys for both: ArrowRight moved
  // the line down).
  test("shares Stacked's height at 60, moves by Up and Down, and keeps where it was left", async () => {
    const user = await workspace(formId)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Stacked' }).checked).toBe(true)
    const line = screen.getByRole('separator', { name: 'Records' })
    expect({
      now: line.getAttribute('aria-valuenow'),
      min: line.getAttribute('aria-valuemin'),
      max: line.getAttribute('aria-valuemax'),
      orientation: line.getAttribute('aria-orientation'),
    }).toEqual({ now: '60', min: '25', max: '75', orientation: 'horizontal' })
    line.focus()
    await user.keyboard('{ArrowDown}')
    expect(line.getAttribute('aria-valuenow')).toBe('65')
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(line.getAttribute('aria-valuenow')).toBe('55')
    await user.keyboard('{ArrowRight}')
    expect(line.getAttribute('aria-valuenow')).toBe('55')
    await user.keyboard('{ArrowLeft}')
    expect(line.getAttribute('aria-valuenow')).toBe('55')
    await user.keyboard('{End}')
    expect(line.getAttribute('aria-valuenow')).toBe('75')
    await user.keyboard('{Home}{ArrowDown}')
    expect(line.getAttribute('aria-valuenow')).toBe('30')
    expect(focusedName()).toBe('Records')
    expect([localStorage.getItem(PREFERENCES.stack), localStorage.getItem(PREFERENCES.split)]).toEqual(['30', null])
    cleanup()

    await workspace(formId)
    expect(screen.getByRole('separator', { name: 'Records' }).getAttribute('aria-valuenow')).toBe('30')
  })

  // The layout is the person's (0145): chosen in the Layout group -- Drill
  // down too -- it is kept, and an arrival whose address names no layout
  // opens in it; an address that names one wins, as a shared link does,
  // and leaves the kept one as it was (to be watched failing in CI with the
  // kept layout unread on arrival: the second arrival was Stacked).
  test('opens in the layout the viewer chose last, and an address naming one wins without being kept', async () => {
    const user = await workspace(formId)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Stacked' }).checked).toBe(true)
    await user.click(screen.getByRole('radio', { name: 'Drill down' }))
    expect(localStorage.getItem(PREFERENCES.layout)).toBe('drill')
    cleanup()

    window.history.replaceState(null, '', '/')
    await workspace(formId)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Drill down' }).checked).toBe(true)
    expect(window.location.hash).toBe(`#form=${formId}&layout=drill&view=records`)
    cleanup()

    window.history.replaceState(null, '', '/#layout=separate')
    await workspace(formId)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Separate views' }).checked).toBe(true)
    expect(localStorage.getItem(PREFERENCES.layout)).toBe('drill')
    cleanup()

    window.history.replaceState(null, '', '/')
    await workspace(formId)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Drill down' }).checked).toBe(true)
  })
})
