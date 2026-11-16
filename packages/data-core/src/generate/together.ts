import type { ObjectMeta } from '../metadata.js'
import { SAVE_MAX_ROWS } from '../records/save-limits.js'
import { LIST_PAGE_SIZE } from '../runtime.js'
import type { FieldBinding, FormBindings } from './types.js'

/*
 * A child's lookup saved with its parent (0155), as the bindings carry it:
 * read, and held to what a save can hold. The generator does not write one
 * yet; the planner reads it back, so a hand edit that breaks any rule here
 * is refused before anything is planned from it, and the rules are the
 * ones the generator will refuse a choice by.
 */

type LookupBinding = Extract<FieldBinding, { kind: 'lookup' }>

/** A form's together lookup, read: its binding and its bounds. */
export interface Together {
  binding: LookupBinding
  min: number
  max: number
}

/**
 * The largest `max` a together lookup may carry (0155): one row less than a
 * list's page, since a save over a saved record is planned from one page
 * of the child's list holding one row more than `max` (`planSaveList`), and
 * no page holds more than `LIST_PAGE_SIZE`; and no more than
 * `SAVE_MAX_ROWS`, the most of one child's creates a save was measured to
 * hold (save-limits.ts), whichever is fewer. The page is the fewer today.
 */
export const TOGETHER_MAX_ROWS = Math.min(LIST_PAGE_SIZE - 1, SAVE_MAX_ROWS)

/** Why `bounds` are not bounds a together lookup can carry -- whole numbers, `0 <= min <= max`, `max` at least 1 and at most `TOGETHER_MAX_ROWS` -- or `null`. */
export function boundsProblem(bounds: unknown): string | null {
  if (typeof bounds !== 'object' || bounds === null || Array.isArray(bounds)) return 'its bounds are not { min, max }'
  const { min, max, ...rest } = bounds as Record<string, unknown>
  if (Object.keys(rest).length > 0) return 'its bounds hold more than { min, max }'
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) return 'its bounds are not whole numbers'
  if ((min as number) < 0 || (min as number) > (max as number)) return 'its bounds are not 0 <= min <= max'
  if ((max as number) < 1) return 'its max is below 1'
  if ((max as number) > TOGETHER_MAX_ROWS) return `its max is above ${String(TOGETHER_MAX_ROWS)}, one row less than a list's page`
  return null
}

/**
 * The form's together lookup: `null` where no lookup carries one, and
 * `'malformed'` where more than one does, or one carries bounds no save
 * can hold. Nothing is planned from a malformed one (`togetherProblem`),
 * and a form that carries any is offered no write alone that a save makes
 * (`offeredFor`).
 */
export function togetherOf(bindings: Pick<FormBindings, 'fields'>): Together | 'malformed' | null {
  const carrying = bindings.fields.filter((binding): binding is LookupBinding => binding.kind === 'lookup' && Object.hasOwn(binding, 'together'))
  const [binding, ...others] = carrying
  if (binding === undefined) return null
  if (others.length > 0 || boundsProblem(binding.together) !== null) return 'malformed'
  const { min, max } = binding.together as { min: number; max: number }
  return { binding, min, max }
}

/**
 * Why the bindings' together lookup cannot be held, or `null` where they
 * carry none or one that can, read against the root as their snapshot has
 * it (0155):
 *
 * - one lookup carries it, with bounds a save can hold;
 * - it is written on create only: a row's record never changes after the
 *   module creates it (0027), so no update of a row alone moves it to
 *   another record, past either one's bound;
 * - every foreign-key column is NOT NULL: a row with no record cannot be
 *   counted under one;
 * - it references another table than the root: in a tree (0110) each row
 *   saved would be the record of another save;
 * - it is not the lookup's section (0109), and the form is not over
 *   versions (0113);
 * - the root has no row security: rows the database hides from the
 *   account would be left out of every count.
 */
export function togetherProblem(root: ObjectMeta, bindings: FormBindings): string | null {
  const together = togetherOf(bindings)
  if (together === null) return null
  if (together === 'malformed') {
    const carrying = bindings.fields.filter((binding) => binding.kind === 'lookup' && Object.hasOwn(binding, 'together'))
    return carrying.length > 1
      ? `${carrying.map((binding) => binding.field).join(' and ')} are each saved with their record, and one lookup of a form at most is`
      : `${(carrying[0] as LookupBinding).field} is saved with its record, and ${boundsProblem((carrying[0] as LookupBinding).together) as string}`
  }
  const { binding } = together
  const field = binding.field
  if (binding.writes.update) return `${field} is saved with its record and written on update, and a row's record is written on create only`
  const nullable = binding.columns.find((name) => root.columns.find((column) => column.name === name)?.nullable !== false)
  if (nullable !== undefined) return `${field} is saved with its record, and ${nullable} can be NULL, so a row could belong to none`
  if (binding.target.table.schema === root.ref.schema && binding.target.table.name === root.ref.name)
    return `${field} is saved with its record, and references the form's own table`
  if (binding.section !== undefined) return `${field} is saved with its record and is a section, and a section's lookup cannot be both`
  if (bindings.validity !== undefined) return `${field} is saved with its record, and a form over versions has no rows saved with a record`
  if (root.rowSecurity !== 'none') return `${field} is saved with its record, and row security on the table would hide rows from every count`
  return null
}

/**
 * Why `column` cannot be the touch column of a rowversion root with this
 * identity, or `null` (0155): a save of a record's rows alone sets it to
 * itself, which moves the rowversion and fires the table's UPDATE
 * triggers with `UPDATE(column)` true -- facts measured before this was
 * decided. So it is no column of a key or a foreign key, where a trigger
 * that guards the record's address or its tenant would refuse every such
 * save; not generated, which no statement sets; and one the account may
 * both read, which setting it to itself does, and update. A row filter
 * pinning it is the policy's to refuse.
 */
export function touchColumnProblem(root: ObjectMeta, identity: readonly string[], column: unknown): string | null {
  if (typeof column !== 'string') return 'the touch column is not a column name'
  const meta = root.columns.find((candidate) => candidate.name === column)
  if (meta === undefined) return `the touch column ${column} is not a column of the table`
  const keys = [identity, root.primaryKey?.columns ?? [], ...root.uniqueKeys.map((key) => key.columns), ...root.foreignKeys.map((key) => key.columns)]
  if (keys.some((names) => names.includes(column))) return `the touch column ${column} is in a key or a foreign key`
  if (meta.generated !== 'none') return `the touch column ${column} is generated`
  if (!meta.access.select || !meta.access.update) return `this connection's account may not both read and update the touch column ${column}`
  return null
}
