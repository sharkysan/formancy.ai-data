import { provideZonelessChangeDetection } from '@angular/core'
import type { ApplicationRef } from '@angular/core'
import { createApplication } from '@angular/platform-browser'
import { provideFormancy, provideFormancyOptionsSources } from '@formancy/angular'
import type { OptionsSources, SubmitOutcome } from '@formancy/angular'
import type { FormEngine } from '@formancy/core'
import { HostAngularForm } from './angular-form.js'
import { HOST_SAVE } from './angular-save.js'

/**
 * Put the Angular renderer in `host`, over `engine`, and return how to remove
 * it: the examples page's mount, with the host's save beside the engine.
 *
 * One application per pane and per engine, because the engine, the sources
 * and the save arrive through the injector and an injector's providers are
 * fixed once it exists. So Load and New, which make a new engine, make a new
 * application; a save, which keeps the engine, does not.
 *
 * `createApplication` and `bootstrap(component, element)`, not
 * `bootstrapApplication`, which finds its host by selector -- the first
 * matching element in the document. Zoneless, because `@formancy/angular` is
 * signals-based and its own suites run zoneless.
 *
 * `sources` is `lookupSources(...)` from `@formancy/data-client`, typed here as
 * this renderer's own `OptionsSources`: this file's type check is the one that
 * fails when that stops fitting (0029).
 */
export async function mountAngularForm(
  host: HTMLElement,
  engine: FormEngine,
  sources: OptionsSources,
  save: (outcome: SubmitOutcome) => void,
): Promise<() => void> {
  const root = document.createElement('formancy-data-host-form')
  host.append(root)

  let app: ApplicationRef | undefined
  try {
    app = await createApplication({
      providers: [provideZonelessChangeDetection(), provideFormancy(engine), provideFormancyOptionsSources(sources), { provide: HOST_SAVE, useValue: save }],
    })
    app.bootstrap(HostAngularForm, root)
  } catch (error) {
    // A failed start leaves nothing behind: no application holding the
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
