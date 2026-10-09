import type { ReactElement } from 'react'
import type { FormEngine } from '@formancy/core'
import { ErrorSummary, FormancyForm, FormancyProvider, OptionsSourcesProvider } from '@formancy/react'
import type { OptionsSources, SubmitOutcome } from '@formancy/react'
import { fieldLabels } from './labels.js'

/**
 * The React renderer's half of a pane: the error summary, then the form, with
 * "Save" as its submit -- the Angular pane's two parts, in its order.
 *
 * The summary is the host's to place: `FormancyForm` includes none. It focuses
 * itself when errors appear, after the engine refuses a submit and after the
 * server names a field. The layout is the document's own, as the Angular half
 * reads it.
 *
 * `sources` is `lookupSources(...)` from `@formancy/data-client`, typed here as
 * this renderer's own `OptionsSources`: this file's type check is the one that
 * fails when that stops fitting (0029).
 */
export function ReactForm({
  engine,
  sources,
  onSubmit,
}: {
  engine: FormEngine
  sources: OptionsSources
  onSubmit: (outcome: SubmitOutcome) => void
}): ReactElement {
  const layout = engine.schema().layouts?.[0]?.name
  return (
    <OptionsSourcesProvider value={sources}>
      <FormancyProvider engine={engine}>
        <ErrorSummary labels={fieldLabels(engine)} />
        <FormancyForm {...(layout === undefined ? {} : { layout })} submitLabel="Save" onSubmit={onSubmit} />
      </FormancyProvider>
    </OptionsSourcesProvider>
  )
}
