import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import axe from 'axe-core'
import { computeAccessibleDescription, computeAccessibleName } from 'dom-accessibility-api'
import { ACCESSIBILITY_EXCLUSIONS, ACCESSIBILITY_TAGS, ACCESSIBILITY_UNMEASURABLE_IN_JSDOM } from '@formancy/conformance'
import { decodeKeyToken } from '@formancy/data-core'
import { App } from './app.js'
import { generateExamples } from './examples.js'
import type { Example } from './examples.js'
import { FIXTURE_SNAPSHOT } from './snapshot.js'

/**
 * One generated document, two renderers, and the claim that they agree.
 *
 * DATA-08 is "generated forms render and validate equivalently in Angular and
 * React", and the way that claim fails is quiet: a bootstrap that throws, a
 * provider that goes missing, a control one renderer names differently. Each
 * leaves the React half looking perfect. So every assertion below is made of
 * BOTH panes, and found by role and accessible name only (formancy.ai 0034) --
 * the markup is each package's own on purpose, so anything structural would
 * compare the wrong thing.
 *
 * The values come from the fixture's own edges, read from the snapshot rather
 * than retyped: the largest numeric(18,4) is what sales.order.amount's type
 * says it is.
 */
afterEach(cleanup)

const EXAMPLES = generateExamples(FIXTURE_SNAPSHOT)
const RENDERERS = ['React', 'Angular'] as const
type Renderer = (typeof RENDERERS)[number]

function example(table: string): Example {
  const found = EXAMPLES.find((candidate) => candidate.request.root.name === table)
  if (found === undefined) throw new Error(`no example for ${table}`)
  return found
}

function tableOf(subject: Example): string {
  return `${subject.request.root.schema}.${subject.request.root.name}`
}

/** A preview, by the name a screen reader moving by landmark hears. */
function pane(subject: Example, renderer: Renderer): HTMLElement {
  return screen.getByRole('region', { name: `${tableOf(subject)} ${renderer}` })
}

function labelsOf(subject: Example): string[] {
  return subject.generated.form.model.fields.map((field) => String(field.label))
}

/**
 * Mount the page and wait for every Angular preview to arrive.
 *
 * Angular bootstraps asynchronously, so for a moment the page has half its
 * forms. Waited for by the thing that proves it mounted -- a field, by name --
 * rather than by a timer, and the bootstrap's own alert is asserted absent.
 */
async function mounted(): Promise<void> {
  render(<App />)
  await waitFor(
    () => {
      for (const subject of EXAMPLES) {
        const first = labelsOf(subject)[0] ?? ''
        expect(within(pane(subject, 'Angular')).queryByLabelText(first), `the Angular ${tableOf(subject)} never rendered`).not.toBeNull()
      }
    },
    { timeout: 10_000 },
  )
  for (const subject of EXAMPLES) expect(within(pane(subject, 'Angular')).queryByRole('alert')).toBeNull()
}

/** Every form control in a pane, by its computed accessible name, sorted. */
function controlNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>('input, select, textarea')]
    .filter((control) => control.closest('[hidden]') === null)
    .map((control) => computeAccessibleName(control))
    .sort()
}

/** The one control in a pane with this accessible name. */
function control(subject: Example, renderer: Renderer, name: string): HTMLElement {
  const found = within(pane(subject, renderer)).getByLabelText(name)
  expect(computeAccessibleName(found)).toBe(name)
  return found
}

/**
 * What a person, or a screen reader, is told about a control's answer: whether
 * it is invalid, and the error the renderer describes it with. The released
 * renderers write the engine's error codes as that text, which is what makes
 * "the same code" observable without reaching into either engine.
 */
function verdict(element: HTMLElement): { invalid: boolean; describedAs: string } {
  return {
    invalid: element.getAttribute('aria-invalid') === 'true',
    describedAs: computeAccessibleDescription(element),
  }
}

describe.each(EXAMPLES.map((subject) => [tableOf(subject), subject] as const))('%s', (_table, subject) => {
  // The founding claim at its plainest. A renderer that dropped a field type,
  // missed a label or named a control differently would make these two lists
  // differ -- and as an equality with the generated labels, a field the
  // generator emitted and NEITHER renderer drew fails too.
  test('both renderers render every generated field, by accessible name, and nothing else', async () => {
    await mounted()
    const expected = [...labelsOf(subject)].sort()
    expect(expected.length).toBeGreaterThan(3)
    for (const renderer of RENDERERS) {
      expect({ renderer, names: controlNames(pane(subject, renderer)) }).toEqual({ renderer, names: expected })
    }
  })

  // An empty answer to a required field is the commonest error there is, and
  // the two renderers must say so identically: the same fields, the same code.
  // Asserted for every field the generator made required, after each pane's
  // own submit, so the check runs the path a person takes.
  test('every required field left empty is "required" in both', async () => {
    await mounted()
    const user = userEvent.setup()
    const required = subject.generated.form.model.fields.filter((field) => field.required === true)
    expect(required.length).toBeGreaterThan(0)

    for (const renderer of RENDERERS) {
      await user.click(within(pane(subject, renderer)).getByRole('button', { name: 'Validate' }))
      await waitFor(() => {
        const seen = required.map((field) => ({ field: field.label, ...verdict(control(subject, renderer, String(field.label))) }))
        expect({ renderer, seen }).toEqual({
          renderer,
          seen: required.map((field) => ({ field: field.label, invalid: true, describedAs: 'required' })),
        })
      })
    }
  })

  // axe is the floor and not the claim (it finds roughly half of what is
  // machine-detectable), and it is run in the configuration both renderers are
  // held to upstream, imported from @formancy/conformance rather than copied.
  // Twice: clean, and after a failed submit, because the error wiring --
  // aria-describedby to an element that appears -- is where it goes wrong.
  test('axe finds nothing in either preview, clean and after a failed submit', async () => {
    await mounted()
    const user = userEvent.setup()
    const options = {
      runOnly: { type: 'tag' as const, values: [...ACCESSIBILITY_TAGS] },
      rules: Object.fromEntries(
        [...Object.keys(ACCESSIBILITY_EXCLUSIONS), ...Object.keys(ACCESSIBILITY_UNMEASURABLE_IN_JSDOM)].map((rule) => [
          rule,
          { enabled: false },
        ]),
      ),
    }
    const violations = async (renderer: Renderer): Promise<string[]> => {
      const results = await axe.run(pane(subject, renderer), options)
      return results.violations.map((violation) => `${renderer} ${violation.id}: ${violation.nodes[0]?.html ?? ''}`)
    }

    for (const renderer of RENDERERS) expect(await violations(renderer)).toEqual([])
    for (const renderer of RENDERERS) await user.click(within(pane(subject, renderer)).getByRole('button', { name: 'Validate' }))
    await waitFor(() => {
      expect(within(pane(subject, 'Angular')).getAllByText('required').length).toBeGreaterThan(0)
    })
    for (const renderer of RENDERERS) expect(await violations(renderer)).toEqual([])
  })
})

describe('sales.order, at the edges the fixture inserts', () => {
  // numeric(18,4) holds eighteen digits and a JavaScript number fifteen to
  // seventeen, which is why the generator makes it text with an exact pattern
  // (0009). The claim worth having is that BOTH renderers accept the largest
  // value the column holds and refuse one fractional digit more, with the same
  // code -- a renderer that coerced to number would accept the first only after
  // rounding it, and one that skipped the pattern would accept the second.
  //
  // Validate first, because that is the path a person takes to see a verdict:
  // the released engine checks answers once the form has been submitted, and
  // on every change after that (`runValidation` in @formancy/core 0.3.0). Typed
  // into an untouched form, both renderers rightly show nothing yet, and this
  // test would pass by checking nothing -- which is how its first version
  // failed, on the second value.
  test('the largest amount is valid in both, and one fractional digit more is "pattern" in both', async () => {
    await mounted()
    const user = userEvent.setup()
    const order = example('order')
    const amount = FIXTURE_SNAPSHOT.objects
      .find((object) => object.ref.name === 'order')
      ?.columns.find((column) => column.name === 'amount')?.type
    if (amount?.kind !== 'decimal' || amount.precision === null || amount.scale === null) {
      throw new Error('sales.order.amount is not an exact decimal with a precision and scale')
    }
    expect([amount.precision, amount.scale]).toEqual([18, 4])
    const largest = `${'9'.repeat(amount.precision - amount.scale)}.${'9'.repeat(amount.scale)}`

    for (const renderer of RENDERERS) {
      const field = control(order, renderer, 'Amount')
      await user.click(within(pane(order, renderer)).getByRole('button', { name: 'Validate' }))
      await waitFor(() => expect({ renderer, ...verdict(field) }).toEqual({ renderer, invalid: true, describedAs: 'required' }))

      await user.clear(field)
      await user.type(field, largest)
      await user.tab()
      await waitFor(() => expect({ renderer, ...verdict(field) }).toEqual({ renderer, invalid: false, describedAs: '' }))

      await user.clear(field)
      await user.type(field, `${largest}9`)
      await user.tab()
      await waitFor(() => expect({ renderer, ...verdict(field) }).toEqual({ renderer, invalid: true, describedAs: 'pattern' }))
    }
  })

  // The lookup is a select over the host's source, and what it stores is the
  // token of the referenced key, never the label (0012). Both renderers get the
  // same source; each must offer both customers and store the same token.
  test('both renderers offer the two captured customers and store the token of the chosen key', async () => {
    await mounted()
    const user = userEvent.setup()
    const order = example('order')

    for (const renderer of RENDERERS) {
      const customer = within(pane(order, renderer)).getByRole('combobox', { name: 'Customer' })
      await waitFor(() => {
        const offered = within(customer)
          .getAllByRole('option')
          .map((option) => option.textContent)
        expect({ renderer, offered }).toEqual({ renderer, offered: ['', 'Muster AG', 'Other Tenant GmbH'] })
      })
      await user.selectOptions(customer, within(customer).getByRole('option', { name: 'Other Tenant GmbH' }))
      await waitFor(() => {
        expect({ renderer, stored: decodeKeyToken((customer as HTMLSelectElement).value) }).toEqual({
          renderer,
          stored: { ok: true, values: ['2', '1001'] },
        })
      })
    }
  })
})

describe('a lookup with no rows on this page', () => {
  // Without a source, the released renderers draw a sentence where the chooser
  // would be -- the honest fallback, and the one an Angular host that forgot
  // the provider would show. Both renderers must show it, neither an empty
  // chooser, and the note beside the form must say the same thing.
  test('is said in both renderers and in the note, never offered as an empty chooser', async () => {
    render(<App captured={[]} />)
    const order = example('order')
    await waitFor(
      () => {
        for (const renderer of RENDERERS) {
          expect(within(pane(order, renderer)).queryByLabelText('Order date'), `${renderer} never rendered`).not.toBeNull()
        }
      },
      { timeout: 10_000 },
    )

    for (const renderer of RENDERERS) {
      const preview = pane(order, renderer)
      expect(within(preview).queryByRole('combobox', { name: 'Customer' })).toBeNull()
      expect(preview.textContent).toContain(`which this application has not provided`)
    }
    const section = screen.getByRole('region', { name: tableOf(order) })
    expect(within(section).getByRole('note').textContent).toMatch(/has no source on this page/)
  })
})

describe('the page as a whole', () => {
  // Four engines over two documents on one page. Element ids are minted from
  // the form id, so two renderers of one document emit every id twice unless
  // each engine has its own namespace -- and then `label[for]` resolves to the
  // FIRST match, so the second renderer's fields lose their names entirely
  // (formancy.ai 0095). Asserted across the whole page, the only place the
  // collision exists.
  test('no two elements share an id', async () => {
    await mounted()
    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id)
    expect([...new Set(ids.filter((id, at) => ids.indexOf(id) !== at))]).toEqual([])
  })
})
