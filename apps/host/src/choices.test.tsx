import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { focusedName } from './test-accessible.js'
import { chooseForm, gridSection, mount, newRecord, signIn } from './test-host.js'
import type { User } from './test-host.js'
import { PREFERENCES } from './prefs.js'
import { ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * The person's two decisions of 2026-10-10 (0047), through the page: the
 * renderer switch -- React, Angular or Both, React until the viewer chooses
 * -- and the split between the records and the record in Side by side,
 * moved with the keys of the ARIA window splitter. Both are kept for the
 * viewer in this browser and nowhere else.
 *
 * What the stylesheet does with them -- two papers side by side, the split
 * hidden where Side by side is drawn stacked -- is the browser gate's.
 * `localStorage` is read directly: it is the browser's, not the tree's.
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
    expect((screen.getByRole('radio', { name: 'React' }) as HTMLInputElement).checked).toBe(true)

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
    expect((screen.getByRole('radio', { name: 'Both' }) as HTMLInputElement).checked).toBe(true)
  })

  // The separator: named by the records it sizes, 55 to 45 until moved, by
  // the arrows a step at a time and by Home and End to its limits, kept for
  // the viewer -- and there only in Side by side.
  test('splits the records and the record at 55, moves by its keys, and keeps where it was left', async () => {
    const user = await workspace(formId)
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
    cleanup()

    const again = await workspace(formId)
    expect(screen.getByRole('separator', { name: 'Records' }).getAttribute('aria-valuenow')).toBe('30')
    await again.click(screen.getByRole('radio', { name: 'Stacked' }))
    expect(screen.queryByRole('separator')).toBeNull()
    expect(within(gridSection('Records')).getByRole('grid', { name: 'Records' })).toBeTruthy()
  })
})
