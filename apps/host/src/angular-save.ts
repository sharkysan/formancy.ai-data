import { InjectionToken } from '@angular/core'
import type { SubmitOutcome } from '@formancy/angular'

/**
 * What the Angular pane does with a submit: the host's save, handed in through
 * the injector because the form is a component of its own application.
 *
 * A file of its own, because the Angular compiler's output for a module drops
 * a plain export beside a component (the examples page found that, after
 * formancy.ai's playground): a token declared next to the component would be
 * undefined where the bootstrap imports it.
 */
export const HOST_SAVE = new InjectionToken<(outcome: SubmitOutcome) => void>('formancy-data-host.save')
