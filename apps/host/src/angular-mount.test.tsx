import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { createFormEngine } from '@formancy/core'
import type { FormEngine } from '@formancy/core'
import type { FormSchema } from '@formancy/spec'
import { AngularForm } from './angular-mount.js'

/**
 * The Angular half of a pane, around the renderer rather than through it, as
 * the examples page tests its own: what happens when Angular does not start,
 * and when the pane goes before Angular has arrived. Neither needs a
 * database, so the engine is over a one-field document of its own.
 *
 * Found by role and accessible name (formancy.ai 0034), with the examples'
 * one exception, on purpose: the host element a failed start must not leave
 * behind is an empty custom element with no role and no name, so the
 * accessibility tree cannot say whether it is there. It is read from the DOM,
 * by its tag, because the tag is the thing that must be gone.
 */
afterEach(cleanup)

const DOCUMENT: FormSchema = { specVersion: '3', id: 'mount-test', title: 'Mount', model: { fields: [{ key: 'name', label: 'Name', type: 'text' }] } } as FormSchema

function engine(): FormEngine {
  return createFormEngine({ schema: DOCUMENT, formId: 'mount-test-angular' })
}

describe('the Angular half of a pane', () => {
  // A bootstrap that throws leaves the Angular half blank, and a blank half
  // reads as a slow one. The pane says so where the form would have been and
  // leaves no element behind for the next attempt to mount beside.
  test('says on the page when the Angular renderer did not start, and leaves nothing behind', async () => {
    const working = engine()
    const broken: FormEngine = {
      ...working,
      schema: () => {
        throw new Error('the document could not be read')
      },
    }
    const sheet = document.body.appendChild(document.createElement('form'))
    render(<AngularForm sheet={sheet} engine={broken} sources={{}} onSubmit={() => {}} />)
    const alert = await screen.findByRole('alert', {}, { timeout: 10_000 })
    expect(alert.textContent).toBe('The Angular renderer did not start: the document could not be read')
    expect(document.querySelector('formancy-data-host-form')).toBeNull()
    sheet.remove()
  })

  // Bootstrapping is asynchronous and an unmount is not: StrictMode unmounts
  // every pane once before Angular has arrived, and so does a Load pressed
  // while it starts. The late application must tear itself down, or it stays
  // subscribed to an engine nobody shows. Counted through the engine's own
  // subscriptions: some must have been made, so Angular did start, and none
  // may be left.
  test('a pane unmounted before Angular started lets go of its engine', async () => {
    const inner = engine()
    let live = 0
    let peak = 0
    const counted = (subscribe: (listener: () => void) => () => void): (() => void) => {
      live += 1
      peak = Math.max(peak, live)
      const off = subscribe(() => {})
      return () => {
        live -= 1
        off()
      }
    }
    const watched: FormEngine = {
      ...inner,
      subscribe: (listener) => counted(() => inner.subscribe(listener)),
      subscribeField: (path, listener) => counted(() => inner.subscribeField(path, listener)),
    }
    const sheet = document.body.appendChild(document.createElement('form'))
    const { unmount } = render(<AngularForm sheet={sheet} engine={watched} sources={{}} onSubmit={() => {}} />)
    unmount()
    await waitFor(() => expect(peak, 'Angular never started, so this checked nothing').toBeGreaterThan(0), { timeout: 10_000 })
    await waitFor(() => expect(live).toBe(0))
    expect(document.querySelector('formancy-data-host-form')).toBeNull()
    sheet.remove()
  })

  // The save Angular calls is the pane's current one, read through a ref: a
  // pane that re-rendered with a new handler must not leave Angular calling
  // the first -- which would answer for a record the pane no longer holds.
  test('a submit reaches the handler the pane holds now, not the one it started with', async () => {
    const sheet = document.body.appendChild(document.createElement('form'))
    const calls: string[] = []
    const subject = engine()
    // One map, as a session holds one: a new map is a new application.
    const sources = {}
    const { rerender } = render(<AngularForm sheet={sheet} engine={subject} sources={sources} onSubmit={() => calls.push('first')} />)
    const save = await screen.findByRole('button', { name: 'Save' }, { timeout: 10_000 })
    rerender(<AngularForm sheet={sheet} engine={subject} sources={sources} onSubmit={() => calls.push('second')} />)
    save.click()
    await waitFor(() => expect(calls).toEqual(['second']))
    sheet.remove()
  })
})
