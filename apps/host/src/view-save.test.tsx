import { useState } from 'react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ListFilterTerm, ListSortTerm, ListView } from '@formancy/data-client'
import { audit, focusedName, unnamed } from './test-accessible.js'
import { ViewPicker } from './view-picker.js'

/*
 * A person's own views in the View picker (0126), without a server: Save
 * your view while the filter and the sort are their own, the picker then
 * naming it under "Your views", Remove your view while it is shown, and
 * what each answer says and where it leaves the keyboard. What the server
 * keeps, refuses and offers back is the routes' suites'
 * (runtime-lists.test.ts) and the page's against it (view-picker.test.tsx).
 */

// A page around the picker, as the host's is, so axe reads the picker and not a bare document.
beforeEach(() => {
  document.title = 'Records'
  document.documentElement.lang = 'en'
})
afterEach(cleanup)

const PLACED: ListView = { name: 'Placed', filter: [{ field: 'status', op: 'equals', value: 'placed' }], sort: [] }
const NOTED: ListFilterTerm[] = [{ field: 'notes', op: 'contains', text: 'rush' }]

/** What the picker was asked to send: each save's name and each remove's. */
let asked: string[] = []

/**
 * A grid's picker as a section holds it: its filter and sort, and the
 * person's own views, which a save or a remove answered with. `answer` is
 * what the server says to each: null for agreed, a sentence for refused, or
 * a promise that has not settled yet.
 */
function Section({
  views = [],
  own: kept = [],
  filter: start = NOTED,
  answer = () => Promise.resolve(null),
}: {
  views?: ListView[]
  own?: ListView[]
  filter?: ListFilterTerm[]
  answer?: () => Promise<string | null>
}): ReactElement {
  const [filter, setFilter] = useState(start)
  const [sort, setSort] = useState<ListSortTerm[]>([])
  const [own, setOwn] = useState(kept)
  return (
    <main>
      <ViewPicker
        idBase="records"
        views={views}
        own={own}
        filter={filter}
        sort={sort}
        onPick={(picked, sorted) => {
          setFilter(picked)
          setSort(sorted)
        }}
        onSave={async (name) => {
          asked.push(`save ${name}`)
          const refused = await answer()
          if (refused === null) setOwn((views) => [...views, { name, filter, sort }])
          return refused
        }}
        onRemove={async (name) => {
          asked.push(`remove ${name}`)
          const refused = await answer()
          if (refused === null) setOwn((views) => views.filter((view) => view.name !== name))
          return refused
        }}
      />
    </main>
  )
}

const line = (): string => screen.getByRole('status', { name: 'Your views' }).textContent ?? ''
const shown = (): string => within(screen.getByRole('combobox', { name: 'View' })).getByRole('option', { selected: true }).textContent ?? ''

describe('a person’s own views in the View picker (0126)', () => {
  // A filter of their own is kept under the name they give it: the line
  // says so, the picker names it under "Your views", and the keyboard is on
  // View, which now says it -- the name box and its button are gone, since
  // the filter is a view now. Watched failing with the person's own views
  // left out of what the picker matches: it still said "Your own filter
  // and sort", and offered Save again.
  test('saves a filter of their own under its name, and the picker then names it', async () => {
    asked = []
    const user = userEvent.setup()
    render(<Section views={[PLACED]} />)
    expect(shown()).toBe('Your own filter and sort')
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])
    await user.type(screen.getByRole('textbox', { name: 'Name of your view' }), ' Rush orders ')
    await user.click(screen.getByRole('button', { name: 'Save your view' }))
    await waitFor(() => expect(line()).toBe('Saved your view “Rush orders”.'))
    expect(asked).toEqual(['save Rush orders'])
    expect(shown()).toBe('Rush orders')
    expect(
      within(screen.getByRole('group', { name: 'Your views' }))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Rush orders'])
    expect(focusedName()).toBe('View')
    expect(screen.queryByRole('textbox', { name: 'Name of your view' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove your view' })).toBeTruthy()
    expect(await audit()).toEqual([])
  })

  // A refusal is the server's sentence on the picker's line, the name as
  // typed, and the keyboard where it pressed, to correct it there. Watched
  // failing with the box emptied on every answer: the name was gone.
  test('says a refusal, keeping the name and the keyboard where they were', async () => {
    asked = []
    const user = userEvent.setup()
    render(<Section answer={() => Promise.resolve('It asks what the view “Placed” asks: pick that one.')} />)
    await user.type(screen.getByRole('textbox', { name: 'Name of your view' }), 'Mine')
    await user.click(screen.getByRole('button', { name: 'Save your view' }))
    await waitFor(() => expect(line()).toBe('It asks what the view “Placed” asks: pick that one.'))
    expect(screen.getByRole('textbox', { name: 'Name of your view' })).toHaveProperty('value', 'Mine')
    expect(focusedName()).toBe('Save your view')
    expect(screen.getByRole('status', { name: 'Your views' }).dataset['kind']).toBe('refused')
  })

  // While a save is on its way a second press sends nothing, and says it
  // is busy; the answer is heard once it comes. Watched failing with no
  // guard: two saves were sent.
  test('sends one save however often it is pressed while the first is on its way', async () => {
    asked = []
    const user = userEvent.setup()
    let settle: (refused: string | null) => void = () => {}
    render(<Section answer={() => new Promise((resolve) => (settle = resolve))} />)
    await user.type(screen.getByRole('textbox', { name: 'Name of your view' }), 'Mine')
    const save = screen.getByRole('button', { name: 'Save your view' })
    await user.click(save)
    await user.click(save)
    expect(save.getAttribute('aria-disabled')).toBe('true')
    expect(asked).toEqual(['save Mine'])
    settle(null)
    await waitFor(() => expect(line()).toBe('Saved your view “Mine”.'))
  })

  // Shown, a view of theirs can be let go: the line says so, the filter is
  // still shown and is theirs again, so Save comes back -- and with no view
  // left to pick, View goes with it and the keyboard goes to the name box.
  // Watched failing with the keyboard sent to View alone: it was left on
  // the page itself.
  test('removes a view of theirs, and the filter it showed can be saved again', async () => {
    asked = []
    const user = userEvent.setup()
    render(<Section own={[{ name: 'Rush', filter: NOTED, sort: [] }]} />)
    expect(shown()).toBe('Rush')
    await user.click(screen.getByRole('button', { name: 'Remove your view' }))
    await waitFor(() => expect(line()).toBe('Removed your view “Rush”.'))
    expect(asked).toEqual(['remove Rush'])
    expect(screen.queryByRole('combobox', { name: 'View' })).toBeNull()
    expect(focusedName()).toBe('Name of your view')
    expect(await audit()).toEqual([])
  })

  // A view of theirs is picked as an administrator's is: Show view sends its
  // filter and its sort together. Watched failing with "Your views" read as
  // the form's views by place: the form's first was shown instead.
  test('picks a view of theirs as it picks the form’s', async () => {
    const user = userEvent.setup()
    const mine: ListView = { name: 'Rush', filter: NOTED, sort: [{ field: 'notes', direction: 'asc' }] }
    render(<Section views={[PLACED]} own={[mine]} filter={[]} />)
    expect(shown()).toBe('All records')
    expect(screen.queryByRole('textbox', { name: 'Name of your view' })).toBeNull()
    await user.selectOptions(screen.getByRole('combobox', { name: 'View' }), 'Rush')
    await user.click(screen.getByRole('button', { name: 'Show view' }))
    expect(shown()).toBe('Rush')
    expect(screen.getByRole('button', { name: 'Remove your view' })).toBeTruthy()
  })

  // No view offered, none of theirs, and every record listed: nothing is
  // drawn, as before a person could keep views (0105).
  test('draws nothing where there is nothing to pick or keep', () => {
    render(<Section filter={[]} />)
    expect(screen.getByRole('main').innerHTML).toBe('')
  })
})
