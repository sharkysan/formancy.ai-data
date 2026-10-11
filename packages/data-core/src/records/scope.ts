import type { FieldBinding, FormBindings } from '../generate/types.js'
import { buildLookupConfig } from '../lookup/config.js'
import { scopeRowFilters } from '../lookup/filters.js'
import type { RowFilters } from '../lookup/types.js'
import type { ColumnMeta, MetadataSnapshot, ObjectMeta } from '../metadata.js'
import { rowFilter, throughFilters } from '../policy/evaluate.js'
import { throughProblems } from '../policy/through.js'
import type { FormPolicy, PolicyContext, RowFilter } from '../policy/types.js'
import { findObject } from '../snapshot.js'
import type { PlanRefusal } from './plan-types.js'
import { columnsOf, inCatalogOrder, type Prepared, refuse } from './prepare.js'
import type { RecordColumn, Through } from './types.js'

/*
 * Which rows of the root a request reaches, and which of their columns: the
 * scope every planner puts on what it asks an adapter for. Kept apart from
 * the planners, which decide what a request does; this decides where it
 * may look.
 */

/** The root's filter for an operation, each term typed from its column and spelled as the column holds it (0028). */
export function filtersFor(prepared: Prepared, policy: FormPolicy, context: PolicyContext, operation: 'read' | 'update'): { ok: true; filter: RowFilter; filters: RowFilters } | PlanRefusal {
  const filter = rowFilter(policy, context, operation)
  if (!filter.ok) return filter
  const scoped = scopeRowFilters(prepared.root, filter.filter, 'rowFilters')
  return scoped.ok ? { ok: true, filter: filter.filter, filters: scoped.filters } : scoped
}

/**
 * The columns to read back: the key, when a token can carry it, and the
 * columns of every field the actor may see. Nothing else, so a column the
 * policy keeps from this actor is never fetched.
 */
export function readColumns(prepared: Prepared, bindings: FormBindings, fields: readonly string[]): RecordColumn[] {
  const names = new Set<string>(prepared.addressable ? prepared.target.identity.map((column) => column.name) : [])
  const wanted = new Set(fields)
  for (const binding of bindings.fields) if (wanted.has(binding.field)) for (const name of columnsOf(binding)) names.add(name)
  return inCatalogOrder(prepared.root, names)
}

/**
 * The policy's throughs for an operation (0043), each typed for an adapter:
 * the root's foreign-key columns with the snapshot's types, the lookup's
 * target and key as its config builds them, and its filter on the target
 * scoped as every filter is (0028). `[]` when the policy names none.
 *
 * `throughFilters` authorises the operation and resolves each filter from
 * the context, refusing a missing attribute; `throughProblems` -- the
 * function the publish check asks -- refuses a lookup that does not
 * configure or a key a through cannot compare, so the planner and the
 * server cannot disagree about one policy.
 */
export function throughFor(
  snapshot: MetadataSnapshot,
  bindings: FormBindings,
  prepared: Prepared,
  policy: FormPolicy,
  context: PolicyContext,
  operation: 'read' | 'update',
): { ok: true; through: Through[] } | PlanRefusal {
  const resolved = throughFilters(policy, context, bindings, operation)
  if (!resolved.ok) return resolved
  if (resolved.through.length === 0) return { ok: true, through: [] }
  const problems = throughProblems(snapshot, bindings, policy)
  if (problems.length > 0) return refuse('invalid-policy', problems.join('; '))
  const through: Through[] = []
  for (const { field, filter } of resolved.through) {
    // throughFilters fitted the policy, so the field is a lookup of this form;
    // throughProblems built its config, so building it again cannot throw.
    const binding = bindings.fields.find((candidate) => candidate.field === field) as Extract<FieldBinding, { kind: 'lookup' }>
    const config = buildLookupConfig(bindings, field, { snapshot })
    const scoped = scopeRowFilters(findObject(snapshot, config.target) as ObjectMeta, filter, `lookups.${field}`)
    if (!scoped.ok) return scoped
    through.push({
      columns: binding.columns.map((name): RecordColumn => ({ name, type: (prepared.columns.get(name) as ColumnMeta).type })),
      target: config.target,
      targetColumns: config.targetColumns,
      filters: scoped.filters,
    })
  }
  return { ok: true, through }
}

/**
 * The lookup fields a policy's through names, which a create must answer
 * and an update may not clear (0043): a row whose foreign key is NULL
 * references no parent, so no filter of anybody's admits it. The create is
 * authorised here as everywhere; an actor who may not create gets the
 * policy's refusal.
 */
export function throughFields(bindings: FormBindings, policy: FormPolicy, context: PolicyContext, operation: 'create' | 'update'): { ok: true; fields: ReadonlySet<string> } | PlanRefusal {
  const resolved = throughFilters(policy, context, bindings, operation)
  return resolved.ok ? { ok: true, fields: new Set(resolved.through.map((entry) => entry.field)) } : resolved
}
