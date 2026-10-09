import type { FieldDef, FormSchema, LayoutNode, LogicRule } from '@formancy/spec'
import type { ColumnMeta, ForeignKeyMeta, MetadataSnapshot, ObjectMeta } from '../metadata.js'
import { findObject } from '../snapshot.js'
import { controlFor } from './controls.js'
import { createKeyAllocator, fieldKeyFor, labelFor, sourceNameFor } from './names.js'
import type { ConcurrencyBinding, FieldBinding, FormBindings, GeneratedForm, GenerationNote, GenerationRequest, LookupChoice } from './types.js'

/** formancy's form id rule. */
const FORM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Names a column that only might be a version column. Never trusted without confirmation. */
const VERSION_NAME = /^(row_?version|version|lock_?version)$/i

interface Planned {
  /** Position in the form: the catalog ordinal of the first column the field stands for. */
  ordinal: number
  field: FieldDef
  binding: FieldBinding
  system: boolean
  multiline: boolean
}

/**
 * A formancy form, its bindings and its notes, from a snapshot and a root.
 *
 * Deterministic: the same snapshot and request give the same output, byte for
 * byte, because a person reviews the result and a regeneration must change only
 * what the database changed. No model, no clock, no randomness.
 *
 * It throws on a request that cannot be honoured — an unknown root, a lookup
 * over a foreign key whose target this connection cannot see — rather than
 * generating a form that quietly lacks what was asked for.
 */
export function generateForm(snapshot: MetadataSnapshot, request: GenerationRequest): GeneratedForm {
  if (!FORM_ID.test(request.formId)) throw new Error(`form id ${JSON.stringify(request.formId)} is not one formancy accepts`)
  const root = findObject(snapshot, request.root)
  if (root === undefined) throw new Error(`${request.root.schema}.${request.root.name} is not in the snapshot`)

  const notes: GenerationNote[] = []
  const isView = root.kind === 'view'
  const allocate = createKeyAllocator()

  const lookups = resolveLookups(snapshot, root, request.lookups)
  const lookupByColumn = new Map<string, { choice: LookupChoice; foreignKey: ForeignKeyMeta }>()
  for (const entry of lookups) for (const column of entry.foreignKey.columns) lookupByColumn.set(column, entry)

  const identity = identityFor(root)
  const pinned = new Set(request.pinned ?? [])
  for (const name of pinned) {
    if (!root.columns.some((column) => column.name === name)) throw new Error(`${root.ref.name} has no column ${name} to pin`)
  }
  const lookupColumns = new Set(lookups.flatMap((entry) => entry.foreignKey.columns))
  // A pinned column is written from context, so it can no more be the version
  // column than a lookup's column can.
  const concurrency = concurrencyFor(root, request.versionColumn, identity ?? [], new Set([...lookupColumns, ...pinned]), notes)
  const planned: Planned[] = []

  for (const column of root.columns) {
    if (concurrency !== null && column.name === concurrency.column) continue
    const lookup = lookupByColumn.get(column.name)
    if (lookup !== undefined) {
      // A lookup takes the place of its first column; its other columns are part of it.
      if (lookup.foreignKey.columns[0] === column.name) planned.push(planLookup(root, lookup, request, allocate, isView, notes))
      continue
    }
    const plan = planColumn(root, column, allocate, isView, pinned.has(column.name), notes)
    if (plan !== null) planned.push(plan)
  }

  const operations = operationsFor(root, identity, concurrency, planned, pinned, notes)
  const rules: LogicRule[] = planned
    .filter((entry) => !entry.binding.writable)
    .map((entry) => ({ target: entry.field.key, kind: 'disabled', cel: 'true' }))

  const form: FormSchema = {
    specVersion: '3',
    id: request.formId,
    title: request.title,
    model: { fields: planned.map((entry) => entry.field) },
    ...(rules.length === 0 ? {} : { logic: { rules } }),
    layouts: [{ name: 'default', nodes: layoutFor(root, planned) }],
  }

  const bindings: FormBindings = {
    version: 1,
    root: { ...root.ref },
    rootKind: root.kind,
    identity,
    concurrency,
    operations,
    fields: planned.map((entry) => entry.binding),
    snapshotFingerprint: snapshot.fingerprint,
  }

  return { form, bindings, notes }
}

function resolveLookups(
  snapshot: MetadataSnapshot,
  root: ObjectMeta,
  choices: readonly LookupChoice[],
): Array<{ choice: LookupChoice; foreignKey: ForeignKeyMeta }> {
  const seen = new Map<string, string>()
  return choices.map((choice) => {
    const foreignKey = root.foreignKeys.find((candidate) => candidate.name === choice.foreignKey)
    if (foreignKey === undefined) throw new Error(`${root.ref.name} has no foreign key ${choice.foreignKey}`)
    if (foreignKey.references === null) {
      throw new Error(`${choice.foreignKey}'s target is not visible to this connection, so it cannot be offered as a lookup`)
    }
    const target = findObject(snapshot, foreignKey.references.table)
    if (target === undefined) {
      throw new Error(`${choice.foreignKey} points at ${foreignKey.references.table.schema}.${foreignKey.references.table.name}, which is outside the discovered scope`)
    }
    if (choice.display.length === 0) throw new Error(`${choice.foreignKey} needs at least one display column`)
    for (const name of choice.display) {
      if (!target.columns.some((column) => column.name === name)) {
        throw new Error(`${choice.foreignKey}: ${target.ref.name} has no column ${name} to display`)
      }
    }
    // One column bound through two lookups would take two values from two
    // selections, and a save would have to pick one. Refused until the
    // product can say which wins.
    for (const column of foreignKey.columns) {
      const other = seen.get(column)
      if (other !== undefined) throw new Error(`${column} belongs to both ${other} and ${choice.foreignKey}; offer one of them`)
      seen.set(column, choice.foreignKey)
    }
    return { choice, foreignKey }
  })
}

function planLookup(
  root: ObjectMeta,
  lookup: { choice: LookupChoice; foreignKey: ForeignKeyMeta },
  request: GenerationRequest,
  allocate: (wanted: string) => string,
  isView: boolean,
  notes: GenerationNote[],
): Planned {
  const { choice, foreignKey } = lookup
  const target = foreignKey.references
  if (target === null) throw new Error('unreachable: resolveLookups refused an unknown target')
  const columns = foreignKey.columns.map((name) => root.columns.find((column) => column.name === name))
  const nullable = columns.some((column) => column?.nullable === true)
  const writable = !isView && columns.every((column) => column !== undefined && column.generated === 'none')
  const required = writable && columns.every((column) => column !== undefined && !column.nullable && !column.hasDefault)
  const key = allocate(fieldKeyFor(target.table.name))
  const source = sourceNameFor(request.connection, root.ref, foreignKey.name)

  notes.push({
    subject: key,
    kind: 'inferred',
    message: `A lookup over ${foreignKey.name} (${foreignKey.columns.join(', ')}), showing ${choice.display.join(', ')} of ${target.table.name}; label from the table name.`,
  })

  return {
    ordinal: columns[0]?.ordinal ?? 0,
    field: { key, type: 'select', label: labelFor(target.table.name), optionsSource: source, ...(required ? { required: true } : {}) },
    binding: {
      kind: 'lookup',
      field: key,
      foreignKey: foreignKey.name,
      columns: [...foreignKey.columns],
      target: { table: { ...target.table }, columns: [...target.columns] },
      display: [...choice.display],
      source,
      nullable,
      writable,
    },
    system: false,
    multiline: false,
  }
}

function planColumn(
  root: ObjectMeta,
  column: ColumnMeta,
  allocate: (wanted: string) => string,
  isView: boolean,
  pinned: boolean,
  notes: GenerationNote[],
): Planned | null {
  const control = controlFor(column.type, column.nullable)
  if ('exclude' in control) {
    notes.push({ subject: column.name, kind: 'excluded', message: `${column.databaseType}: ${control.exclude}.` })
    return null
  }

  const key = allocate(fieldKeyFor(column.name))
  const generated = column.generated !== 'none'
  const writable = !isView && !generated && !pinned && control.readOnly === undefined
  const required = writable && !column.nullable && !column.hasDefault

  notes.push({ subject: key, kind: 'inferred', message: `${labelFor(control.describe)} from ${column.databaseType}; label from the column name.` })
  if (generated) notes.push({ subject: key, kind: 'read-only', message: `The database computes this value (${column.generated}).` })
  if (control.readOnly !== undefined) notes.push({ subject: key, kind: 'read-only', message: `Shown, never written: ${control.readOnly}.` })
  if (isView) notes.push({ subject: key, kind: 'read-only', message: `${root.ref.name} is a view.` })
  if (pinned) notes.push({ subject: key, kind: 'read-only', message: 'Pinned by the policy: its value comes from the trusted context, never from the person filling the form.' })

  return {
    ordinal: column.ordinal,
    field: { key, label: labelFor(column.name), ...control.field, ...(required ? { required: true } : {}) },
    binding: { kind: 'column', field: key, column: column.name, type: column.type, nullable: column.nullable, writable },
    system: generated,
    multiline: control.field.type === 'textarea',
  }
}

/**
 * Why a column cannot be a version column, or `null`.
 *
 * Every update increments a version column in the statement that checks it
 * (0015), so it must be an integer that statement may write and that means
 * nothing else: not computed by the database, which refuses the write; not
 * part of the key, which is the record's address and, with a tenant in it, its
 * tenant; not bound to a field, which could set it twice. The generator
 * holds a column to this before confirming or suggesting it, and the planner
 * holds a bindings file to it, so a form the one makes the other never refuses.
 */
export function versionColumnProblem(column: ColumnMeta, identity: readonly string[], bound: ReadonlySet<string>): string | null {
  if (column.type.kind !== 'integer' || column.nullable) return 'it must be a non-nullable integer'
  if (column.generated !== 'none') return `the database generates it (${column.generated})`
  if (identity.includes(column.name)) return "it is part of the record's key"
  if (bound.has(column.name)) return 'a field is bound to it'
  return null
}

/** `bound` is the chosen lookups' columns: any other column is left out of the form once it is the version column. */
function concurrencyFor(
  root: ObjectMeta,
  confirmed: string | undefined,
  identity: readonly string[],
  bound: ReadonlySet<string>,
  notes: GenerationNote[],
): ConcurrencyBinding | null {
  const rowversion = root.columns.find((column) => column.type.kind === 'rowversion')
  if (rowversion !== undefined) return { kind: 'rowversion', column: rowversion.name, confirmed: true }

  if (confirmed !== undefined) {
    const column = root.columns.find((candidate) => candidate.name === confirmed)
    const problem = column === undefined ? `${root.ref.name} has no such column` : versionColumnProblem(column, identity, bound)
    if (problem !== null) throw new Error(`${confirmed} cannot be a version column: ${problem}`)
    return { kind: 'version-column', column: confirmed, confirmed: true }
  }

  const candidate = root.columns.find((column) => VERSION_NAME.test(column.name) && versionColumnProblem(column, identity, bound) === null)
  if (candidate === undefined) return null
  notes.push({
    subject: candidate.name,
    kind: 'inferred',
    message: 'Looks like a version column by its name. It is not used until an administrator confirms that every writer increments it.',
  })
  return { kind: 'version-column', column: candidate.name, confirmed: false }
}

function identityFor(root: ObjectMeta): string[] | null {
  if (root.primaryKey !== null) return [...root.primaryKey.columns]
  const unique = root.uniqueKeys[0]
  return unique === undefined ? null : [...unique.columns]
}

function operationsFor(
  root: ObjectMeta,
  identity: string[] | null,
  concurrency: ConcurrencyBinding | null,
  planned: readonly Planned[],
  pinned: ReadonlySet<string>,
  notes: GenerationNote[],
): FormBindings['operations'] {
  if (root.kind === 'view') {
    notes.push({ subject: root.ref.name, kind: 'blocked', message: 'A view is read-only until a writable view is explicitly supported.' })
    return { create: false, update: false }
  }

  // A create needs a value for every column that has neither a default nor a
  // generator. One with no writable field — excluded for its type — cannot get one.
  // A pinned column gets its value from context, so it is never one nobody can fill.
  const bound = new Set([
    ...pinned,
    ...planned.flatMap((entry) =>
      entry.binding.writable ? (entry.binding.kind === 'lookup' ? entry.binding.columns : [entry.binding.column]) : [],
    ),
  ])
  const unreachable = root.columns.filter(
    (column) => !column.nullable && !column.hasDefault && column.generated === 'none' && !bound.has(column.name),
  )
  if (unreachable.length > 0) {
    notes.push({
      subject: root.ref.name,
      kind: 'blocked',
      message: `Create is not offered: ${unreachable.map((column) => column.name).join(', ')} must be given a value and no field can give one.`,
    })
  }

  let update = true
  if (identity === null) {
    update = false
    notes.push({ subject: root.ref.name, kind: 'blocked', message: 'Update is not offered: no primary or unique key identifies a record.' })
  } else if (concurrency === null || !concurrency.confirmed) {
    update = false
    notes.push({
      subject: root.ref.name,
      kind: 'blocked',
      message:
        concurrency === null
          ? 'Update is not offered: no rowversion and no confirmed version column, so a stale save could not be detected.'
          : `Update is not offered until ${concurrency.column} is confirmed as a version column.`,
    })
  }

  return { create: unreachable.length === 0, update }
}

function layoutFor(root: ObjectMeta, planned: readonly Planned[]): LayoutNode[] {
  const ordered = [...planned].sort((a, b) => a.ordinal - b.ordinal)
  const grid = (entries: readonly Planned[]): LayoutNode => ({
    kind: 'table',
    columns: 2,
    children: entries.map((entry) =>
      entry.multiline ? { kind: 'field', path: entry.field.key, span: 'all' } : { kind: 'field', path: entry.field.key },
    ),
  })

  const main = ordered.filter((entry) => !entry.system)
  const system = ordered.filter((entry) => entry.system)
  const nodes: LayoutNode[] = []
  if (main.length > 0) nodes.push({ kind: 'section', label: labelFor(root.ref.name), children: [grid(main)] })
  if (system.length > 0) nodes.push({ kind: 'section', label: 'Record', children: [grid(system)] })
  return nodes
}
