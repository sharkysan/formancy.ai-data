import { isKeyValue, isLookupKeyType } from '../lookup/values.js'
import type { ForeignKeyMeta, NormalizedType, ObjectMeta } from '../metadata.js'
import type { LookupChoice, SectionBinding } from './types.js'

/*
 * A form whose rows are sections of another table's records (0109): a
 * lookup the request marks `section`, checked against the root's key and
 * the table it references before anything is generated, so a form is never
 * published as a section of something it cannot be one of.
 */

const sameSet = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && left.every((name) => right.includes(name))

/** Whether `value` is spelled as a column of `type` holds it: a key's kinds as a token spells them (0012), a yes/no as `true` or `false`. */
function spelled(type: NormalizedType, value: string): boolean {
  if (type.kind === 'boolean') return value === 'true' || value === 'false'
  return isLookupKeyType(type) && isKeyValue(type, value)
}

/**
 * The binding of `choice`'s section, or `undefined` when it marks none. It
 * throws, as the generator does on any request it cannot honour, when:
 *
 * - the foreign key's columns are not the root's whole key, `identity`, in
 *   any order: then two rows could reference one record, and a section is
 *   one form;
 * - the condition's column is not one of `target`'s, the account may not
 *   read it, or it is of a kind whose values have more than one spelling --
 *   a section is shown by text, a number, a uuid, a date or a yes/no, which
 *   the page compares as the parent's form holds it;
 * - the value is not spelled as that column holds it, so no record would
 *   ever show the section.
 */
export function sectionFor(root: ObjectMeta, identity: readonly string[] | null, choice: LookupChoice, foreignKey: ForeignKeyMeta, target: ObjectMeta): SectionBinding | undefined {
  if (choice.section === undefined) return undefined
  if (identity === null || !sameSet(foreignKey.columns, identity)) {
    throw new Error(`${choice.foreignKey} is not the whole key of ${root.ref.name}, so a ${target.ref.name} could have more than one of its rows: it cannot be a section`)
  }
  const when = choice.section.when
  if (when === null) return { when: null }
  const column = target.columns.find((candidate) => candidate.name === when.column)
  if (column === undefined) throw new Error(`${choice.foreignKey}: ${target.ref.name} has no column ${when.column} to show the section by`)
  if (!column.access.select) throw new Error(`${choice.foreignKey}: this connection's account may not read ${target.ref.name}.${column.name}, so it cannot show the section by it`)
  if (column.type.kind !== 'boolean' && !isLookupKeyType(column.type)) {
    throw new Error(`${choice.foreignKey}: ${column.name} is ${column.databaseType}; a section is shown by text, a whole number, a decimal, a uuid, a date or a yes/no`)
  }
  if (!spelled(column.type, when.value)) throw new Error(`${choice.foreignKey}: the value that shows the section is not spelled as ${target.ref.name}.${column.name} holds it`)
  return { when: { column: column.name, type: column.type, value: when.value } }
}
