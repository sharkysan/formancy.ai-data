import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import type { TemplateRef } from '@angular/core'
import { FormancyErrorSummary, FormancyForm, injectEngine } from '@formancy/angular'
import type { FormancyFieldAddition, FormancyFieldAdditionContext, FormancyFieldBeside, FormancyFieldBesideContext } from '@formancy/angular'
import { HOST_LABEL } from './angular-label.js'
import { HOST_OFFER } from './angular-offer.js'
import { HOST_SAVE } from './angular-save.js'
import { besideChoice, besideOpen, OPEN_GLYPH, underOpens } from './lookup-opens.js'
import type { BesideOpen, OpenChoice } from './lookup-opens.js'

/**
 * The Angular renderer's half of a pane: the error summary, then the form,
 * with "Save" as its submit -- or a together row's "Done" (0155). The same two parts, in the same order, as the
 * React pane, so a difference on screen is a difference of renderer.
 *
 * The summary is the host's to place -- neither renderer's form includes one
 * -- and it focuses itself when errors appear: after the engine refuses a
 * submit, and after the server names a field. It names each problem by its
 * field's label, as the React half's does.
 *
 * Beside the box of each lookup the offer names forms for, the form draws
 * the `#beside` template (formancy 0.14.0): the first form's Open, a button
 * showing a glyph, named and hinted by its label, unavailable while the
 * field is empty. Under the field, in its field addition (formancy 0.13.0),
 * the `#opens` template: the other forms' Opens. Both on the field's live
 * answer, as the React half draws them (0141, 0157). Each is made once, as
 * React's is, and the one beside a lookup is given whatever its answer,
 * since a template that comes and goes draws the box again (formancy.ai
 * 0237). Each template sits on one line, so no whitespace reaches a
 * button's name.
 *
 * **This file holds the component and nothing else**, for the reason in
 * angular-save.ts.
 */
@Component({
  selector: 'formancy-data-host-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormancyErrorSummary, FormancyForm],
  template: `<ng-template #opens let-path let-field="field">@for (choice of choices(path, field.snapshot().value); track choice.form.id) {<button type="button" (click)="press(path, choice, $event)">{{ choice.label }}</button>}</ng-template><ng-template #beside let-path let-field="field">@if (first(path, field.snapshot().value); as open) {<button type="button" [attr.aria-label]="open.label" [attr.title]="open.label" [attr.aria-disabled]="open.token === null ? 'true' : null" (click)="pressFirst(path, open, $event)"><svg aria-hidden="true" focusable="false" viewBox="0 0 16 16"><path [attr.d]="glyph" /></svg></button>}</ng-template><formancy-error-summary /><formancy-form [layout]="layout" [submitLabel]="label" [fieldAddition]="additionOf(opens)" [fieldBeside]="besideOf(beside)" (submitted)="save($event)" />`,
})
export class HostAngularForm {
  private readonly engine = injectEngine()
  protected readonly layout = this.engine.schema().layouts?.[0]?.name
  protected readonly save = inject(HOST_SAVE)
  protected readonly label = inject(HOST_LABEL)
  protected readonly glyph = OPEN_GLYPH
  private readonly offer = inject(HOST_OFFER)
  private addition: FormancyFieldAddition | undefined
  private beside: FormancyFieldBeside | undefined

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

  /** What the form draws beside a field's box, made on first asking and the same function after: the template beside each lookup the offer names a form for, nothing beside any other. */
  protected besideOf(template: TemplateRef<FormancyFieldBesideContext>): FormancyFieldBeside | undefined {
    const { offer } = this
    if (offer === null) return undefined
    if (this.beside === undefined) {
      const named = new Set(offer.opens.filter((each) => besideOpen(offer.opens, each.field, null) !== null).map((each) => each.field))
      this.beside = (path) => (named.has(path) ? template : null)
    }
    return this.beside
  }

  /** The Opens under the lookup at `path`, on the answer it holds now: all but the first, which is beside its box. */
  protected choices(path: string, answer: unknown): OpenChoice[] {
    return this.offer === null ? [] : underOpens(this.offer.opens, path, answer)
  }

  /** The Open beside the lookup at `path`'s box, on the answer it holds now. */
  protected first(path: string, answer: unknown): BesideOpen | null {
    return this.offer === null ? null : besideOpen(this.offer.opens, path, answer)
  }

  protected press(path: string, choice: OpenChoice, event: Event): void {
    if (event.currentTarget instanceof HTMLElement) this.offer?.open(path, choice, event.currentTarget)
  }

  /** A press on the Open beside: handed on as the Opens under are, and nothing while it is unavailable. */
  protected pressFirst(path: string, open: BesideOpen, event: Event): void {
    const choice = besideChoice(open)
    if (choice !== null) this.press(path, choice, event)
  }
}
