import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { DemoTools, useDemo } from './demo-tools.js'
import { PREFERENCES } from './prefs.js'
import type { RendererChoice } from './prefs.js'
import { audit, focusedName, unnamed } from './test-accessible.js'

/**
 * The demo's controls (0146): the renderer switch and opening a record by
 * its token, behind one disclosure at the end of the record's header,
 * closed until the viewer opens it and then as they left it, in their
 * browser. None of it needs a database, so the header is the controls
 * alone; choices.test.tsx and page.test.tsx hold the page to it against the
 * real server.
 *
 * Found by role and accessible name (formancy.ai 0034), and what the
 * browser keeps read from `localStorage`, which is the browser's, not the
 * page's tree.
 */

afterEach(() => {
  cleanup()
  localStorage.clear()
})

/** The record's header, as far as these controls go: the disclosure kept as the page keeps it, a renderer, and what Load was given. */
function Header({ refusal = null, loads = [] }: { refusal?: string | null; loads?: string[] }): ReactElement {
  const demo = useDemo()
  const [renderer, setRenderer] = useState<RendererChoice>('react')
  const loadRef = useRef<HTMLButtonElement>(null)
  return (
    <main>
      <h3>No record open</h3>
      <DemoTools
        formId="pg-order"
        open={demo.open}
        onToggle={demo.choose}
        renderer={renderer}
        onRenderer={setRenderer}
        refusal={refusal}
        loadRef={loadRef}
        onLoad={(token) => void loads.push(token)}
      />
      <button type="button" onClick={demo.reveal}>
        Refuse a Load
      </button>
    </main>
  )
}

const disclosure = (): HTMLElement => screen.getByRole('button', { name: 'For the demo' })

describe("the demo's controls", () => {
  // Out of the way: a person who arrives sees one button, said collapsed,
  // and none of the controls behind it, which are the demo's and not theirs
  // -- a radio or a box hidden from sight but left in the accessibility
  // tree would be a Tab stop nobody can see (watched failing with the panel
  // drawn open whatever the disclosure says: the Renderer group was there).
  test('are one closed disclosure until the viewer opens it', async () => {
    // What index.html gives the page, which axe reads of the document.
    document.documentElement.lang = 'en'
    document.title = 'Records'
    const user = userEvent.setup()
    render(<Header />)
    expect(disclosure().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('group', { name: 'Renderer' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Record token' })).toBeNull()
    await user.tab()
    expect(focusedName()).toBe('For the demo')
    await user.keyboard('{Enter}')
    expect(disclosure().getAttribute('aria-expanded')).toBe('true')
    expect(focusedName()).toBe('For the demo')
    for (const name of ['React', 'Angular', 'Both']) expect(screen.getByRole('radio', { name })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Record token' })).toBeTruthy()
    // The next Tab goes into what it opened, the renderer chosen first.
    await user.tab()
    expect(focusedName()).toBe('React')
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])
  })

  // Opened, it stays open for this viewer on the next page and form, and
  // closed, it stays closed: the page keeps the choice in the browser, as it
  // keeps the renderer (watched failing with the state left unkept: open,
  // then closed again on the next opening).
  test('stay as the viewer left them, in their browser', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Header />)
    await user.click(disclosure())
    expect(localStorage.getItem(PREFERENCES.demo)).toBe('open')
    unmount()
    render(<Header />)
    expect(disclosure().getAttribute('aria-expanded')).toBe('true')
    await user.click(disclosure())
    expect(localStorage.getItem(PREFERENCES.demo)).toBeNull()
  })

  // A Load refused elsewhere -- the delete's Load the saved record -- shows
  // them, so the refusal is seen, and keeps nothing: the page opened them,
  // the viewer did not, and the next page is as the viewer left it (watched
  // failing with the page's opening kept as the viewer's: "open" kept).
  test('shown by the page for a refusal, and not kept open', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Header />)
    await user.click(screen.getByRole('button', { name: 'Refuse a Load' }))
    expect(disclosure().getAttribute('aria-expanded')).toBe('true')
    expect(localStorage.getItem(PREFERENCES.demo)).toBeNull()
    unmount()
    render(<Header />)
    expect(disclosure().getAttribute('aria-expanded')).toBe('false')
  })

  // Load sends the token as typed, trimmed, and a refusal is said in an
  // alert inside what the disclosure shows (watched failing with the alert
  // left outside the panel: it was drawn under a closed disclosure).
  test('load a record by its token, and say a refusal where it was asked', async () => {
    const user = userEvent.setup()
    const loads: string[] = []
    const { rerender } = render(<Header loads={loads} refusal="No such record." />)
    expect(screen.queryByRole('alert')).toBeNull()
    await user.click(disclosure())
    await user.type(screen.getByRole('textbox', { name: 'Record token' }), ' k1:7 ')
    await user.click(screen.getByRole('button', { name: 'Load' }))
    expect(loads).toEqual(['k1:7'])
    rerender(<Header loads={loads} refusal="No such record." />)
    expect(screen.getByRole('alert').textContent).toBe('No such record.')
  })
})
