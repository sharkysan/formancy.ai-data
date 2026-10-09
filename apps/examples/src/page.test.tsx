import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import axe from 'axe-core'
import { computeAccessibleName } from 'dom-accessibility-api'
import { ACCESSIBILITY_EXCLUSIONS, ACCESSIBILITY_TAGS, ACCESSIBILITY_UNMEASURABLE_IN_JSDOM } from '@formancy/conformance'
import type { GenerationNote } from '@formancy/data-core'
import { App } from './app.js'
import { generateExamples } from './examples.js'
import type { Example } from './examples.js'
import { NOTE_KINDS } from './notes.js'
import { FIXTURE_SNAPSHOT } from './snapshot.js'
import { ANSWERING_ROLES, answerable, paragraphs } from './test-accessible.js'

/**
 * The page around the previews: what it says, and whether it can be used.
 *
 * Saying what was chosen is the product (0009), so the generator's notes are
 * asserted as content, kind by kind, beside the form they explain. The rest
 * is the floor any page here is held to: reachable by keyboard, every control
 * named, and an audit of the whole document -- including the page-level rules
 * a form fragment is excused from, because this is a page.
 *
 * Everything is found in the accessibility tree, by role and accessible name
 * (formancy.ai 0034); a sentence, which may not be named, by its role as a
 * paragraph. What jsdom cannot show at all -- layout, the keyboard path in a
 * real browser, colour -- is `scripts/browser-test.mjs`'s.
 */
afterEach(cleanup)

const EXAMPLES = generateExamples(FIXTURE_SNAPSHOT)

function tableOf(subject: Example): string {
  return `${subject.request.root.schema}.${subject.request.root.name}`
}

function section(subject: Example): HTMLElement {
  return screen.getByRole('region', { name: tableOf(subject) })
}

/**
 * The document the page is served as, applied to jsdom's.
 *
 * The test mounts into jsdom's own document, which has no language and no
 * title; index.html has both. Copied from the file rather than set by hand, so
 * the audit below checks the attributes the page is actually served with.
 */
beforeEach(() => {
  const served = new DOMParser().parseFromString(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8'), 'text/html')
  document.documentElement.lang = served.documentElement.lang
  document.title = served.title
})

/**
 * What a person operates on the page, from the accessibility tree: its links
 * and buttons, and every control in every preview.
 */
function operable(): HTMLElement[] {
  const names = EXAMPLES.flatMap((subject) => subject.generated.form.model.fields.map((field) => String(field.label)))
  return [...screen.queryAllByRole('link'), ...screen.queryAllByRole('button'), ...answerable(document.body, names)]
}

async function mounted(): Promise<void> {
  render(<App />)
  await waitFor(
    () => {
      for (const subject of EXAMPLES) {
        const angular = screen.getByRole('region', { name: `${tableOf(subject)} Angular` })
        const first = String(subject.generated.form.model.fields[0]?.label ?? '')
        expect(within(angular).queryByLabelText(first)).not.toBeNull()
      }
    },
    { timeout: 10_000 },
  )
}

describe('the generator says what it chose, beside each form', () => {
  // A form shown without its notes hides every decision a reviewer has to
  // check: a column left out, a field that will never be written, an update
  // that is not offered. Each kind is its own list, named, and holds exactly
  // the generator's notes of that kind, in the generator's order.
  test.each(EXAMPLES.map((subject) => [tableOf(subject), subject] as const))('%s', async (_table, subject) => {
    await mounted()
    const notes = within(section(subject)).getByRole('region', { name: `${tableOf(subject)} What the generator chose` })

    for (const kind of NOTE_KINDS) {
      const expected = subject.generated.notes.filter((note: GenerationNote) => note.kind === kind.kind)
      const list = within(notes).queryByRole('list', { name: kind.heading })
      if (expected.length === 0) {
        // An empty kind is said, not omitted: "nothing was excluded" is a
        // finding, and a missing heading reads as a page that forgot.
        expect(list).toBeNull()
        expect(paragraphs(notes)).toContain(kind.none)
        continue
      }
      expect(list, `${kind.heading} is missing`).not.toBeNull()
      const items = within(list as HTMLElement)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
      expect(items).toEqual(expected.map((note) => `${note.subject} ${note.message}`))
    }
  })

  // What can be done with the form at all is a fact of the bindings, and it is
  // printed from them -- a page that said "create and update" for a table
  // whose update is blocked would contradict the blocked note beside it.
  test.each(EXAMPLES.map((subject) => [tableOf(subject), subject] as const))(
    '%s says which operations the bindings offer',
    async (_table, subject) => {
      await mounted()
      const { create, update } = subject.generated.bindings.operations
      const said = within(section(subject)).getByRole('list', { name: 'Operations' })
      expect(within(said).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
        `Create: ${create ? 'offered' : 'not offered'}`,
        `Update: ${update ? 'offered' : 'not offered'}`,
      ])
    },
  )

  // The customer list is not the server's yet, and a page that did not say so
  // would be demonstrating a lookup that does not exist.
  test('says the customer list is in memory until the server has a lookup route', async () => {
    await mounted()
    const order = EXAMPLES.find((subject) => subject.request.root.name === 'order')
    if (order === undefined) throw new Error('no order example')
    expect(within(section(order)).getByRole('note').textContent).toMatch(
      /in memory.*until the server.s lookup route exists/i,
    )
  })

  // The version is printed from the snapshot, never typed: the page says which
  // server the forms were generated from, and that changes with a re-capture.
  test('names the server the snapshot was captured from', async () => {
    await mounted()
    expect(screen.getByRole('banner').textContent).toContain(`PostgreSQL ${FIXTURE_SNAPSHOT.serverVersion}`)
  })
})

describe('the page can be used without a mouse or a screen', () => {
  // Keyboard first: every control a person can operate is reached by Tab, in
  // both previews of both forms. A control focusable only by click -- or a
  // preview that traps focus -- is missing from this set.
  test('Tab reaches every enabled control on the page', async () => {
    await mounted()
    const user = userEvent.setup()
    const enabled = operable().filter((element) => !(element as HTMLInputElement).disabled)
    expect(enabled.length).toBeGreaterThan(20)

    const reached = new Set<Element>()
    for (let step = 0; step < enabled.length + 5; step += 1) {
      await user.tab()
      if (document.activeElement !== null) reached.add(document.activeElement)
    }
    expect(enabled.filter((element) => !reached.has(element)).map((element) => computeAccessibleName(element))).toEqual([])
  })

  // axe does not notice a control named by something useless, and says
  // nothing about one it thinks is named; computing every name with a real
  // implementation and refusing an empty one does.
  //
  // By role alone, and deliberately not through `answerable`'s names: a
  // control found by its name is named by construction. An input ARIA gives
  // no role and nobody named is invisible to the tree, and axe's `label` rule,
  // in the WCAG run below, is what refuses that one.
  test('every control and link has an accessible name', async () => {
    await mounted()
    const unnamed = (['link', 'button', ...ANSWERING_ROLES] as const)
      .flatMap((role) => screen.queryAllByRole(role))
      .filter((element) => computeAccessibleName(element).trim() === '')
      .map((element) => element.outerHTML.slice(0, 80))
    expect(unnamed).toEqual([])
  })

  // This IS a page, so nothing a mounted form is excused from upstream is
  // excused here: the whole document at WCAG 2.2 AA, with only what jsdom
  // cannot measure switched off, for upstream's reason.
  test('axe finds nothing in the whole document at WCAG 2.2 AA', async () => {
    await mounted()
    const results = await axe.run(document, {
      runOnly: { type: 'tag', values: [...ACCESSIBILITY_TAGS] },
      rules: Object.fromEntries(Object.keys(ACCESSIBILITY_UNMEASURABLE_IN_JSDOM).map((rule) => [rule, { enabled: false }])),
    })
    expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes[0]?.html ?? ''}`)).toEqual([])
  })

  // The rules @formancy/conformance excludes as "about a PAGE" -- one main,
  // one h1, everything inside a landmark, landmarks told apart -- are mostly
  // axe best-practice rules, so the WCAG run above never asks them. Named here
  // by id, because four previews on one page is exactly where two regions end
  // up with one name and somebody moving by landmark cannot tell them apart.
  test('axe finds nothing wrong with the page structure', async () => {
    await mounted()
    const results = await axe.run(document, {
      runOnly: { type: 'rule', values: Object.keys(ACCESSIBILITY_EXCLUSIONS) },
    })
    expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes[0]?.html ?? ''}`)).toEqual([])
  })
})
