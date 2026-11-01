import type { FormSchema, Text } from '@formancy/spec'
import type { FieldBinding } from '../generate/types.js'
import type { ListView } from '../runtime.js'

/**
 * The version of `PresentationOverrides` this release writes and reads. A
 * bundle holding another is refused on read, as an unknown bindings version is.
 */
export const PRESENTATION_VERSION = 1

/**
 * What a field stands for, which outlives its key (0030).
 *
 * A key is the generator's name for a field, and it renumbers: of two columns
 * that sanitise to `order_date`, the second is `order_date_2` until the first is
 * dropped. A label chosen for the second must follow the column, not the key.
 */
export type FieldAnchor = { kind: 'column'; column: string } | { kind: 'lookup'; foreignKey: string }

/** A generated section: the label the generator wrote, and which of the sections with that label (0 first). */
export interface SectionAnchor {
  label: string
  occurrence: number
}

export interface FieldPresentation {
  /** The key in the base this was chosen over. */
  field: string
  anchor: FieldAnchor
  /** Present only where it differs from the base's. */
  label?: Text
  /** 'all': spans the grid's row where the base did not; 'one': one column where the base spanned. */
  span?: 'all' | 'one'
  /**
   * Help text over the base's (0119): text that replaces or adds it, or
   * `null` that removes the base's, which its column's comment gave it
   * (0118). Present only where it differs from the base's.
   */
  description?: Text | null
  /**
   * The generated section it is placed in, present only where that is not
   * the one the base places it in (0075). It lands after that section's own
   * fields unless the section's `order` says otherwise.
   */
  section?: SectionAnchor
}

export interface SectionPresentation {
  anchor: SectionAnchor
  label?: Text
  /**
   * Every key the section's grid places, in the person's order; present only
   * where it differs from where the moves leave them (`placement.ts`).
   */
  order?: string[]
}

/**
 * Plan section 9's third concern: what a person chose over the generated
 * base, and nothing else. Arrays, never records: a field key may be
 * `__proto__`.
 *
 * Exactly the studio's edits — a field's label, a section's label, a
 * field's place within its section's grid and full width (0030), the
 * generated section a field is placed in (0075), the views a list of the
 * form's records offers (0105), and a field's help text (0119). Each entry holds only what differs from
 * the base, so a presentation has one spelling.
 */
export interface PresentationOverrides {
  version: typeof PRESENTATION_VERSION
  /** In the base's field order. */
  fields: FieldPresentation[]
  /** In the base's section order. */
  sections: SectionPresentation[]
  /** In the order a picker lists them; left out when there are none, never `[]` (`views.ts`). */
  views?: ListView[]
}

export type PresentationCheck = { ok: true; presentation: PresentationOverrides } | { ok: false; problems: string[] }
export type PresentedForm = { ok: true; form: FormSchema } | { ok: false; problems: string[] }

/** What a rebase could not carry as it was, and what it did instead. */
export type PresentationConflict =
  /** `field` is the old key. */
  | {
      kind: 'field-gone'
      field: string
      anchor: FieldAnchor
      property: 'label' | 'span' | 'section' | 'description'
      // A span's `all` or `one` is a string, which Text holds; a removed help text is null.
      yours: Text | SectionAnchor | null
      resolution: 'dropped'
      message: string
    }
  /** `field` is the new key, `from` the old. */
  | { kind: 'field-rekeyed'; field: string; from: string; anchor: FieldAnchor; resolution: 'followed'; message: string }
  /**
   * A label or help text the generator changed too: span has two values, so
   * a span override is either still one or now the generator's. A removed
   * help text is `null` in `yours`.
   */
  | { kind: 'both-changed'; field: string; property: 'label' | 'description'; yours: Text | null; generator: Text; resolution: 'kept-yours'; message: string }
  /** `from` and `to` are where the field is placed: the section the person moved it to, else the generator's. */
  | { kind: 'moved-section'; field: string; from: SectionAnchor; to: SectionAnchor; resolution: 'followed'; message: string }
  /**
   * A move the rebase could not carry (0075): its section gone or not told
   * apart, or carrying it would leave a section with no field. `field` is
   * the new key, `section` the person's choice, `to` where the field is now.
   */
  | { kind: 'move-dropped'; field: string; anchor: FieldAnchor; section: SectionAnchor; to: SectionAnchor; resolution: 'dropped'; message: string }
  /** A section the rebase cannot find in the new base: gone, or one of two sharing a label whose number changed. */
  | { kind: 'section-gone'; section: SectionAnchor; property: 'label' | 'order'; yours: Text | string[]; resolution: 'dropped'; message: string }
  /**
   * A list view the rebase could not carry (0105): a field it names is gone,
   * or no longer offers what it asks. Dropped whole, never carried without
   * the condition, which would show a wider list under the view's name.
   */
  | { kind: 'view-dropped'; view: string; resolution: 'dropped'; message: string }

export interface RebasedPresentation {
  presentation: PresentationOverrides
  form: FormSchema
  conflicts: PresentationConflict[]
}

/** A key that names another column or lookup than before: grants written for it now apply elsewhere. */
export interface ReassignedKey {
  field: string
  was: FieldAnchor
  now: FieldAnchor
}

/** A presentation that changes nothing. Frozen, arrays included, so no caller can change it for every other. */
export const EMPTY_PRESENTATION: PresentationOverrides = Object.freeze({
  version: PRESENTATION_VERSION,
  fields: Object.freeze([]) as unknown as FieldPresentation[],
  sections: Object.freeze([]) as unknown as SectionPresentation[],
})

/** What a binding stands for: its column, or the foreign key of its lookup. */
export function fieldAnchor(binding: FieldBinding): FieldAnchor {
  return binding.kind === 'column' ? { kind: 'column', column: binding.column } : { kind: 'lookup', foreignKey: binding.foreignKey }
}
