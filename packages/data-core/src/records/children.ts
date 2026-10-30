import { canonicalize } from '@formancy/spec'
import type { FieldBinding, FormBindings, SectionBinding } from '../generate/types.js'
import type { MetadataSnapshot } from '../metadata.js'
import { findObject } from '../snapshot.js'

/*
 * Which forms' rows are children of another form's records (0045): derived
 * from what two published bundles say, never declared in either. Pure, and
 * structure only -- who may see a child is the menu's (`menu.ts`).
 */

/** One published form as a derivation of children reads it: the connection it is bound to, the snapshot its bindings were generated from, and the bindings. */
export interface PublishedTable {
  connection: string
  snapshot: MetadataSnapshot
  bindings: FormBindings
}

type LookupBinding = Extract<FieldBinding, { kind: 'lookup' }>

/** The canonical types of `names` in the bindings' root as `source` describes it, or `null` when any of them is not there. */
function typesOf(source: MetadataSnapshot, bindings: FormBindings, names: readonly string[]): string[] | null {
  const root = findObject(source, bindings.root)
  const types = names.map((name) => root?.columns.find((column) => column.name === name)?.type)
  return types.every((type) => type !== undefined) ? types.map((type) => canonicalize(type)) : null
}

/**
 * What one form's records offer a child, read from that form alone: its
 * connection, its root, and its identity's columns in order with their
 * types as its own snapshot gives them -- the parts its record token is
 * spelled from. `null` when its records have no token.
 */
export interface ParentKey {
  connection: string
  schema: string
  table: string
  columns: string[]
  types: string[]
}

/**
 * One lookup of a form, read from that form alone: the table and columns
 * its foreign key references, and its own columns' types as its own
 * snapshot gives them, `null` when one is not there.
 */
export interface ChildLookup {
  connection: string
  field: string
  schema: string
  table: string
  references: string[]
  types: string[] | null
  /** The lookup's section (0109), or `null` when it is not one. */
  section: SectionBinding | null
}

/**
 * `form`'s `ParentKey`, read from its bundle alone. Bindings a hand edit
 * left in another shape than its check reads throw here, before any other
 * form's are compared with them, so a caller can leave that one form out.
 */
export function parentKey(form: PublishedTable): ParentKey | null {
  const { identity, root } = form.bindings
  if (identity === null || identity.length === 0) return null
  const types = typesOf(form.snapshot, form.bindings, identity)
  if (types === null) return null
  return { connection: form.connection, schema: root.schema, table: root.name, columns: [...identity], types }
}

/** `form`'s lookups as `ChildLookup`s, in its bindings' order, read from its bundle alone as `parentKey` reads one. */
export function childLookups(form: PublishedTable): ChildLookup[] {
  return form.bindings.fields
    .filter((binding): binding is LookupBinding => binding.kind === 'lookup')
    .map((binding) => ({
      connection: form.connection,
      field: binding.field,
      schema: binding.target.table.schema,
      table: binding.target.table.name,
      references: [...binding.target.columns],
      types: typesOf(form.snapshot, form.bindings, binding.columns),
      section: binding.section ?? null,
    }))
}

const sameList = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && left.every((item, index) => item === right[index])

/**
 * The fields of `lookups` through which their form's rows are children of
 * the records `key` spells: compared as read, so nothing here can throw,
 * whatever either form's bundle held.
 */
export function referencingFields(key: ParentKey | null, lookups: readonly ChildLookup[]): string[] {
  if (key === null) return []
  return lookups
    .filter(
      (lookup) =>
        lookup.connection === key.connection &&
        lookup.schema === key.schema &&
        lookup.table === key.table &&
        sameList(lookup.references, key.columns) &&
        lookup.types !== null &&
        sameList(lookup.types, key.types),
    )
    .map((lookup) => lookup.field)
}

/**
 * The lookup fields of `child` through which its rows are children of
 * `parent`'s records, in the child's bindings' order: `[]` when there are
 * none.
 *
 * The parent form's token for a record is a value the child's field takes,
 * so a page can hand it to the child's list as its `parent` (0044) and get
 * the rows whose foreign key references that record, by the database's own
 * equality -- the one the foreign key was checked by. Where that equality
 * is bytewise, each of those rows' field spells the parent's token byte for
 * byte; on a text key under a collation that ignores case or trailing
 * spaces it need not, as `ch` references `CH` on SQL Server (0044's
 * `text-parent`). A field is one when all of these hold:
 *
 * - both forms are bound to the same connection: a table of the same name
 *   on another connection is another database's;
 * - it is a lookup whose foreign key references the parent's root on
 *   exactly the parent's identity, column for column in the identity's
 *   order -- the columns the parent's token spells, in the order it spells
 *   them. A foreign key onto a unique key that is not the identity, as a
 *   customer's onto its country's `iso_code`, references rows by values no
 *   token of the parent spells;
 * - each of its foreign-key columns, as the child's snapshot describes it,
 *   has the normalized type the referenced identity column has in the
 *   parent's: the child decodes the parent's token through its own
 *   columns' codecs (`lookupAnswer`), which take only the spelling the
 *   column holds, so a `numeric(12,4)` key onto a `numeric(12,2)` one
 *   would refuse the parent's `1.50`. Each side's types come from its own
 *   snapshot, because each side's token is made and read through its own.
 *
 * A form can be its own child, through a self-reference, and a child of
 * one parent through two fields. The menu reads each form once, alone, into
 * its `parentKey` and `childLookups`, and compares those with
 * `referencingFields`, as this does for two.
 */
export function childFields(parent: PublishedTable, child: PublishedTable): string[] {
  return referencingFields(parentKey(parent), childLookups(child))
}
