import { useMemo } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { FormEngine } from '@formancy/core'
import { ErrorSummary, FormancyForm, FormancyProvider, OptionsSourcesProvider, useField } from '@formancy/react'
import type { OptionsSources, SubmitOutcome } from '@formancy/react'
import { openChoices } from './lookup-opens.js'
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
 * Under each lookup the `offer` names forms for, the renderer's field
 * addition (formancy 0.13.0) holds one Open per form (0141), dressed by the
 * theme: the page adds no rule inside the paper. The addition is made once
 * per offer, which is the session's, since a new function each render would
 * redraw every field's.
 *
 * `sources` is `lookupSources(...)` from `@formancy/data-client`, typed here as
 * this renderer's own `OptionsSources`: this file's type check is the one that
 * fails when that stops fitting (0029).
 */
export function ReactForm({
  engine,
  sources,
  offer,
  onSubmit,
}: {
  engine: FormEngine
  sources: OptionsSources
  /** Open under each lookup it names (0141); none where the pane offers none. */
  offer?: LookupOffer | undefined
  onSubmit: (outcome: SubmitOutcome) => void
}): ReactElement {
  const layout = engine.schema().layouts?.[0]?.name
  const fieldAddition = useMemo(() => {
    if (offer === undefined) return undefined
    const named = new Set(offer.opens.map((each) => each.field))
    return (path: string): ReactNode => (named.has(path) ? <LookupOpens path={path} offer={offer} /> : null)
  }, [offer])
  return (
    <OptionsSourcesProvider value={sources}>
      <FormancyProvider engine={engine}>
        <ErrorSummary />
        <FormancyForm
          {...(layout === undefined ? {} : { layout })}
          {...(fieldAddition === undefined ? {} : { fieldAddition })}
          submitLabel="Save"
          onSubmit={onSubmit}
        />
      </FormancyProvider>
    </OptionsSourcesProvider>
  )
}

/** The Opens under one lookup, on the answer it holds now: nothing while it is empty. */
function LookupOpens({ path, offer }: { path: string; offer: LookupOffer }): ReactElement {
  const { value } = useField(path)
  return (
    <>
      {openChoices(offer.opens, path, value).map((choice) => (
        <button key={choice.form.id} type="button" onClick={(event) => offer.open(path, choice, event.currentTarget)}>
          {choice.label}
        </button>
      ))}
    </>
  )
}
