import type { FieldBinding, FormBindings, FormPolicy, RowFilterRule } from '@formancy/data-core'

/**
 * The policy the studio edits, as plain data, and the few things it derives
 * from the bindings. Whether a policy FITS the form is not decided here: that
 * is `validatePolicy` from data-core, the same function the server runs on
 * publish (0019), called live by the editor.
 */

/** Deny by default, everywhere: no role may do anything, no field is anybody's, no lookup decided. */
export const EMPTY_POLICY: FormPolicy = { version: 1, operations: { read: [], create: [], update: [] }, fields: {}, rowFilters: [], lookups: {} }

export type LookupBinding = Extract<FieldBinding, { kind: 'lookup' }>

export function lookupBindings(bindings: FormBindings): LookupBinding[] {
  return bindings.fields.filter((binding): binding is LookupBinding => binding.kind === 'lookup')
}

/** Roles as a person types them: separated by commas, blanks and repeats dropped, order kept. */
export function parseRoles(text: string): string[] {
  return [...new Set(text.split(',').map((role) => role.trim()).filter((role) => role !== ''))]
}

export function formatRoles(roles: readonly string[]): string {
  return roles.join(', ')
}

function union(...lists: ReadonlyArray<readonly string[]>): string[] {
  return [...new Set(lists.flat())]
}

/**
 * The root columns a row filter may name: the ones this form is bound to.
 * `validatePolicy` refuses any other, and the editor offers only these.
 */
export function boundColumns(bindings: FormBindings): string[] {
  const columns = new Set<string>(bindings.identity ?? [])
  if (bindings.concurrency !== null) columns.add(bindings.concurrency.column)
  for (const binding of bindings.fields) {
    for (const column of binding.kind === 'lookup' ? binding.columns : [binding.column]) columns.add(column)
  }
  return [...columns]
}

/**
 * Whether the policy pins different root columns from the ones the form was
 * generated with. The generator makes a pinned column's field read-only
 * (0011), so a form generated with other pins shows a field the policy will
 * refuse every value for -- or hides one it would accept.
 */
export function pinsDiffer(generatedWith: readonly string[], rowFilters: readonly RowFilterRule[]): boolean {
  const now = new Set(rowFilters.map((rule) => rule.column))
  return generatedWith.length !== now.size || generatedWith.some((column) => !now.has(column))
}

/**
 * The lookup filters the root's pins make necessary, added where the policy
 * has not decided a lookup yet.
 *
 * A lookup that sets a pinned root column must pin the paired target column to
 * the same attribute, or a row of another tenant could be chosen and its
 * tenant written into this one -- `validatePolicy` refuses the policy until it
 * does. That rule has one answer, so it is filled in; whether a lookup with no
 * pinned column offers every row is a decision, and is left for a person.
 */
export function withRequiredLookupPins(policy: FormPolicy, bindings: FormBindings): FormPolicy {
  const pinned = new Map(policy.rowFilters.map((rule) => [rule.column, rule.attribute]))
  const lookups = { ...policy.lookups }
  for (const binding of lookupBindings(bindings)) {
    if (Object.hasOwn(lookups, binding.field)) continue
    const rules: RowFilterRule[] = []
    binding.columns.forEach((column, index) => {
      const attribute = pinned.get(column)
      const paired = binding.target.columns[index]
      if (attribute !== undefined && paired !== undefined) rules.push({ column: paired, attribute })
    })
    if (rules.length > 0) lookups[binding.field] = rules
  }
  return { ...policy, lookups }
}

/**
 * Every field given the operations' roles: read to whoever may read, write to
 * whoever may create or update -- where the form writes the field at all and
 * no row filter pins its column. A starting point a person then narrows.
 */
export function fillFromOperations(policy: FormPolicy, bindings: FormBindings): FormPolicy {
  const pinned = new Set(policy.rowFilters.map((rule) => rule.column))
  const writers = union(policy.operations.create, policy.operations.update)
  const fields: FormPolicy['fields'] = {}
  for (const binding of bindings.fields) {
    const pinnedColumn = binding.kind === 'column' && pinned.has(binding.column)
    // Written on either operation is written (0027): a create-only field still takes a write grant.
    const written = binding.writes.create || binding.writes.update
    fields[binding.field] = { read: [...policy.operations.read], write: written && !pinnedColumn ? [...writers] : [] }
  }
  return { ...policy, fields }
}

/** Field entries for keys the form does not have: left from an earlier generation, and refused until removed. */
export function orphanFields(policy: FormPolicy, bindings: FormBindings): string[] {
  const keys = new Set(bindings.fields.map((binding) => binding.field))
  return Object.keys(policy.fields).filter((key) => !keys.has(key))
}

/**
 * Lookup entries for keys that are not lookup fields of this form: a filter's,
 * then a through's that has no filter entry (0043), each once.
 */
export function orphanLookups(policy: FormPolicy, bindings: FormBindings): string[] {
  const keys = new Set(lookupBindings(bindings).map((binding) => binding.field))
  const filtered = Object.keys(policy.lookups).filter((key) => !keys.has(key))
  return [...filtered, ...(policy.through ?? []).filter((key) => !keys.has(key) && !filtered.includes(key))]
}

/** One field's roles, with an entry that grants nothing removed rather than kept empty. */
export function withFieldRoles(policy: FormPolicy, key: string, read: string[], write: string[]): FormPolicy {
  const fields = { ...policy.fields }
  if (read.length === 0 && write.length === 0) delete fields[key]
  else fields[key] = { read, write }
  return { ...policy, fields }
}

/**
 * The policy with `through` set (0043), the property left out when it names
 * nothing: absent means none, and a policy that never uses it stays one a
 * server older than it still reads.
 */
export function withThrough(policy: FormPolicy, through: readonly string[]): FormPolicy {
  const { through: _, ...rest } = policy
  return through.length === 0 ? rest : { ...rest, through: [...through] }
}

/** The policy with every entry for `key` in its lookups and its through removed: what a lookup's grants take with them. */
export function withoutLookup(policy: FormPolicy, key: string): FormPolicy {
  const lookups = { ...policy.lookups }
  delete lookups[key]
  return withThrough({ ...policy, lookups }, (policy.through ?? []).filter((entry) => entry !== key))
}
