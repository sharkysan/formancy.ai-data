import { useState } from 'react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { ColumnsPanel } from './columns-panel.js'
import { defaultChoices } from './columns.js'
import type { ColumnChoice } from './columns.js'
import type { GridColumn } from './grid-datasource.js'
import { audit, focusedName, unnamed } from './test-accessible.js'
import { WIDEST, WIDTH_STEP, withWidths } from './widths.js'
import type { ColumnWidth, Measured, WidthChange } from './widths.js'

/*
 * A column's width in a grid's Columns (0151), without a server or a grid:
 * the keyboard's way to what a pointer does on a header's edge (formancy.ai
 * 0046) -- Wider and Narrower a step at a time, never past the column's
 * floor or the widest, and Fit giving a column back to its content -- what
 * the panel asks the section to keep, and what it says of each press. The
 * grid the section draws is stood for by the widths it would draw, which a
 * kept width sets and Fit gives back to the content's; that the page's
 * real grid follows, keeps and never sizes a kept width away is
 * columns-panel.test.tsx's and grid-keys.test.tsx's, against the real
 * server on both engines.
 *
 * Found by role and accessible name (formancy.ai 0034): each column's
 * Wider, Narrower and Fit buttons named for the column, and the panel's
 * line a status named by Columns.
 */

// A page around the panel, as the host's is, so axe reads the panel and not a bare document.
beforeEach(() => {
  document.title = 'Records'
  document.documentElement.lang = 'en'
})
afterEach(cleanup)

const column = (key: string, label: string): GridColumn => ({ key, label, sortable: true, source: null })
const COLUMNS = [column('id', 'Id'), column('amount', 'Amount'), column('notes', 'Notes')]
/** Each column as its content sizes it, and its header's floor. */
const CONTENT: Readonly<Record<string, Measured>> = {
  id: { width: 66, min: 66, max: WIDEST },
  amount: { width: 120, min: 92, max: WIDEST },
  notes: { width: 320, min: 84, max: WIDEST },
}

/** What the panel asked the section to keep, each change as it came. */
let asked: WidthChange[] = []

/** A section as the page holds one: the widths kept, and the grid drawing each column at its kept width or its content's. */
function Section({ kept: start = [], choices = defaultChoices(COLUMNS) }: { kept?: ColumnWidth[]; choices?: ColumnChoice[] }): ReactElement {
  const [kept, setKept] = useState(start)
  return (
    <main>
      <ColumnsPanel
        idBase="records-columns"
        columns={COLUMNS}
        choices={choices}
        onChoices={() => undefined}
        onReset={() => undefined}
        measure={(field) => {
          const content = CONTENT[field]
          if (content === undefined) return null
          const width = kept.find((each) => each.field === field)?.width
          return width === undefined ? content : { ...content, width }
        }}
        onWidths={(changes) => {
          asked.push(...changes)
          setKept((before) => withWidths(before, changes))
        }}
      />
    </main>
  )
}

const line = (): string => screen.getByRole('status', { name: 'Columns' }).textContent ?? ''
const button = (name: string): HTMLElement => within(screen.getByRole('list', { name: 'Columns' })).getByRole('button', { name })

/** The panel drawn and opened from the keyboard. */
async function opened(kept?: ColumnWidth[], choices?: ColumnChoice[]): Promise<ReturnType<typeof userEvent.setup>> {
  asked = []
  const user = userEvent.setup()
  render(<Section {...(kept === undefined ? {} : { kept })} {...(choices === undefined ? {} : { choices })} />)
  screen.getByRole('button', { name: 'Columns' }).focus()
  await user.keyboard('{Enter}')
  return user
}

/** Press a control from the keyboard: focused, then Enter. */
async function press(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  button(name).focus()
  await user.keyboard('{Enter}')
}

describe('a column’s width in Columns (0151)', () => {
  // Every column has the three, named for it, beside its moves, a hidden
  // one too, which opens at the width set when it is shown again: a column
  // that only a pointer could widen would be no keyboard user's (watched
  // failing with the buttons drawn for the shown columns alone: no "Make
  // Notes wider"; and with Fit named by its text: three buttons "Fit").
  test('offers Wider, Narrower and Fit for every column, each named for it', async () => {
    await opened(undefined, [
      { field: 'id', shown: true },
      { field: 'amount', shown: true },
      { field: 'notes', shown: false },
    ])
    for (const { label } of COLUMNS) {
      for (const name of [`Make ${label} wider`, `Make ${label} narrower`, `Fit ${label} to its content`]) expect(button(name)).toBeTruthy()
    }
    expect(line()).toBe('')
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])
  })

  // Wider asks the section to keep the column one step wider and says how
  // wide it is, the keyboard staying on the button; Narrower a step
  // narrower, and no narrower than the column's floor, where its header's
  // words still fit (watched failing with a press keeping the width the
  // grid drew, not the one stepped to: 120 asked for after Wider; and with
  // the step taken past the column's floor: 80 asked for under one of 92).
  test('makes a column wider and narrower a step at a time, saying how wide', async () => {
    const user = await opened()
    await press(user, 'Make Amount wider')
    expect(asked).toEqual([{ field: 'amount', width: 120 + WIDTH_STEP }])
    expect(line()).toBe(`Amount is ${String(120 + WIDTH_STEP)} pixels wide.`)
    expect(focusedName()).toBe('Make Amount wider')
    expect(await audit()).toEqual([])

    asked = []
    await press(user, 'Make Amount narrower')
    await user.keyboard('{Enter}')
    expect(asked).toEqual([
      { field: 'amount', width: 120 },
      { field: 'amount', width: 92 },
    ])
    expect(line()).toBe('Amount is 92 pixels wide.')
    expect(focusedName()).toBe('Make Amount narrower')
    expect(await audit()).toEqual([])
  })

  // At either end a press changes nothing, asks nothing to be kept, and
  // says why, the keyboard staying where it is: a person who cannot see the
  // header learns the end from the press (watched failing with the end
  // said as a change and asked for again: "Amount is 960 pixels wide.").
  test('says an end reached, and keeps nothing for it', async () => {
    const user = await opened([
      { field: 'amount', width: WIDEST },
      { field: 'notes', width: 84 },
    ])
    await press(user, 'Make Amount wider')
    expect(asked).toEqual([])
    expect(line()).toBe(`Amount is as wide as a column goes: ${String(WIDEST)} pixels.`)
    expect(focusedName()).toBe('Make Amount wider')
    await press(user, 'Make Notes narrower')
    expect(asked).toEqual([])
    expect(line()).toBe('Notes is as narrow as its header lets it be: 84 pixels.')
    expect(await audit()).toEqual([])
  })

  // Fit gives a column back to its content: the section is asked to keep
  // no width for it, the grid then sizes it, and the panel says so (watched
  // failing with Fit asking for the width the content would have, which
  // the next page's content could not change: { width: 120 } kept).
  test('fits a column to its content again, keeping no width for it', async () => {
    const user = await opened([{ field: 'amount', width: 400 }])
    await press(user, 'Fit Amount to its content')
    expect(asked).toEqual([{ field: 'amount', width: null }])
    expect(line()).toBe('Amount is sized to its content.')
    expect(focusedName()).toBe('Fit Amount to its content')
    expect(await audit()).toEqual([])
  })

  // The same sentence said again is said again: each saying is a new
  // element of the line, which a screen reader hears arrive (watched
  // failing with the words set on one element: the second press's
  // sentence left as the first's, nothing added). An element with no role,
  // read from the DOM: the tree says only the line's text.
  test('says a press at an end each time it is pressed', async () => {
    const user = await opened([{ field: 'amount', width: WIDEST }])
    await press(user, 'Make Amount wider')
    const first = screen.getByRole('status', { name: 'Columns' }).firstElementChild
    await user.keyboard('{Enter}')
    const second = screen.getByRole('status', { name: 'Columns' }).firstElementChild
    expect(second).not.toBeNull()
    expect(second).not.toBe(first)
    expect(line()).toBe(`Amount is as wide as a column goes: ${String(WIDEST)} pixels.`)
  })
})
