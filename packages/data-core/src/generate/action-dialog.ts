import type { FieldDef, FormSchema } from '@formancy/spec'
import type { ActionParameter } from '../actions/types.js'
import { describeRoutine, type RoutineMeta } from '../routines.js'
import { controlFor } from './controls.js'
import { labelFor } from './names.js'
import type { GenerationNote } from './types.js'
import { GENERATED_SPEC_VERSION } from './version.js'

/*
 * The dialog of an action (0159): the form a person answers before a run,
 * one field per parameter an input gives, made by the generator's own
 * `controlFor` from the parameter's type, as a column's field is. Written
 * into the bindings, compared at every write but a restore, and served as
 * stored (0030): a later release whose generator writes something else
 * changes no published dialog. Its words are the presentation's to change
 * (`presentation/actions.ts`), and nothing else of it is.
 */

/**
 * The words the generator gives an action: its name in words, which its
 * dialog's title and section say, and what a presentation's label is
 * compared with and rebased against (`presentation/actions.ts`), so the
 * two cannot spell it differently.
 */
export function actionLabel(name: string): string {
  return labelFor(name)
}

/**
 * One dialog field: required, so a parameter never passes a NULL its
 * person did not choose -- but a checkbox, which formancy counts as
 * answered only when ticked, starts unticked instead, so false is an
 * answer and a person is never made to tick it.
 */
function inputField(input: string, parameter: ActionParameter): FieldDef {
  const control = controlFor(parameter.type, false)
  // generate/actions.ts refused an input whose type has no field (`inputProblem`).
  const field = (control as Extract<typeof control, { field: unknown }>).field
  return { key: input, label: labelFor(input), ...field, ...(field.type === 'checkbox' ? { default: false } : { required: true }) }
}

/**
 * The dialog of `name` on form `formId`, or `null` where no parameter is
 * asked of the person: its id the form's and the action's, its title the
 * action's name in words, and one section of one column holding each
 * input's field, in the routine's order. A note per field says what it
 * was made from, as a column's does.
 */
export function dialogFor(
  formId: string,
  name: string,
  parameters: readonly ActionParameter[],
  routine: RoutineMeta,
  notes: GenerationNote[],
): FormSchema | null {
  const fields: FieldDef[] = []
  for (const parameter of parameters) {
    if (parameter.from.kind !== 'input') continue
    const { input } = parameter.from
    fields.push(inputField(input, parameter))
    const control = controlFor(parameter.type, false) as Extract<ReturnType<typeof controlFor>, { field: unknown }>
    notes.push({
      subject: `${name}.${input}`,
      kind: 'inferred',
      message: `Asked of the person before ${name} runs: ${control.describe}, for ${parameter.parameter} of ${describeRoutine(routine.ref)} (${parameter.databaseType}); label from the input's name.`,
    })
    if (control.caveat !== undefined) notes.push({ subject: `${name}.${input}`, kind: 'inferred', message: control.caveat })
  }
  if (fields.length === 0) return null
  const title = actionLabel(name)
  return {
    specVersion: GENERATED_SPEC_VERSION,
    id: `${formId}.${name}`,
    title,
    model: { fields },
    layouts: [
      {
        name: 'default',
        nodes: [
          { kind: 'section', label: title, children: [{ kind: 'table', columns: 1, children: fields.map((field) => ({ kind: 'field', path: field.key })) }] },
        ],
      },
    ],
  }
}
