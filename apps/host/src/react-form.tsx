import { useMemo } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { FormEngine } from '@formancy/core'
import { ErrorSummary, FormancyForm, FormancyProvider, OptionsSourcesProvider, useField } from '@formancy/react'
import type { OptionsSources, SubmitOutcome } from '@formancy/react'
import { besideChoice, besideOpen, OPEN_GLYPH, underOpens } from './lookup-opens.js'
import type { LookupOffer } from './lookup-opens.js'

/**
 * The React renderer's half of a pane: the error summary, then the form, with
 * "Save" as its submit -- the Angular pane's two parts, in its order.
 *
 * The summary is the host's to place: `FormancyForm` includes none. It focuses
 * itself when errors appear, after the engine refuses a submit and after the
 * server names a field, and names each problem by its field's label, which
 * both renderers read from the document since 0.4.0. The layout is the
 * document's own, as the Angular half reads it.
 *
 * Beside the box of each lookup the `offer` names forms for, in the place
 * the renderer gives a host there (formancy 0.14.0), the first form's Open,
 * a button showing a glyph, named by its label and unavailable while the
 * field is empty; under the field, in its field addition (formancy 0.13.0),
 * the other forms' Opens (0141, 0157). Both are dressed by the theme: the
 * page adds no rule inside the paper. Each is made once per offer, which is
 * the session's, since a new function each render would redraw every
 * field's, and the one beside a lookup is given whatever its answer, since
 * content that comes and goes draws the box again and takes the keyboard
 * from a person in it (formancy.ai 0237).
 *
 * `sources` is `lookupSources(...)` from `@formancy/data-client`, typed here as
 * this renderer's own `OptionsSources`: this file's type check is the one that
 * fails when that stops fitting (0029).
 */
export function ReactForm({
  engine,
  sources,
  offer,
  submitLabel = 'Save',
  onSubmit,
}: {
  engine: FormEngine
  sources: OptionsSources
  /** Open under each lookup it names (0141); none where the pane offers none. */
  offer?: LookupOffer | undefined
  /** What the submit says: Save, or a together row's Done, which sends nothing (0155). */
  submitLabel?: string
  onSubmit: (outcome: SubmitOutcome) => void
}): ReactElement {
  const layout = engine.schema().layouts?.[0]?.name
  const fieldAddition = useMemo(() => {
    if (offer === undefined) return undefined
    const named = new Set(offer.opens.map((each) => each.field))
    return (path: string): ReactNode => (named.has(path) ? <LookupOpens path={path} offer={offer} /> : null)
  }, [offer])
  const fieldBeside = useMemo(() => {
    if (offer === undefined) return undefined
    const named = new Set(offer.opens.filter((each) => besideOpen(offer.opens, each.field, null) !== null).map((each) => each.field))
    return (path: string): ReactNode => (named.has(path) ? <LookupBeside path={path} offer={offer} /> : null)
  }, [offer])
  return (
    <OptionsSourcesProvider value={sources}>
      <FormancyProvider engine={engine}>
        <ErrorSummary />
        <FormancyForm
          {...(layout === undefined ? {} : { layout })}
          {...(fieldAddition === undefined ? {} : { fieldAddition })}
          {...(fieldBeside === undefined ? {} : { fieldBeside })}
          submitLabel={submitLabel}
          onSubmit={onSubmit}
        />
      </FormancyProvider>
    </OptionsSourcesProvider>
  )
}

/**
 * The Open beside one lookup's box, on the answer it holds now: the first
 * form's, its label its name and its hint, and unavailable while the field
 * is empty -- `aria-disabled`, which keeps it in the keyboard's order, so a
 * typeahead cleared and left with Tab, which empties as the keyboard lands
 * here, keeps the keyboard on it -- when a press opens nothing.
 */
function LookupBeside({ path, offer }: { path: string; offer: LookupOffer }): ReactElement | null {
  const { value } = useField(path)
  const open = besideOpen(offer.opens, path, value)
  if (open === null) return null
  const choice = besideChoice(open)
  return (
    <button
      type="button"
      aria-label={open.label}
      title={open.label}
      aria-disabled={choice === null ? true : undefined}
      onClick={(event) => {
        if (choice !== null) offer.open(path, choice, event.currentTarget)
      }}
    >
      <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
        <path d={OPEN_GLYPH} />
      </svg>
    </button>
  )
}

/** The Opens under one lookup, on the answer it holds now, but the first, which is beside its box: nothing while it is empty. */
function LookupOpens({ path, offer }: { path: string; offer: LookupOffer }): ReactElement {
  const { value } = useField(path)
  return (
    <>
      {underOpens(offer.opens, path, value).map((choice) => (
        <button key={choice.form.id} type="button" onClick={(event) => offer.open(path, choice, event.currentTarget)}>
          {choice.label}
        </button>
      ))}
    </>
  )
}
