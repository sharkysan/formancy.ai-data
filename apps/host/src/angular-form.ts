import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import type { TemplateRef } from '@angular/core'
import { FormancyErrorSummary, FormancyForm, injectEngine } from '@formancy/angular'
import type { FormancyFieldAddition, FormancyFieldAdditionContext } from '@formancy/angular'
import { HOST_OFFER } from './angular-offer.js'
import { HOST_SAVE } from './angular-save.js'
import { openChoices } from './lookup-opens.js'
import type { OpenChoice } from './lookup-opens.js'

/**
 * The Angular renderer's half of a pane: the error summary, then the form,
 * with "Save" as its submit. The same two parts, in the same order, as the
 * React pane, so a difference on screen is a difference of renderer.
 *
 * The summary is the host's to place -- neither renderer's form includes one
 * -- and it focuses itself when errors appear: after the engine refuses a
 * submit, and after the server names a field. It names each problem by its
 * field's label, as the React half's does.
 *
 * Under each lookup the offer names forms for, the form's field addition
 * (formancy 0.13.0) draws the template below: one Open per form, on the
 * field's live answer, as the React half draws them (0141). The addition is
 * made once, as React's is, and the template's buttons sit on one line, so
 * no whitespace reaches their names.
 *
 * **This file holds the component and nothing else**, for the reason in
 * angular-save.ts.
 */
@Component({
  selector: 'formancy-data-host-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormancyErrorSummary, FormancyForm],
  template: `<ng-template #opens let-path let-field="field">@for (choice of choices(path, field.snapshot().value); track choice.form.id) {<button type="button" (click)="press(path, choice, $event)">{{ choice.label }}</button>}</ng-template><formancy-error-summary /><formancy-form [layout]="layout" submitLabel="Save" [fieldAddition]="additionOf(opens)" (submitted)="save($event)" />`,
})
export class HostAngularForm {
  private readonly engine = injectEngine()
  protected readonly layout = this.engine.schema().layouts?.[0]?.name
  protected readonly save = inject(HOST_SAVE)
  private readonly offer = inject(HOST_OFFER)
  private addition: FormancyFieldAddition | undefined

  /** The form's field addition, made on first asking and the same function after: the template under each lookup the offer names, nothing under any other field. */
  protected additionOf(template: TemplateRef<FormancyFieldAdditionContext>): FormancyFieldAddition | undefined {
    const { offer } = this
    if (offer === null) return undefined
    if (this.addition === undefined) {
      const named = new Set(offer.opens.map((each) => each.field))
      this.addition = (path) => (named.has(path) ? template : null)
    }
    return this.addition
  }

  /** The Opens under the lookup at `path`, on the answer it holds now. */
  protected choices(path: string, answer: unknown): OpenChoice[] {
    return this.offer === null ? [] : openChoices(this.offer.opens, path, answer)
  }

  protected press(path: string, choice: OpenChoice, event: Event): void {
    if (event.currentTarget instanceof HTMLElement) this.offer?.open(path, choice, event.currentTarget)
  }
}
