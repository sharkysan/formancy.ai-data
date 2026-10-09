import { useMemo } from 'react'
import type { ReactElement } from 'react'
import type { BuilderSession } from '@formancy/builder-core'
import { createFormEngine } from '@formancy/core'
import type { FormBindings } from '@formancy/data-core'
import { FormancyForm, FormancyProvider } from '@formancy/react'
import { labelOf, useDocument } from './document.js'
import { lookupBindings } from './policy-model.js'

/**
 * Step 7: the form as the people filling it in will see it -- the released
 * `@formancy/react`, the Blueprint theme, white paper -- and not as the studio
 * looks.
 *
 * The engine is rebuilt from the session's document whenever an edit lands,
 * so a label changed in the presentation step is the label here. Nothing on
 * the paper is the studio's: renderers ship no CSS and the theme targets
 * `data-formancy-part`.
 *
 * A lookup's list is not filled. Its options come from the runtime plane,
 * which answers the host application's people under the published policy,
 * and the studio speaks only the administrator plane (0024); the renderer
 * says where the list would be, and the note above the paper says why.
 */
export function PreviewStep({ session, bindings }: { session: BuilderSession; bindings: FormBindings }): ReactElement {
  const document = useDocument(session)
  const engine = useMemo(
    () =>
      createFormEngine({
        schema: document,
        formId: `${document.id}-preview`,
        // The generated documents carry logic rules, and the engine never reads
        // an ambient clock: a host supplies one, and here the host is the browser.
        capabilities: { now: () => Date.now(), today: () => new Date().toISOString().slice(0, 10), random: () => Math.random() },
      }),
    [document],
  )
  const layout = document.layouts?.[0]?.name
  const title = typeof document.title === 'string' ? document.title : document.id
  const lookups = lookupBindings(bindings)
  return (
    <>
      <p className="lede">
        <strong>Validate</strong> runs the formancy engine in this browser against the document you are about to publish.
        Nothing is saved: the studio writes forms, never records.
      </p>
      {lookups.map((binding) => (
        <p role="note" className="lookup-note" key={binding.field}>
          The <strong>{labelOf(document, binding.field)}</strong> list is filled by the runtime plane once the form is
          published, from {binding.target.table.schema}.{binding.target.table.name} under its lookup filters. The studio
          speaks only the administrator plane, so here the renderer says where the list would be.
        </p>
      ))}
      <form className="sheet" aria-label={`${title} preview`} data-formancy-theme="blueprint" noValidate onSubmit={(event) => event.preventDefault()}>
        {/* Keyed by the session's revision: a new document is a new engine, and a new provider over it. */}
        <FormancyProvider key={session.revision()} engine={engine}>
          <FormancyForm {...(layout === undefined ? {} : { layout })} submitLabel="Validate" />
        </FormancyProvider>
      </form>
    </>
  )
}
