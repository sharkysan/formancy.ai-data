import type { FieldDef } from '@formancy/spec'
import type { NormalizedType } from '../metadata.js'

/**
 * The part of a field that follows from the column's type: which control, and
 * which bounds formancy can check on both sides.
 *
 * `readOnly` is a reason, when a type has a value worth showing and no control
 * that can write it faithfully. `exclude` is a reason, when there is nothing a
 * form can usefully show at all.
 */
export type ControlPlan =
  | { field: Omit<FieldDef, 'key' | 'label' | 'required'>; describe: string; readOnly?: string }
  | { exclude: string }

/** Above this, a text column gets a multi-line control. */
const SINGLE_LINE_LIMIT = 255

/**
 * The digits a decimal string may carry, as formancy's `pattern` — checked by
 * the same compiled engine in the browser and on the server, so they cannot
 * disagree. Never through `number`: a JavaScript number has fifteen to
 * seventeen significant digits, and numeric(18,4) has eighteen.
 */
function decimalPattern(precision: number | null, scale: number | null): string {
  if (precision === null) return '^-?[0-9]+(\\.[0-9]+)?$'
  const fraction = scale ?? 0
  const whole = precision - fraction
  if (fraction === 0) return `^-?[0-9]{1,${String(precision)}}$`
  if (whole === 0) return `^-?(0|0?\\.[0-9]{1,${String(fraction)}})$`
  return `^-?[0-9]{1,${String(whole)}}(\\.[0-9]{1,${String(fraction)}})?$`
}

function isSafe(bound: string): boolean {
  const value = Number(bound)
  return Number.isSafeInteger(value) && String(value) === bound
}

export function controlFor(type: NormalizedType, nullable: boolean): ControlPlan {
  switch (type.kind) {
    case 'text':
      if (type.maxLength === null || type.maxLength > SINGLE_LINE_LIMIT) {
        return {
          field: { type: 'textarea', ...(type.maxLength === null ? {} : { maxLength: type.maxLength }) },
          describe: 'multi-line text',
        }
      }
      return { field: { type: 'text', maxLength: type.maxLength }, describe: 'text' }

    case 'boolean':
      // A nullable boolean has three answers, and a checkbox has two: unticked
      // would silently mean false where the database holds "unknown".
      return nullable
        ? {
            field: {
              type: 'radio',
              options: [
                { value: 'true', label: 'Yes' },
                { value: 'false', label: 'No' },
              ],
            },
            describe: 'yes, no or no answer',
          }
        : { field: { type: 'checkbox' }, describe: 'a checkbox' }

    case 'integer':
      if (isSafe(type.min) && isSafe(type.max)) {
        // Whole numbers are checked by the server's codec. formancy's `step`
        // would let the browser check it too, and it arrives with spec 4,
        // which the released @formancy/spec does not speak yet.
        return { field: { type: 'number', min: Number(type.min), max: Number(type.max) }, describe: 'a whole number' }
      }
      return {
        field: { type: 'text', pattern: `^-?[0-9]{1,${String(type.max.replace('-', '').length)}}$` },
        describe: 'a whole number held as text, because it can exceed what JavaScript represents exactly',
      }

    case 'decimal':
      return {
        field: { type: 'text', pattern: decimalPattern(type.precision, type.scale) },
        describe: 'an exact decimal held as text, never as a floating-point number',
      }

    case 'float':
      return { field: { type: 'number' }, describe: 'a floating-point number' }

    case 'date':
      return { field: { type: 'date' }, describe: 'a calendar date' }

    case 'time':
      return { field: { type: 'time' }, describe: 'a time of day, to the minute' }

    case 'timestamp':
      if (type.withTimeZone) return { field: { type: 'datetime' }, describe: 'an instant, to the second, in UTC' }
      // formancy's datetime is an instant. A timestamp with no zone is a wall
      // clock in an unknown zone, and writing one as an instant would move it
      // by whatever offset somebody guessed.
      return {
        field: { type: 'text' },
        describe: 'text',
        readOnly: 'a timestamp without a time zone has no formancy field: formancy datetime is an instant, and converting would guess a zone',
      }

    case 'uuid':
      return { field: { type: 'text', format: 'uuid' }, describe: 'a UUID' }

    case 'binary':
      return { exclude: 'binary data has no form control' }

    case 'rowversion':
      return { exclude: 'a rowversion is a concurrency token, never a field' }

    case 'unsupported':
      return { exclude: 'no tested codec exists for this type' }
  }
}
