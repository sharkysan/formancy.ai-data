import { provideZonelessChangeDetection } from '@angular/core'
import type { ApplicationRef } from '@angular/core'
import { createApplication } from '@angular/platform-browser'
import { provideFormancy, provideFormancyOptionsSources } from '@formancy/angular'
import type { OptionsSources } from '@formancy/angular'
import type { FormEngine } from '@formancy/core'
import { AngularPreview } from './angular-preview.js'

/**
 * Put the Angular renderer in `host`, over `engine`, and return how to remove it.
 *
 * One application per preview, because the engine arrives through the
 * injector and an injector's providers are fixed once it exists -- formancy.ai's
 * playground made the same choice for the same reason.
 *
 * **`createApplication` and `bootstrap(component, element)`, not
 * `bootstrapApplication`.** The latter finds its host with the component's
 * selector, which is the first matching element in the document; this page
 * has one Angular preview per form, and the second would have mounted into
 * the first.
 *
 * Zoneless, which is not a preference: `@formancy/angular` is signals-based and
 * its own suites run zoneless.
 *
 * The options sources are the same map the React previews get. A capability
 * belongs to the deployment, not to one renderer.
 */
export async function mountAngularPreview(host: HTMLElement, engine: FormEngine, sources: OptionsSources): Promise<() => void> {
  const root = document.createElement('formancy-data-angular-preview')
  host.append(root)

  let app: ApplicationRef | undefined
  try {
    app = await createApplication({
      providers: [provideZonelessChangeDetection(), provideFormancy(engine), provideFormancyOptionsSources(sources)],
    })
    app.bootstrap(AngularPreview, root)
  } catch (error) {
    // A failed start leaves nothing behind -- no application holding the
    // engine, and no element for the next attempt to mount beside.
    app?.destroy()
    root.remove()
    throw error
  }

  const started = app
  return () => {
    started.destroy()
    root.remove()
  }
}
