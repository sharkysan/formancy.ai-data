import { useEffect, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { FormEngine } from '@formancy/core'
import { FormancyForm, FormancyProvider, OptionsSourcesProvider } from '@formancy/react'
import type { OptionsSources } from '@formancy/react'

interface PaneProps {
  /** The element id of the form's heading, which names the pane together with the renderer. */
  tableId: string
  /** `schema.table`, for the form landmark's name. */
  table: string
  engine: FormEngine
  /** The host's lists, by the name a document gives. The same map for both renderers. */
  sources: OptionsSources
}

/**
 * One renderer's half: a named region, and the form on white paper in Blueprint.
 *
 * The region is named by the form's heading and the renderer's, so a screen
 * reader moving by landmark -- and a test -- can say which of four previews it
 * means. The paper is a `<form>` of the page's own, `noValidate` so the
 * browser's bubbles never stand in for the engine's errors, and each renderer
 * gets its own, so the two never share a radio group's form owner.
 */
function Pane({ tableId, table, renderer, children, sheet }: {
  tableId: string
  table: string
  renderer: 'React' | 'Angular'
  children?: ReactNode
  sheet?: (element: HTMLFormElement | null) => void
}): ReactElement {
  const headingId = `${tableId}-${renderer.toLowerCase()}`
  return (
    <section className="pane" aria-labelledby={`${tableId} ${headingId}`}>
      <h3 id={headingId}>{renderer}</h3>
      <form
        className="sheet"
        aria-label={`${table}, ${renderer} preview`}
        data-formancy-theme="blueprint"
        noValidate
        onSubmit={(event) => event.preventDefault()}
        ref={sheet}
      >
        {children}
      </form>
    </section>
  )
}

/** The document under `@formancy/react`. */
export function ReactPane({ tableId, table, engine, sources }: PaneProps): ReactElement {
  // The document's own arrangement, as the Angular preview reads it, so the
  // two draw the same layout and a difference on screen is the renderer's.
  const layout = engine.schema().layouts?.[0]?.name
  return (
    <Pane tableId={tableId} table={table} renderer="React">
      <OptionsSourcesProvider value={sources}>
        <FormancyProvider engine={engine}>
          <FormancyForm {...(layout === undefined ? {} : { layout })} submitLabel="Validate" />
        </FormancyProvider>
      </OptionsSourcesProvider>
    </Pane>
  )
}

/**
 * The same document under `@formancy/angular`, as a React component.
 *
 * React owns the paper and nothing inside it: Angular bootstraps into a child.
 * Bootstrapping is asynchronous and effects are not, so an unmount that
 * arrives first -- StrictMode does exactly that -- marks the late mount to
 * tear itself down instead of leaving an orphan application over a stale
 * engine.
 */
export function AngularPane({ tableId, table, engine, sources }: PaneProps): ReactElement {
  const [sheet, setSheet] = useState<HTMLFormElement | null>(null)
  const [problem, setProblem] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (sheet === null) return undefined
    let cancelled = false
    let unmount: (() => void) | undefined

    // Loaded when the first Angular preview mounts rather than with the page:
    // the bootstrap is asynchronous already, so the React half and the notes
    // paint without waiting for Angular, and the bundle splits where the two
    // frameworks meet.
    import('./angular-bootstrap.js')
      .then(({ mountAngularPreview }) => mountAngularPreview(sheet, engine, sources))
      .then((teardown) => {
        if (cancelled) teardown()
        else unmount = teardown
      })
      .catch((error: unknown) => {
        if (cancelled) return
        // Shown where the form would have been. A blank half of the page is
        // the failure this pane exists to make visible.
        setProblem(error instanceof Error ? error.message : String(error))
      })

    return () => {
      cancelled = true
      unmount?.()
    }
  }, [sheet, engine, sources])

  return (
    <Pane tableId={tableId} table={table} renderer="Angular" sheet={setSheet}>
      {problem === undefined ? null : (
        <p role="alert" className="problem">
          The Angular renderer did not start: {problem}
        </p>
      )}
    </Pane>
  )
}
