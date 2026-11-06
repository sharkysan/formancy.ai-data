import { createRef } from 'react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { FormMenu, FormMenuEntry } from '@formancy/data-client'
import { focusedName } from './test-accessible.js'
import { FormsNav } from './forms-nav.js'
import type { Linked } from './linked-forms.js'

/*
 * The list of forms alone (0144), without a server: what its keys leave to
 * an input method and to the modifiers, which arrow a linked form draws,
 * and where the keyboard goes when the linked forms are drawn again
 * without the one it was on. What the server lists, and the list's journey
 * through the page, are forms-nav.test.tsx's.
 *
 * Found by role and accessible name, with one read the accessibility tree
 * cannot answer, said where it is made: a linked form's arrow, an SVG
 * hidden from the tree so that it is not read out, and all a phone draws
 * of how the form is linked. It is read as drawn: each head's point, the
 * middle of its polyline, and whether it is at the shaft's right end or
 * its left.
 */

afterEach(cleanup)

const entry = (id: string, title: string): FormMenuEntry => ({ id, title, group: 'Sales', operations: ['read'], children: [] })
const CUSTOMER = entry('pg-customer', 'Customer')
const ORDER = entry('pg-order', 'Order')
const LINE = entry('pg-order-line', 'Order line')
const STAFF = entry('pg-staff', 'Staff')
const MENU: FormMenu = { forms: [CUSTOMER, ORDER, LINE, STAFF] }
const LINKED: Linked = {
  title: 'Order',
  forms: [
    { entry: CUSTOMER, fields: true, rows: false },
    { entry: LINE, fields: false, rows: true },
    { entry: STAFF, fields: true, rows: true },
  ],
}

/** The list as the workspace draws it with Order open; every form chosen is kept in `chosen`. */
function Nav({ linked = LINKED, chosen = [] }: { linked?: Linked | null; chosen?: string[] }): ReactElement {
  return (
    <FormsNav
      menu={MENU}
      current="pg-order"
      layout="stacked"
      linked={linked}
      headingRef={createRef()}
      signOutRef={createRef()}
      onChoose={(id) => void chosen.push(id)}
      onSignOut={() => {}}
    />
  )
}

const nav = (): HTMLElement => screen.getByRole('navigation', { name: 'Forms' })
const box = (): HTMLInputElement => within(nav()).getByRole<HTMLInputElement>('textbox', { name: 'Find a form' })

describe('Find a form', () => {
  // While an input method composes a word, Enter takes the word and Esc
  // ends the composition: taken by the box, Enter would open the one form
  // the half-typed word matched and Esc would throw the search away.
  // 229 is the key a browser reports for them, Safari's after the
  // composition has already ended (watched failing with the composition
  // unread: Enter opened Order line; and with 229 unread).
  test('leaves Enter, Esc and Down to an input method while it composes', async () => {
    const chosen: string[] = []
    render(<Nav chosen={chosen} />)
    await userEvent.setup().type(box(), 'line')
    for (const key of ['Enter', 'Escape', 'ArrowDown']) {
      fireEvent.keyDown(box(), { key, isComposing: true, keyCode: 229 })
      fireEvent.keyDown(box(), { key, keyCode: 229 })
    }
    expect({ chosen, typed: box().value, focused: focusedName() }).toEqual({ chosen: [], typed: 'line', focused: 'Find a form' })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(chosen).toEqual(['pg-order-line'])
  })

  // Shift and Down selects to the end of the box, and the platform's
  // modifiers move the caret or are the screen reader's: taken as Down,
  // each would move the keyboard into the list instead (watched failing
  // with the modifiers unread).
  test('leaves Down with a modifier to the box', () => {
    render(<Nav />)
    box().focus()
    for (const held of ['shiftKey', 'ctrlKey', 'metaKey', 'altKey'])
      expect({ held, passed: fireEvent.keyDown(box(), { key: 'ArrowDown', [held]: true }), focused: focusedName() }).toEqual({
        held,
        passed: true,
        focused: 'Find a form',
      })
  })
})

describe('the list', () => {
  // On a form, Down and Up with a modifier are the browser's or the screen
  // reader's, as in the box (watched failing with the modifiers unread on
  // the list).
  test('leaves Down and Up with a modifier to the browser', () => {
    render(<Nav />)
    const first = within(nav()).getByRole('link', { name: 'Customer pg-customer' })
    first.focus()
    for (const key of ['ArrowDown', 'ArrowUp'])
      for (const held of ['shiftKey', 'ctrlKey', 'metaKey', 'altKey'])
        expect({ key, held, passed: fireEvent.keyDown(first, { key, [held]: true }), focused: focusedName() }).toEqual({
          key,
          held,
          passed: true,
          focused: 'Customer pg-customer',
        })
  })
})

describe('the linked forms', () => {
  // On a phone the words are hidden and the arrow is all that is drawn of
  // how a form is linked: a fields' form drawn with the rows' arrow would
  // send the person the wrong way, and nothing in the tree would differ
  // (watched failing with the heads of fields and rows swapped). Read off
  // the DOM, since the arrow is hidden from the tree: which way each head
  // points, from where its point is against its ends.
  test('draw the arrow of the way each is linked', () => {
    render(<Nav />)
    const list = within(nav()).getByRole('list', { name: 'Linked to Order' })
    const pointing = (head: Element): string => {
      const [first, point] = (head.getAttribute('points') ?? '').split(' ').map((pair) => Number(pair.split(',')[0]))
      return first === undefined || point === undefined ? 'nowhere' : point > first ? 'right' : 'left'
    }
    const drawn = within(list)
      .getAllByRole('link')
      .map((link) => [link.querySelector('code')?.textContent ?? null, [...link.querySelectorAll('svg[aria-hidden="true"] polyline')].map(pointing).sort()])
    expect(drawn).toEqual([
      ['pg-customer', ['right']],
      ['pg-order-line', ['left']],
      ['pg-staff', ['left', 'right']],
    ])
  })

  // A linked form chosen is opened, and while it is asked for the linked
  // forms are not drawn: the link with the keyboard is gone, and the
  // keyboard with it, to the page itself, where a screen reader says
  // nothing of where it is until the form's heading takes it. It goes to
  // the same form's link in its group, or to the box where a search left
  // that out (watched failing with the keyboard left where the link
  // was).
  test('keep the keyboard on the same form when they are drawn without its link', async () => {
    const { rerender } = render(<Nav />)
    within(nav()).getByRole('link', { name: 'Customer pg-customer where Order’s fields lead' }).focus()
    rerender(<Nav linked={null} />)
    expect(focusedName()).toBe('Customer pg-customer')
    rerender(<Nav />)
    await userEvent.setup().type(box(), 'line')
    within(nav()).getByRole('link', { name: 'Customer pg-customer where Order’s fields lead' }).focus()
    rerender(<Nav linked={null} />)
    expect(focusedName()).toBe('Find a form')
  })

  // A person who moved the keyboard on is not followed: drawn without the
  // link it was once on, the list leaves it where they put it (watched
  // failing with the link that had the keyboard never forgotten).
  test('leave the keyboard where the person moved it', () => {
    const { rerender } = render(<Nav />)
    within(nav()).getByRole('link', { name: 'Customer pg-customer where Order’s fields lead' }).focus()
    within(nav()).getByRole('button', { name: 'Sign out' }).focus()
    rerender(<Nav linked={null} />)
    expect(focusedName()).toBe('Sign out')
  })
})
