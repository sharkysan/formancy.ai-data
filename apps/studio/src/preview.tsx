import { useMemo } from 'react'
import type { ReactElement } from 'react'
import type { BuilderSession } from '@formancy/builder-core'
import { createFormEngine } from '@formancy/core'
import type { FormBindings } from '@formancy/data-core'
import { FormancyForm, FormancyProvider } from '@formancy/react'
import type { FormSchema } from '@formancy/spec'
import { labelOf, useDocument } from './document.js'
import { lookupBindings } from './policy-model.js'

/**
 * A form as the people filling it in will see it -- the released
 * `@formancy/react`, the Blueprint theme, white paper -- and not as the
 * studio looks: the Preview step's document, and under review a draft's
 * (0065), drawn by this one component so the two cannot differ.
 *
 * Nothing on the paper is the studio's: renderers ship no CSS and the
 * theme targets `data-formancy-part`.
 *
 * A lookup's list is not filled. Its options come from the runtime plane,
 * which answers the host application's people under the published policy,
 * and the studio speaks only the administrator plane (0024); the renderer
 * says where the list would be, and the note above the paper says why.
 *
 * `revision` keys the provider: a new document is a new engine, and a new
 * provider over it.
 */
export function FormPaper({ document, bindings, label, revision }: { document: FormSchema; bindings: FormBindings; label: string; revision: number | string }): ReactElement {
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
  return (
    <>
      {lookupBindings(bindings).map((binding) => (
        <p role="note" className="lookup-note" key={binding.field}>
          The <strong>{labelOf(document, binding.field)}</strong> list is filled by the runtime plane once the form is
          published, from {binding.target.table.schema}.{binding.target.table.name} under its lookup filters. The studio
          speaks only the administrator plane, so here the renderer says where the list would be.
        </p>
      ))}
      <form className="sheet" aria-label={label} data-formancy-theme="blueprint" noValidate onSubmit={(event) => event.preventDefault()}>
        <FormancyProvider key={revision} engine={engine}>
          <FormancyForm {...(layout === undefined ? {} : { layout })} submitLabel="Validate" />
        </FormancyProvider>
      </form>
    </>
  )
}

/**
 * Step 7: the form about to be published, on its paper. The engine is
 * rebuilt from the session's document whenever an edit lands, so a label
 * changed in the presentation step is the label here.
 */
export function PreviewStep({ session, bindings }: { session: BuilderSession; bindings: FormBindings }): ReactElement {
  const document = useDocument(session)
  const title = typeof document.title === 'string' ? document.title : document.id
  return (
    <>
      <p className="lede">
        <strong>Validate</strong> runs the formancy engine in this browser against the document you are about to publish.
        Nothing is saved: the studio writes forms, never records.
      </p>
      <FormPaper document={document} bindings={bindings} label={`${title} preview`} revision={session.revision()} />
    </>
  )
}
