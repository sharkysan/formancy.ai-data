import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { FormancyErrorSummary, FormancyForm, injectEngine } from '@formancy/angular'
import { HOST_SAVE } from './angular-save.js'
import { fieldLabels } from './labels.js'

/**
 * The Angular renderer's half of a pane: the error summary, then the form,
 * with "Save" as its submit. The same two parts, in the same order, as the
 * React pane, so a difference on screen is a difference of renderer.
 *
 * The summary is the host's to place -- neither renderer's form includes one
 * -- and it focuses itself when errors appear: after the engine refuses a
 * submit, and after the server names a field.
 *
 * **This file holds the component and nothing else**, for the reason in
 * angular-save.ts.
 */
@Component({
  selector: 'formancy-data-host-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormancyErrorSummary, FormancyForm],
  template: `<formancy-error-summary [labels]="labels" /><formancy-form [layout]="layout" submitLabel="Save" (submitted)="save($event)" />`,
})
export class HostAngularForm {
  private readonly engine = injectEngine()
  protected readonly layout = this.engine.schema().layouts?.[0]?.name
  protected readonly labels = fieldLabels(this.engine)
  protected readonly save = inject(HOST_SAVE)
}
