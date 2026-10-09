import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { FormEngine } from '@formancy/core'
import { previewEngine } from './engines.js'
import { generateExamples } from './examples.js'
import { AngularPane, ReactPane } from './panes.js'
import { FIXTURE_SNAPSHOT } from './snapshot.js'

/**
 * One preview pane at a time, around the renderer rather than through it.
 *
 * Found by role and accessible name (formancy.ai 0034), with one exception,
 * on purpose: the host element a failed Angular start must not leave behind is
 * an empty custom element, with no role and no name, so the accessibility tree
 * cannot say whether it is there. That one is read from the DOM, by its tag,
 * because the tag is the thing that must be gone.
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

    const alert = await screen.findByRole('alert', {}, { timeout: 10_000 })
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
      subscribe: (listener) => counted((inner) => engine.subscribe(() => { inner(); listener() })),
      subscribeField: (path, listener) => counted((inner) => engine.subscribeField(path, () => { inner(); listener() })),
    }

    const { unmount } = render(<AngularPane tableId="t" table="sales.order" engine={watched} sources={{}} />)
    unmount()

    await waitFor(() => expect(peak, 'Angular never started, so this checked nothing').toBeGreaterThan(0), { timeout: 10_000 })
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
