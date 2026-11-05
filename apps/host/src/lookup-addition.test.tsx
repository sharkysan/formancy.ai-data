import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { createFormEngine } from '@formancy/core'
import type { FormEngine } from '@formancy/core'
import type { FormSchema } from '@formancy/spec'
import { AngularForm } from './angular-mount.js'
import type { LookupOffer, OpenChoice } from './lookup-opens.js'
import { ReactForm } from './react-form.js'

/**
 * The Opens under a lookup in each renderer's paper (0141), around the
 * renderer as angular-mount.test.tsx is: drawn through formancy 0.13.0's
 * field addition under the field the offer names, on the answer the engine
 * holds now, and handed back to the page when pressed. None needs a
 * database, so the engine is over a document of its own: a customer the
 * offer names two forms for, and notes it names none for.
 * open-lookup.test.tsx holds the page to it against the real server.
 *
 * Found by role and accessible name (formancy.ai 0034).
 */
afterEach(cleanup)

const DOCUMENT: FormSchema = {
  specVersion: '3',
  id: 'addition-test',
  title: 'Addition',
  model: {
    fields: [
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'text' },
    ],
  },
}

/** What a press handed the page: the field, the form and token chosen, and the button pressed. */
interface Pressed {
  field: string
  choice: OpenChoice
  button: HTMLElement
}

function offerTo(pressed: Pressed[]): LookupOffer {
  return {
    opens: [
      {
        field: 'customer',
        forms: [
          { id: 'customers', title: 'Customers' },
          { id: 'my-customers', title: 'My customers' },
        ],
      },
    ],
    open: (field, choice, button) => void pressed.push({ field, choice, button }),
  }
}

/** Every Open drawn, by name. */
function opens(): string[] {
  return screen.queryAllByRole('button', { name: /^Open in / }).map((button) => button.textContent ?? '')
}

const RENDERERS: ReadonlyArray<{ renderer: string; draw: (engine: FormEngine, offer: LookupOffer, sheet: HTMLFormElement) => ReactElement }> = [
  { renderer: 'React', draw: (engine, offer) => <ReactForm engine={engine} sources={{}} offer={offer} onSubmit={() => {}} /> },
  { renderer: 'Angular', draw: (engine, offer, sheet) => <AngularForm sheet={sheet} engine={engine} sources={{}} offer={offer} onSubmit={() => {}} /> },
]

describe.each(RENDERERS)('the Opens under a lookup in $renderer', ({ renderer, draw }) => {
  // Nothing under an empty lookup; one Open per form under it once it
  // answers a token, and none under a field the offer names no form for;
  // gone again when it is emptied -- the engine's answer, never the one it
  // was opened with (watched failing with the addition not given to the
  // renderer's form: no Open at all).
  test('are drawn under the lookup on the answer it holds now, and under no other field', async () => {
    const engine = createFormEngine({ schema: DOCUMENT, formId: `addition-${renderer}` })
    const sheet = document.body.appendChild(document.createElement('form'))
    render(draw(engine, offerTo([]), sheet))
    await screen.findByRole('button', { name: 'Save' }, { timeout: 10_000 })
    expect(opens()).toEqual([])
    engine.setValue(['customer'], 'k1:7')
    await waitFor(() => expect(opens()).toEqual(['Open in Customers', 'Open in My customers']))
    engine.setValue(['notes'], 'k1:7')
    engine.setValue(['customer'], '')
    await waitFor(() => expect(opens()).toEqual([]))
    sheet.remove()
  })

  // A press hands the page the lookup, the form and the token it reads by,
  // and the button, for the keyboard to go back to when the person keeps
  // editing (watched failing with the press handed nowhere).
  test('hand the page the form, the token and the button pressed', async () => {
    const pressed: Pressed[] = []
    const engine = createFormEngine({ schema: DOCUMENT, formId: `addition-press-${renderer}` })
    engine.setValue(['customer'], 'k1:7')
    const sheet = document.body.appendChild(document.createElement('form'))
    render(draw(engine, offerTo(pressed), sheet))
    const button = await screen.findByRole('button', { name: 'Open in My customers' }, { timeout: 10_000 })
    button.click()
    await waitFor(() => expect(pressed).toHaveLength(1))
    expect(pressed[0]).toEqual({
      field: 'customer',
      choice: { form: { id: 'my-customers', title: 'My customers' }, token: 'k1:7', label: 'Open in My customers' },
      button,
    })
    sheet.remove()
  })
})
