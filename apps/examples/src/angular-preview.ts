import { ChangeDetectionStrategy, Component } from '@angular/core'
import { FormancyForm, injectEngine } from '@formancy/angular'

/**
 * The Angular renderer, mounted beside the React one.
 *
 * Deliberately a host and nothing more: how a field looks, what ARIA it
 * carries and when it appears come from the engine and the package. The
 * layout is the document's own, read from the engine, so both renderers draw
 * the same arrangement and a difference on screen is a difference of renderer.
 *
 * **This file holds the component and nothing else.** The Angular compiler's
 * output for a module drops a plain function exported beside a component, as
 * formancy.ai's playground found; the bootstrap is next door.
 */
@Component({
  selector: 'formancy-data-angular-preview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormancyForm],
  template: `<formancy-form [layout]="layout" submitLabel="Validate" />`,
})
export class AngularPreview {
  protected readonly layout = injectEngine().schema().layouts?.[0]?.name
}
