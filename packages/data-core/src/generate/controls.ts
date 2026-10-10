import type { FieldDef } from '@formancy/spec'
import type { NormalizedType, TextLengthUnit } from '../metadata.js'

/**
 * The part of a field that follows from the column's type: which control, and
 * which bounds formancy can check on both sides.
 *
 * `readOnly` is a reason, when a type has a value worth showing and no control
 * that can write it faithfully. `exclude` is a reason, when there is nothing a
 * form can usefully show at all.
 *
 * `caveat` is what the field's own checks do not say about the column — how a
 * text's `maxLength` relates to the unit the column counts, what a real keeps
 * — and becomes an inferred note on the field.
 */
export type ControlPlan =
  | { field: Omit<FieldDef, 'key' | 'label' | 'required'>; describe: string; readOnly?: string; caveat?: string }
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

/**
 * How the browser's `maxLength` of n relates to a column of this unit (0026).
 *
 * The browser counts UTF-16 code units, which are never more than code points,
 * UTF-8 bytes or code-page bytes, so n never refuses a value the column holds —
 * except a PostgreSQL value with emoji, where the browser is stricter. That is
 * 0008's direction: the browser refuses first, and the server may refuse more.
 */
function lengthCaveat(n: number, unit: TextLengthUnit): string {
  const max = String(n)
  switch (unit) {
    case 'utf16-code-units':
      return `The browser's maxLength of ${max} counts UTF-16 code units, the unit the column counts.`
    case 'code-points':
      return `The browser's maxLength of ${max} counts UTF-16 code units and the column counts characters: an emoji counts twice in the browser, so the form can refuse a value the column would hold, never the reverse.`
    case 'utf8-bytes':
      return `The column holds ${max} bytes of UTF-8 and the browser's maxLength of ${max} counts UTF-16 code units: a value of accented letters or emoji can pass the browser and be refused by the server as too long. Checked on the server only.`
    case 'code-page-bytes':
      return `The column counts ${max} in its code page, not in Unicode, and the browser's maxLength of ${max} counts UTF-16 code units: the server checks characters, and a value longer in the code page's bytes, or with a character the code page lacks, is refused when it is saved.`
  }
}

function isSafe(bound: string): boolean {
  const value = Number(bound)
  return Number.isSafeInteger(value) && String(value) === bound
}

export function controlFor(type: NormalizedType, nullable: boolean): ControlPlan {
  switch (type.kind) {
    case 'text': {
      // maxLength stays n in every unit: see lengthCaveat for why that is safe and what it leaves to the server.
      if (type.maxLength === null) return { field: { type: 'textarea' }, describe: 'multi-line text' }
      const caveat = lengthCaveat(type.maxLength, type.lengthUnit)
      if (type.maxLength > SINGLE_LINE_LIMIT) return { field: { type: 'textarea', maxLength: type.maxLength }, describe: 'multi-line text', caveat }
      return { field: { type: 'text', maxLength: type.maxLength }, describe: 'text', caveat }
    }

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
        // would let the browser check it too, and it needs spec 4, which a
        // host's renderer still at 0.3.0 refuses outright; generated forms stay
        // on spec 3 until that is worth the cost (0042).
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
      if (type.bits === 64) return { field: { type: 'number' }, describe: 'a floating-point number' }
      return {
        field: { type: 'number' },
        describe: 'a 32-bit floating-point number',
        caveat:
          'A 32-bit float keeps about seven significant digits: the server saves the nearest one and answers with its shortest spelling, so 0.123456789 is saved as 0.12345679.',
      }

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
