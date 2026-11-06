import { afterEach, describe, expect, test } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { TabList } from './tab-list.js'
import type { TabEntry } from './tab-list.js'
import { audit, focusedName, unnamed } from './test-accessible.js'

/**
 * The record's tabs (0142) as WAI-ARIA's tabs pattern has them: one tab
 * stop, Left, Right, Home and End moving the selection with the keyboard
 * and Tab going on into the panel shown; each panel drawn the first time
 * its tab is, and kept, with what was typed in it, while another is shown;
 * and all of it forgotten for another record. None of it needs a database,
 * so the panels are a field each; record-tabs.test.tsx holds the page to
 * it against the real server.
 *
 * Found by role and accessible name (formancy.ai 0034).
 */

/** What a panel was handed to show its own tab, by the panel's key, as the latest render handed it. */
const shows = new Map<string, () => boolean>()

afterEach(() => {
  cleanup()
  shows.clear()
})

const entry = (key: string, name: string): TabEntry => ({
  key,
  name,
  panel: (show) => {
    shows.set(key, show)
    return <input aria-label={`${name} notes`} />
  },
})

const TABS = [entry('record', 'Order k1:7'), entry('lines', 'Order line'), entry('deliveries', 'Delivery')]

function Page({ start, tabs = TABS }: { start: unknown; tabs?: readonly TabEntry[] }): ReactElement {
  return (
    <main>
      <h3 id="heading">Order k1:7</h3>
      <TabList idBase="detail" labelledBy="heading" start={start} tabs={tabs} />
      <button type="button">After the tabs</button>
    </main>
  )
}

const tab = (name: string): HTMLElement => within(screen.getByRole('tablist', { name: 'Order k1:7' })).getByRole('tab', { name })
const selected = (): string[] => screen.getAllByRole('tab', { selected: true }).map((each) => each.textContent ?? '')

describe('the tabs beside a record', () => {
  // Automatic activation: an arrow selects the tab it moves to and shows
  // its panel. A row whose arrows only moved the focus would need Enter
  // after each, and its focused tab would say one thing while the panel
  // shown said another.
  test('select with Right, Left, Home and End, the keyboard on the tab selected', async () => {
    const user = userEvent.setup()
    render(<Page start={{}} />)
    await user.tab()
    expect(focusedName()).toBe('Order k1:7')
    await user.keyboard('{ArrowRight}')
    expect({ focused: focusedName(), selected: selected() }).toEqual({ focused: 'Order line', selected: ['Order line'] })
    expect(screen.getByRole('tabpanel', { name: 'Order line' })).toBeTruthy()
    expect(screen.queryByRole('tabpanel', { name: 'Order k1:7' })).toBeNull()
    await user.keyboard('{End}')
    expect({ focused: focusedName(), selected: selected() }).toEqual({ focused: 'Delivery', selected: ['Delivery'] })
    await user.keyboard('{ArrowRight}')
    expect({ focused: focusedName(), selected: selected() }).toEqual({ focused: 'Order k1:7', selected: ['Order k1:7'] })
    await user.keyboard('{ArrowLeft}')
    expect(selected()).toEqual(['Delivery'])
    await user.keyboard('{Home}')
    expect({ focused: focusedName(), selected: selected() }).toEqual({ focused: 'Order k1:7', selected: ['Order k1:7'] })
  })

  // The row is one tab stop: Tab from the tab selected goes into its panel
  // and Shift+Tab back. A row of tab stops would make a person walk every
  // child form to reach the record's own fields.
  test('is one tab stop, from which Tab goes into the panel shown', async () => {
    const user = userEvent.setup()
    render(<Page start={{}} />)
    await user.click(tab('Order line'))
    await user.tab()
    expect(focusedName()).toBe('Order line')
    expect(document.activeElement).toBe(screen.getByRole('tabpanel', { name: 'Order line' }))
    await user.tab()
    expect(focusedName()).toBe('Order line notes')
    await user.tab()
    expect(focusedName()).toBe('After the tabs')
    await user.tab({ shift: true })
    await user.tab({ shift: true })
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(tab('Order line'))
  })

  // A panel is drawn the first time its tab is shown -- a child grid asks
  // the server for nothing until a person looks at it -- and kept after,
  // so what was typed in it is there when its tab is shown again. A panel
  // drawn only while shown would lose that typing on every switch; one
  // drawn at once would ask for every child form's page with every record.
  test('draws a panel when its tab is first shown, and keeps it while another is', async () => {
    const user = userEvent.setup()
    render(<Page start={{}} />)
    expect(screen.queryByRole('textbox', { name: 'Order line notes', hidden: true })).toBeNull()
    await user.click(tab('Order line'))
    await user.type(screen.getByRole('textbox', { name: 'Order line notes' }), 'by Friday')
    await user.click(tab('Order k1:7'))
    expect(screen.queryByRole('textbox', { name: 'Order line notes' })).toBeNull()
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Order line notes', hidden: true }).value).toBe('by Friday')
    expect(screen.queryByRole('textbox', { name: 'Delivery notes', hidden: true })).toBeNull()
    await user.click(tab('Order line'))
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Order line notes' }).value).toBe('by Friday')
  })

  // Another record opens on its own tab, with none of the last record's
  // panels drawn: left on the last record's Order line, a person would see
  // the next record's lines where they asked for its form.
  test("starts again on the record's tab for another record", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Page start={{}} />)
    await user.click(tab('Order line'))
    rerender(<Page start={{}} />)
    expect(selected()).toEqual(['Order k1:7'])
    expect(screen.queryByRole('textbox', { name: 'Order line notes', hidden: true })).toBeNull()
  })

  // Nothing beside the record, no row: a tablist of one tab is a control
  // that does nothing, and the record's form is drawn as it always was.
  test('draws no tablist for the record alone', () => {
    render(<Page start={{}} tabs={TABS.slice(0, 1)} />)
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('tabpanel')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Order k1:7 notes' })).toBeTruthy()
  })

  // A deletion's question asked in a panel another tab hides must be on
  // screen to take the keyboard: the panel's `show` selects its tab and
  // says it was hidden, so the question waits a render; selected already,
  // it says so, and nothing waits.
  test("selects a panel's tab when the panel asks to be shown", async () => {
    const user = userEvent.setup()
    render(<Page start={{}} />)
    expect(shows.get('record')?.()).toBe(false)
    await user.click(tab('Order line'))
    let hidden: boolean | undefined
    act(() => {
      hidden = shows.get('record')?.()
    })
    expect({ hidden, selected: selected() }).toEqual({ hidden: true, selected: ['Order k1:7'] })
    expect(shows.get('record')?.()).toBe(false)
  })

  // The floor every state of the page is held to: axe, and a name on every
  // tab -- the row is named by the record's heading, each tab by its words
  // and each panel by its tab.
  test('passes axe with a name on every tab and panel', async () => {
    // What index.html gives the page, which axe reads of the document.
    document.documentElement.lang = 'en'
    document.title = 'Records'
    const user = userEvent.setup()
    render(<Page start={{}} />)
    await user.click(tab('Delivery'))
    expect(screen.getByRole('tabpanel', { name: 'Delivery' })).toBeTruthy()
    expect({ axe: await audit(), unnamed: unnamed() }).toEqual({ axe: [], unnamed: [] })
  })
})
