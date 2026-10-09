import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { OptionsSources, SubmitOutcome } from '@formancy/angular'
import type { FormEngine } from '@formancy/core'

/**
 * The Angular renderer's half of a pane, as a React component: the examples
 * page's AngularPane, with the host's save.
 *
 * React owns the paper and nothing Angular draws in it: Angular bootstraps
 * into an element appended to `sheet`. Bootstrapping is asynchronous and
 * effects are not, so an unmount that arrives first -- StrictMode does exactly
 * that, and so does a Load while Angular is starting -- marks the late mount
 * to tear itself down instead of leaving an orphan application over a stale
 * engine.
 *
 * The save is read through a ref, so the application started for this engine
 * always calls the pane's current handler without being started again.
 */
export function AngularForm({
  sheet,
  engine,
  sources,
  onSubmit,
}: {
  sheet: HTMLFormElement | null
  engine: FormEngine
  sources: OptionsSources
  onSubmit: (outcome: SubmitOutcome) => void
}): ReactElement | null {
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const submit = useRef(onSubmit)
  useEffect(() => {
    submit.current = onSubmit
  }, [onSubmit])

  useEffect(() => {
    if (sheet === null) return undefined
    let cancelled = false
    let unmount: (() => void) | undefined

    // Loaded when the first Angular pane mounts rather than with the page: the
    // React half paints without waiting, and the bundle splits where the two
    // frameworks meet.
    import('./angular-bootstrap.js')
      .then(({ mountAngularForm }) => mountAngularForm(sheet, engine, sources, (outcome) => submit.current(outcome)))
      .then((teardown) => {
        if (cancelled) teardown()
        else unmount = teardown
      })
      .catch((error: unknown) => {
        if (cancelled) return
        // Said where the form would have been: a blank half of the page is the
        // failure this pane exists to make visible.
        setProblem(error instanceof Error ? error.message : String(error))
      })

    return () => {
      cancelled = true
      unmount?.()
    }
  }, [sheet, engine, sources])

  return problem === undefined ? null : <p role="alert">The Angular renderer did not start: {problem}</p>
}
