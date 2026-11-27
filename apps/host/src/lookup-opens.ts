import type { LookupOpen, PublishedForm, Refusal } from '@formancy/data-client'
import { headingOf } from './heading.js'

/*
 * What a record's panes offer under a lookup (0141): one Open per form the
 * server names for the field (0140), on the answer the field holds now --
 * the engine's, so a person who picks another customer is offered that one,
 * saved or not -- and nothing where the answer is empty or no form is
 * named. Each opens the record one Drill down level below the one it was
 * pressed on (use-drill.ts). The first sits beside the field's box, there
 * while the answer is empty too, and the rest under the field (0157). Pure:
 * both renderers draw what it says.
 */

/** One Open: the form it opens the record in, the record's token, and what its button says. */
export interface OpenChoice {
  form: { id: string; title: string }
  token: string
  label: string
}

/** A lookup, and the forms its record opens in, each with what its Open says (`namedOpens`). */
export interface NamedOpen {
  field: string
  forms: ReadonlyArray<{ id: string; title: string; label: string }>
}

/** What a record's panes are given to offer Open under each lookup: the forms each opens in, as the server names them, and what a press does. */
export interface LookupOffer {
  opens: readonly NamedOpen[]
  /** Open pressed under the lookup `field`; `button` is the one pressed, which the keyboard goes back to when the person keeps editing. */
  open: (field: string, choice: OpenChoice, button: HTMLElement) => void
}

/**
 * What each Open of a record's panes says, decided once from the forms the
 * server names under each lookup and the fields' labels -- never from the
 * answers, so a name does not change as the person types. "Open in
 * <title>"; where another form named for the same lookup has that title,
 * its id after it, as the Forms list names every form: "Open in Order
 * (pg-order)"; where another lookup of the record opens in a form of that
 * title, the lookup's label before it: "Open Approved by in Employee". So
 * no two Opens of one pane share a name -- but under two lookups whose
 * labels are one.
 */
export function namedOpens(opens: readonly LookupOpen[], labelOf: (field: string) => string): NamedOpen[] {
  return opens.map(({ field, forms }) => ({
    field,
    forms: forms.map(({ id, title }) => {
      const twin = forms.some((other) => other.id !== id && other.title === title)
      const shared = opens.some((other) => other.field !== field && other.forms.some((form) => form.title === title))
      return { id, title, label: `Open${shared ? ` ${labelOf(field)}` : ''} in ${title}${twin ? ` (${id})` : ''}` }
    }),
  }))
}

/** The Opens a record's panes offer, named: its form's, but under the level's parent field where it has one (`opensBelow`), each lookup called by its heading. */
export function levelOpens(definition: PublishedForm, parentField: string | null): NamedOpen[] {
  return namedOpens(opensBelow(definition.opens, parentField), (field) => headingOf(definition, field))
}

/** The Opens of `field` while it answers `answer`: one per form named for it, in the server's order, as `namedOpens` names them. None for an answer that is not a token. */
export function openChoices(opens: readonly NamedOpen[], field: string, answer: unknown): OpenChoice[] {
  const token = tokenOf(answer)
  if (token === null) return []
  const forms = opens.find((each) => each.field === field)?.forms ?? []
  return forms.map(({ id, title, label }) => ({ form: { id, title }, token, label }))
}

/**
 * The Open beside a lookup's box (0157): its first form's, named as
 * `namedOpens` names it, and the record's token while the answer is one,
 * else `null` -- the Open is drawn then too, unavailable, so the box keeps
 * its width as an answer comes and goes.
 */
export interface BesideOpen {
  form: { id: string; title: string }
  label: string
  token: string | null
}

/** The Open beside `field`'s box while it answers `answer`: the first form named for it, the server's first; `null` where none is named. */
export function besideOpen(opens: readonly NamedOpen[], field: string, answer: unknown): BesideOpen | null {
  const first = opens.find((each) => each.field === field)?.forms[0]
  if (first === undefined) return null
  const { id, title, label } = first
  return { form: { id, title }, label, token: tokenOf(answer) }
}

/** What a press on the Open beside opens: the record its token names, or nothing while it has none. */
export function besideChoice({ form, label, token }: BesideOpen): OpenChoice | null {
  return token === null ? null : { form, token, label }
}

/** The Opens under `field` while it answers `answer`: `openChoices` but the first, which sits beside the box. */
export function underOpens(opens: readonly NamedOpen[], field: string, answer: unknown): OpenChoice[] {
  return openChoices(opens, field, answer).slice(1)
}

/**
 * The glyph the Open beside is drawn with, in a 16-unit square: an arrow
 * leaving a box, one path of two outlines, filled in the button's colour
 * and sized to its text by the theme (formancy.ai 0237). Both renderers
 * draw this one.
 */
export const OPEN_GLYPH = 'M7 3H1v12h12V9h-1.5v4.5h-9v-9H7zM9.5 1H15v5.5h-1.5V3.56L7.06 10 6 8.94l6.44-6.44H9.5z'

/** The record's token a lookup's answer is, or `null` for an empty answer or one that is no token. */
function tokenOf(answer: unknown): string | null {
  return typeof answer === 'string' && answer !== '' ? answer : null
}

/**
 * What a level says when the read behind an Open is refused. A form's row
 * filters can hide the record a lookup points at, and the server answers
 * that as no such record: said as the form not showing it. Anything else
 * is the server's sentence.
 */
export function openRefused(title: string, refusal: Pick<Refusal, 'code' | 'message'>): string {
  return refusal.code === 'not-found' ? `${title} does not show you this record.` : refusal.message
}

/**
 * The Opens a Drill down level offers: its form's, but under its parent
 * field, which holds the record the level above shows, drawn disabled --
 * Open there would open that record again a level further down. A level
 * reached through a lookup has no parent field, `null`.
 */
export function opensBelow(opens: readonly LookupOpen[], parentField: string | null): readonly LookupOpen[] {
  return opens.filter((open) => open.field !== parentField)
}
