import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { computeAccessibleName } from 'dom-accessibility-api'
import type { FormEngine } from '@formancy/core'
import { decodeKeyToken } from '@formancy/data-core'
import { previewEngine } from './engines.js'
import { generateExamples } from './examples.js'
import { CAPTURED, lookupSources } from './lookup-source.js'
import { AngularPane, ReactPane } from './panes.js'
import { FIXTURE_SNAPSHOT } from './snapshot.js'
import { ANGULAR_ARRIVES } from './test-timing.js'

/**
 * One preview pane at a time, around the renderer rather than through it.
 *
 * Found by role and accessible name (formancy.ai 0034), with two exceptions,
 * on purpose. The host element a failed Angular start must not leave behind is
 * an empty custom element, with no role and no name, so the accessibility tree
 * cannot say whether it is there. That one is read from the DOM, by its tag,
 * because the tag is the thing that must be gone. And the active option of a
 * typeahead's list is the one its box's `aria-activedescendant` names, which
 * a screen reader is told and no query by role answers: so that attribute is
 * read, and the option it names is found by that id and known by its
 * accessible name. What a choice stores is read from the engine the test
 * holds, not from the page, because the box shows the label and only the
 * engine holds the token.
 */
afterEach(cleanup)

function orderEngine(renderer: 'react' | 'angular'): FormEngine {
  const order = generateExamples(FIXTURE_SNAPSHOT).find((example) => example.request.root.name === 'order')
  if (order === undefined) throw new Error('no order example')
  return previewEngine(order.generated.form, renderer)
}

describe('a preview pane', () => {
  // A bootstrap that throws leaves the Angular half blank, and a blank half
  // reads as a slow one. The pane says so where the form would have been, and
  // leaves no element behind for the next attempt to mount beside -- which
  // Angular would then mount into instead of its own.
  test('says on the page when the Angular renderer did not start, and leaves nothing behind', async () => {
    const engine = orderEngine('angular')
    const broken: FormEngine = {
      ...engine,
      schema: () => {
        throw new Error('the document could not be read')
      },
    }
    render(<AngularPane tableId="t" table="sales.order" engine={broken} sources={{}} />)

    const alert = await screen.findByRole('alert', {}, ANGULAR_ARRIVES)
    expect(alert.textContent).toBe('The Angular renderer did not start: the document could not be read')
    expect(document.querySelector('formancy-data-angular-preview')).toBeNull()
  })

  // Bootstrapping is asynchronous and an unmount is not: StrictMode unmounts
  // every pane once before Angular has arrived. The late application must tear
  // itself down, or it stays subscribed to an engine nobody shows -- invisible,
  // because its element left with the pane. Counted through the engine's own
  // subscriptions: some must have been made (so Angular did start), and none
  // may be left.
  test('an Angular preview unmounted before it started lets go of its engine', async () => {
    const engine = orderEngine('angular')
    let live = 0
    let peak = 0
    const counted = (subscribe: (listener: () => void) => () => void) => {
      live += 1
      peak = Math.max(peak, live)
      const off = subscribe(() => {})
      return () => {
        live -= 1
        off()
      }
    }
    const watched: FormEngine = {
      ...engine,
      subscribe: (listener) =>
        counted((inner) =>
          engine.subscribe(() => {
            inner()
            listener()
          }),
        ),
      subscribeField: (path, listener) =>
        counted((inner) =>
          engine.subscribeField(path, () => {
            inner()
            listener()
          }),
        ),
    }

    const { unmount } = render(<AngularPane tableId="t" table="sales.order" engine={watched} sources={{}} />)
    unmount()

    await waitFor(() => expect(peak, 'Angular never started, so this checked nothing').toBeGreaterThan(0), ANGULAR_ARRIVES)
    await waitFor(() => expect(live).toBe(0))
  })

  // The paper is a <form> so each renderer has its own form owner, and a form
  // the browser submitted would leave the page for an address nobody named.
  // There is no server behind a preview, so a submit goes nowhere at all.
  test('never lets the browser submit the paper', () => {
    render(<ReactPane tableId="t" table="sales.order" engine={orderEngine('react')} sources={{}} />)
    const paper = screen.getByRole('form', { name: 'sales.order, React preview' })
    // `fireEvent` answers false when a handler prevented the default.
    expect(fireEvent.submit(paper)).toBe(false)
  })
})

/** The accessible name of the option `box`'s `aria-activedescendant` names, or undefined when it names none. */
function activeOption(box: HTMLElement): string | undefined {
  const id = box.getAttribute('aria-activedescendant')
  const option = id === null ? null : document.getElementById(id)
  return option === null ? undefined : computeAccessibleName(option)
}

describe.each([
  ['React', 'react', ReactPane],
  ['Angular', 'angular', AngularPane],
] as const)('the customer typeahead under %s', (_name, renderer, Pane) => {
  // What a lookup stores is the token of the referenced key, never its label
  // (0012), and a typeahead is where the two could be confused: its box shows
  // the label the person chose. So the customer is chosen by the keyboard
  // alone, over the page's own sources, and the engine must hold the token of
  // Other Tenant GmbH's key, (2, 1001); a control that stored what its box
  // shows would hold "Other Tenant GmbH".
  //
  // Down until the box points at it, then Enter, never a fixed count of keys:
  // a closed typeahead opens on ArrowDown with its first match active, Muster
  // AG, but on none when its source has not answered yet (the renderers'
  // 250 ms debounce), so "ArrowDown and Enter" would store Muster AG's token,
  // or nothing, by the timing. The presses are bounded by the list's length,
  // so a box whose keys move nothing fails rather than loops.
  test('chosen by the keyboard, stores the token of the key and shows the label', async () => {
    const order = generateExamples(FIXTURE_SNAPSHOT).find((example) => example.request.root.name === 'order')
    if (order === undefined) throw new Error('no order example')
    const engine = previewEngine(order.generated.form, renderer)
    const sources = lookupSources(generateExamples(FIXTURE_SNAPSHOT), CAPTURED)
    render(<Pane tableId="t" table="sales.order" engine={engine} sources={sources} />)
    const user = userEvent.setup()

    const box = await screen.findByRole('combobox', { name: 'Customer' }, ANGULAR_ARRIVES)
    box.focus()
    await user.keyboard('{ArrowDown}')
    const list = await screen.findByRole('listbox', { name: 'Customer suggestions' })
    const offered = ['Muster AG', 'Other Tenant GmbH']
    await waitFor(() =>
      expect(
        within(list)
          .getAllByRole('option')
          .map((option) => computeAccessibleName(option)),
      ).toEqual(offered),
    )
    for (let pressed = 0; activeOption(box) !== 'Other Tenant GmbH'; pressed += 1) {
      if (pressed === offered.length) throw new Error(`${String(pressed)} presses of ArrowDown left the box pointing at ${activeOption(box) ?? 'no option'}`)
      const before = activeOption(box)
      await user.keyboard('{ArrowDown}')
      await waitFor(() => expect(activeOption(box)).not.toBe(before))
    }
    await user.keyboard('{Enter}')

    await waitFor(() => expect((box as HTMLInputElement).value).toBe('Other Tenant GmbH'))
    const stored = (engine.value() as Record<string, unknown>).customer
    expect(typeof stored === 'string' ? decodeKeyToken(stored) : stored).toEqual({ ok: true, values: ['2', '1001'] })
  })
})
