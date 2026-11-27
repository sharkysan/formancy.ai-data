import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { createFormEngine } from '@formancy/core'
import type { FormEngine } from '@formancy/core'
import type { FormSchema } from '@formancy/spec'
import { AngularForm } from './angular-mount.js'
import { OPEN_GLYPH } from './lookup-opens.js'
import type { LookupOffer, OpenChoice } from './lookup-opens.js'
import { ReactForm } from './react-form.js'
import { focusedName } from './test-accessible.js'

/**
 * A lookup's Opens in each renderer's paper, around the renderer as
 * angular-mount.test.tsx is: the first beside the field's box, through
 * formancy 0.14.0's place beside a select's or a typeahead's box (0157,
 * formancy.ai 0237), and the rest under the field, through its field
 * addition (0141), on the answer the engine holds now, and handed back to
 * the page when pressed. None needs a database, so the engine is over a
 * document of its own: a customer, a typeahead the offer names two forms
 * for; an order, a plain select it names one for; and a region, a select it
 * names none for. open-lookup.test.tsx holds the page to it against the
 * real server.
 *
 * Found by role and accessible name (formancy.ai 0034). Read off the DOM,
 * because the accessibility tree has nothing to say of it: the place beside
 * and the field around a box, which are a theme's parts with no role by
 * design (formancy.ai 0237); the glyph, hidden from the tree; the button's
 * `title`, the pointer's hint, which a browser may or may not expose; its
 * text, which the tree replaces by its `aria-label`; and `aria-disabled`,
 * which Testing Library's role queries do not filter on.
 */
afterEach(cleanup)

const DOCUMENT: FormSchema = {
  specVersion: '5',
  id: 'addition-test',
  title: 'Addition',
  model: {
    fields: [
      {
        key: 'customer',
        label: 'Customer',
        type: 'select',
        widget: 'typeahead',
        options: [
          { value: 'k1:7', label: 'Muster AG' },
          { value: 'k1:8', label: 'Beispiel KG' },
        ],
      },
      { key: 'order', label: 'Order', type: 'select', options: [{ value: 'k1:4711', label: '4711' }] },
      { key: 'region', label: 'Region', type: 'select', options: [{ value: 'k1:1', label: 'North' }] },
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
          { id: 'customers', title: 'Customers', label: 'Open in Customers' },
          { id: 'my-customers', title: 'My customers', label: 'Open in My customers' },
        ],
      },
      { field: 'order', forms: [{ id: 'orders', title: 'Orders', label: 'Open in Orders' }] },
    ],
    open: (field, choice, button) => void pressed.push({ field, choice, button }),
  }
}

/** Every Open under a field, by name: the ones that say it, where the one beside says nothing. */
function under(): string[] {
  return screen
    .queryAllByRole('button', { name: /^Open in / })
    .map((button) => button.textContent ?? '')
    .filter((text) => text !== '')
}

/** The Open beside a field's box, by the name it is given. */
const beside = (name: string): HTMLElement => screen.getByRole('button', { name })

/** Whether a button says it is unavailable. */
const unavailable = (button: HTMLElement): boolean => button.getAttribute('aria-disabled') === 'true'

/** The form drawn in `renderer`, once it has its Save. */
async function drawn(draw: Draw, engine: FormEngine, offer: LookupOffer, sheet: HTMLFormElement): Promise<void> {
  render(draw(engine, offer, sheet))
  await screen.findByRole('button', { name: 'Save' }, { timeout: 10_000 })
}

type Draw = (engine: FormEngine, offer: LookupOffer, sheet: HTMLFormElement) => ReactElement

const RENDERERS: ReadonlyArray<{ renderer: string; draw: Draw }> = [
  { renderer: 'React', draw: (engine, offer) => <ReactForm engine={engine} sources={{}} offer={offer} onSubmit={() => {}} /> },
  { renderer: 'Angular', draw: (engine, offer, sheet) => <AngularForm sheet={sheet} engine={engine} sources={{}} offer={offer} onSubmit={() => {}} /> },
]

describe.each(RENDERERS)('a lookup’s Opens in $renderer', ({ renderer, draw }) => {
  // The first form's Open sits beside the box of each lookup the offer
  // names, in the place the renderer gives the host there: a button of the
  // page's own, named and hinted with the label 0141 gives it, showing an
  // arrow out of a box and no words, which the theme sizes and colours --
  // nothing styled by the page on the paper (watched failing in each
  // renderer with no `fieldBeside` given to its form: no button named "Open
  // in Customers" beside the empty field).
  test('sits beside each lookup’s box, named and hinted by its first form, a glyph and no words', async () => {
    const engine = createFormEngine({ schema: DOCUMENT, formId: `beside-${renderer}` })
    const sheet = document.body.appendChild(document.createElement('form'))
    await drawn(draw, engine, offerTo([]), sheet)
    for (const name of ['Open in Customers', 'Open in Orders']) {
      const button = await waitFor(() => beside(name), { timeout: 10_000 })
      const glyph = button.querySelector('svg')
      expect(
        {
          place: button.parentElement?.getAttribute('data-formancy-part'),
          type: button.getAttribute('type'),
          title: button.getAttribute('title'),
          words: button.textContent,
          glyph: {
            hidden: glyph?.getAttribute('aria-hidden'),
            focusable: glyph?.getAttribute('focusable'),
            viewBox: glyph?.getAttribute('viewBox'),
            drawn: [...(glyph?.children ?? [])].map((child) => [child.tagName.toLowerCase(), child.getAttribute('d')]),
          },
          styled: [button, ...button.querySelectorAll('*')].filter((element) => element.hasAttribute('style')).length,
        },
        name,
      ).toEqual({
        place: 'field-beside',
        type: 'button',
        title: name,
        words: '',
        glyph: { hidden: 'true', focusable: 'false', viewBox: '0 0 16 16', drawn: [['path', OPEN_GLYPH]] },
        styled: 0,
      })
    }
    sheet.remove()
  })

  // While the field is empty the Open stays, so the box keeps its width,
  // and says it is unavailable -- `aria-disabled`, never `disabled`, which
  // would take it out of the keyboard's order; once the field answers, the
  // same button is available, and unavailable again when it is emptied
  // (watched failing with `disabled` in place of `aria-disabled`).
  test('is unavailable while its field is empty, and the same button is available once it answers', async () => {
    const engine = createFormEngine({ schema: DOCUMENT, formId: `beside-empty-${renderer}` })
    const sheet = document.body.appendChild(document.createElement('form'))
    await drawn(draw, engine, offerTo([]), sheet)
    const button = await waitFor(() => beside('Open in Customers'), { timeout: 10_000 })
    expect({ unavailable: unavailable(button), disabled: (button as HTMLButtonElement).disabled }).toEqual({ unavailable: true, disabled: false })
    engine.setValue(['customer'], 'k1:7')
    await waitFor(() => expect(unavailable(button)).toBe(false))
    expect(beside('Open in Customers')).toBe(button)
    engine.setValue(['customer'], '')
    await waitFor(() => expect(unavailable(button)).toBe(true))
    expect(beside('Open in Customers')).toBe(button)
    sheet.remove()
  })

  // A press on it while unavailable hands the page nothing; once the field
  // answers, the page is handed what 0141's first Open handed it -- the
  // lookup, the form, the token it reads by and the button, for the
  // keyboard to go back to (watched failing with the press handed on
  // whatever the answer: a choice with an empty token).
  test('hands the page nothing while unavailable, and the field, the form, the token and the button once available', async () => {
    const pressed: Pressed[] = []
    const engine = createFormEngine({ schema: DOCUMENT, formId: `beside-press-${renderer}` })
    const sheet = document.body.appendChild(document.createElement('form'))
    await drawn(draw, engine, offerTo(pressed), sheet)
    const button = await waitFor(() => beside('Open in Customers'), { timeout: 10_000 })
    button.click()
    engine.setValue(['customer'], 'k1:7')
    await waitFor(() => expect(unavailable(button)).toBe(false))
    expect(pressed).toEqual([])
    button.click()
    await waitFor(() => expect(pressed).toHaveLength(1))
    expect(pressed[0]).toEqual({
      field: 'customer',
      choice: { form: { id: 'customers', title: 'Customers' }, token: 'k1:7', label: 'Open in Customers' },
      button,
    })
    sheet.remove()
  })

  // The other forms' Opens stay under the field, as words, only while it
  // answers a token -- the engine's answer, never the one it was opened
  // with -- and none under a lookup of one form, whose Open is beside it
  // (watched failing with every Open drawn under the field, the first
  // twice; and with the addition not given to the renderer's form).
  test('draws the other Opens under the field on the answer it holds now, and no other', async () => {
    const engine = createFormEngine({ schema: DOCUMENT, formId: `addition-${renderer}` })
    const sheet = document.body.appendChild(document.createElement('form'))
    await drawn(draw, engine, offerTo([]), sheet)
    expect(under()).toEqual([])
    engine.setValue(['customer'], 'k1:7')
    engine.setValue(['order'], 'k1:4711')
    await waitFor(() => expect(under()).toEqual(['Open in My customers']))
    engine.setValue(['region'], 'k1:1')
    engine.setValue(['notes'], 'k1:7')
    engine.setValue(['customer'], '')
    await waitFor(() => expect(under()).toEqual([]))
    sheet.remove()
  })

  // An Open under the field hands the page its form, the token it reads by,
  // and the button (watched failing with the press handed nowhere).
  test('hands the page the form, the token and the button pressed under the field', async () => {
    const pressed: Pressed[] = []
    const engine = createFormEngine({ schema: DOCUMENT, formId: `addition-press-${renderer}` })
    engine.setValue(['customer'], 'k1:7')
    const sheet = document.body.appendChild(document.createElement('form'))
    await drawn(draw, engine, offerTo(pressed), sheet)
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

  // A select no form is named for is drawn as any other: its box alone in
  // the field, with nothing beside it (watched failing with the place beside
  // given to every field the renderer asks about, forms or none).
  test('draws nothing beside a field no form is named for', async () => {
    const engine = createFormEngine({ schema: DOCUMENT, formId: `beside-none-${renderer}` })
    const sheet = document.body.appendChild(document.createElement('form'))
    await drawn(draw, engine, offerTo([]), sheet)
    await waitFor(() => beside('Open in Orders'), { timeout: 10_000 })
    expect(screen.getByRole('combobox', { name: 'Region' }).parentElement?.getAttribute('data-formancy-part')).toBe('field')
    expect(screen.queryAllByRole('button', { name: /^Open / }).map((button) => button.getAttribute('aria-label'))).toEqual([
      'Open in Customers',
      'Open in Orders',
    ])
    sheet.remove()
  })

  // The keyboard reaches the Open right after the box, empty or answered.
  // A typeahead cleared and left with Tab commits its empty answer as it
  // loses the keyboard, which has just landed on the Open: the Open becomes
  // unavailable and keeps the keyboard, where a natively disabled one, or
  // one drawn again, would drop it to the page (watched failing in each
  // renderer with `disabled` in place of `aria-disabled`: the keyboard
  // skipped the empty order's Open for the next field; and in React with
  // the button drawn again as it empties: the one the keyboard was on never
  // became unavailable, another taking its place).
  test('takes the keyboard next after the box, and keeps it while a typeahead cleared and left with Tab empties', async () => {
    const user = userEvent.setup()
    const engine = createFormEngine({ schema: DOCUMENT, formId: `beside-keys-${renderer}` })
    engine.setValue(['customer'], 'k1:7')
    const sheet = document.body.appendChild(document.createElement('form'))
    await drawn(draw, engine, offerTo([]), sheet)
    const order = await waitFor(() => beside('Open in Orders'), { timeout: 10_000 })
    screen.getByRole('combobox', { name: 'Order' }).focus()
    await user.tab()
    expect({ focused: focusedName(), unavailable: unavailable(order) }).toEqual({ focused: 'Open in Orders', unavailable: true })

    const box = screen.getByRole<HTMLInputElement>('combobox', { name: 'Customer' })
    await waitFor(() => expect(box.value).toBe('Muster AG'))
    const open = beside('Open in Customers')
    box.focus()
    await user.tab()
    expect({ focused: document.activeElement === open, unavailable: unavailable(open) }).toEqual({ focused: true, unavailable: false })

    await user.click(box)
    await user.clear(box)
    await user.tab()
    await waitFor(() => expect(engine.getFieldSnapshot(['customer']).value ?? '').toBe(''))
    await waitFor(() => expect(unavailable(open)).toBe(true))
    expect({ focused: document.activeElement === open, name: focusedName() }).toEqual({ focused: true, name: 'Open in Customers' })
    sheet.remove()
  })
})
