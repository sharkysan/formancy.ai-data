import type { LookupOpen, Refusal } from '@formancy/data-client'

/*
 * What a record's panes offer under a lookup (0141): one Open per form the
 * server names for the field (0140), on the answer the field holds now --
 * the engine's, so a person who picks another customer is offered that one,
 * saved or not -- and nothing where the answer is empty or no form is
 * named. Each opens the record one Drill down level below the one it was
 * pressed on (use-drill.ts). Pure: both renderers draw what it says.
 */

/** One Open: the form it opens the record in, the record's token, and what its button says. */
export interface OpenChoice {
  form: { id: string; title: string }
  token: string
  label: string
}

/** What a record's panes are given to offer Open under each lookup: the forms each opens in, as the server names them, and what a press does. */
export interface LookupOffer {
  opens: readonly LookupOpen[]
  /** Open pressed under the lookup `field`; `button` is the one pressed, which the keyboard goes back to when the person keeps editing. */
  open: (field: string, choice: OpenChoice, button: HTMLElement) => void
}

/**
 * The Opens under `field` while it answers `answer`: one per form the server
 * names for it, in its order; where two of them share a title, each says
 * its form's id too, as the Forms list names every form, so no two buttons
 * have one name. None for an answer that is not a token.
 */
export function openChoices(opens: readonly LookupOpen[], field: string, answer: unknown): OpenChoice[] {
  if (typeof answer !== 'string' || answer === '') return []
  const forms = opens.find((each) => each.field === field)?.forms ?? []
  const twins = (title: string): boolean => forms.filter((form) => form.title === title).length > 1
  return forms.map((form) => ({
    form: { id: form.id, title: form.title },
    token: answer,
    label: twins(form.title) ? `Open in ${form.title} (${form.id})` : `Open in ${form.title}`,
  }))
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
