import type { FieldDef, FormSchema, LayoutNode, LogicRule } from '@formancy/spec'
import type { ColumnMeta, ForeignKeyMeta, Generation, MetadataSnapshot, ObjectMeta } from '../metadata.js'
import { findObject } from '../snapshot.js'
import { assertReadableLookup, assertReadableRoot, identityFor, rowSecurityNotes, UNREADABLE, uninsertablePins, versionAccessProblem, writesFor } from './access.js'
import { controlFor } from './controls.js'
import { createKeyAllocator, fieldKeyFor, labelFor, sourceNameFor } from './names.js'
import type { ConcurrencyBinding, FieldBinding, FormBindings, GeneratedForm, GenerationNote, GenerationRequest, LookupChoice } from './types.js'
import { BINDINGS_VERSION } from './version.js'

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
  /** Written on some operation but for privilege: what update is blocked by when no field the form writes may be updated. */
  privilegeOnly: boolean
}

/** A lookup the request asked for: its choice, its foreign key, and the table it reaches. */
interface ResolvedLookup {
  choice: LookupChoice
  foreignKey: ForeignKeyMeta
  target: ObjectMeta
}

/**
 * A formancy form, its bindings and its notes, from a snapshot and a root.
 *
 * Deterministic: the same snapshot and request give the same output, byte for
 * byte, because a person reviews the result and a regeneration must change only
 * what the database changed. No model, no clock, no randomness.
 *
 * It throws on a request that cannot be honoured — an unknown root, a lookup
 * over a foreign key whose target this connection cannot see, a root or a
 * lookup column the account may not read — rather than generating a form that
 * quietly lacks what was asked for. What the account may do decides what the
 * form offers (0027): see `access.ts`.
 */
export function generateForm(snapshot: MetadataSnapshot, request: GenerationRequest): GeneratedForm {
  if (!FORM_ID.test(request.formId)) throw new Error(`form id ${JSON.stringify(request.formId)} is not one formancy accepts`)
  const root = findObject(snapshot, request.root)
  if (root === undefined) throw new Error(`${request.root.schema}.${request.root.name} is not in the snapshot`)
  assertReadableRoot(root)

  const notes: GenerationNote[] = []
  const isView = root.kind === 'view'
  const allocate = createKeyAllocator()

  const lookups = resolveLookups(snapshot, root, request.lookups)
  const lookupByColumn = new Map<string, ResolvedLookup>()
  for (const entry of lookups) for (const column of entry.foreignKey.columns) lookupByColumn.set(column, entry)

  const identity = identityFor(root, notes)
  const pinned = new Set(request.pinned ?? [])
  for (const name of pinned) {
    if (!root.columns.some((column) => column.name === name)) throw new Error(`${root.ref.name} has no column ${name} to pin`)
  }
  const fixedOut = uninsertablePins(root, pinned)
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

  const operations = operationsFor(root, identity, concurrency, planned, { pinned, fixedOut }, notes)
  rowSecurityNotes(snapshot, [root, ...lookups.map((entry) => entry.target)], notes)
  const rules: LogicRule[] = planned
    .filter((entry) => !entry.binding.writes.create && !entry.binding.writes.update)
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
    version: BINDINGS_VERSION,
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

function resolveLookups(snapshot: MetadataSnapshot, root: ObjectMeta, choices: readonly LookupChoice[]): ResolvedLookup[] {
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
    assertReadableLookup(root, foreignKey, target, choice.display)
    // One column bound through two lookups would take two values from two
    // selections, and a save would have to pick one. Refused until the
    // product can say which wins.
    for (const column of foreignKey.columns) {
      const other = seen.get(column)
      if (other !== undefined) throw new Error(`${column} belongs to both ${other} and ${choice.foreignKey}; offer one of them`)
      seen.set(column, choice.foreignKey)
    }
    return { choice, foreignKey, target }
  })
}

function planLookup(
  root: ObjectMeta,
  lookup: ResolvedLookup,
  request: GenerationRequest,
  allocate: (wanted: string) => string,
  isView: boolean,
  notes: GenerationNote[],
): Planned {
  const { choice, foreignKey } = lookup
  const target = foreignKey.references
  if (target === null) throw new Error('unreachable: resolveLookups refused an unknown target')
  // The snapshot refused a foreign key over a column the table does not have.
  const columns = foreignKey.columns.map((name) => root.columns.find((column) => column.name === name) as ColumnMeta)
  const nullable = columns.some((column) => column.nullable)
  const key = allocate(fieldKeyFor(target.table.name))
  const source = sourceNameFor(request.connection, root.ref, foreignKey.name)

  notes.push({
    subject: key,
    kind: 'inferred',
    message: `A lookup over ${foreignKey.name} (${foreignKey.columns.join(', ')}), showing ${choice.display.join(', ')} of ${target.table.name}; label from the table name.`,
  })
  const possible = !isView && columns.every((column) => column.generated === 'none')
  const writes = writesFor(columns, possible, key, notes)
  const required = writes.create && columns.every((column) => !column.nullable && !column.hasDefault)

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
      writes,
    },
    system: false,
    multiline: false,
    privilegeOnly: possible,
  }
}

/**
 * Why a generated column is shown and never written, per kind. A by-default
 * identity would accept a value; it is still never written, because a number
 * chosen by hand does not advance the sequence and a later create
 * collides with it (0026).
 */
function generatedNote(generated: Exclude<Generation, 'none'>): string {
  switch (generated) {
    case 'identity-always':
      return 'The database numbers this value (identity-always) and refuses one given to it.'
    case 'identity-by-default':
      return 'The database numbers this value when a create leaves it out (identity-by-default). It would accept one, and the form never gives it: a number chosen by hand is one its sequence would later hand out again.'
    case 'computed':
      return 'The database computes this value (computed).'
    case 'rowversion':
      return 'The database writes this value (rowversion).'
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
  if (!column.access.select) {
    notes.push({ subject: column.name, kind: 'excluded', message: UNREADABLE })
    return null
  }
  const control = controlFor(column.type, column.nullable)
  if ('exclude' in control) {
    notes.push({ subject: column.name, kind: 'excluded', message: `${column.databaseType}: ${control.exclude}.` })
    return null
  }

  const key = allocate(fieldKeyFor(column.name))
  const generated = column.generated !== 'none'
  const possible = !isView && !generated && !pinned && control.readOnly === undefined

  notes.push({ subject: key, kind: 'inferred', message: `${labelFor(control.describe)} from ${column.databaseType}; label from the column name.` })
  if (control.caveat !== undefined) notes.push({ subject: key, kind: 'inferred', message: control.caveat })
  if (column.generated !== 'none') notes.push({ subject: key, kind: 'read-only', message: generatedNote(column.generated) })
  if (control.readOnly !== undefined) notes.push({ subject: key, kind: 'read-only', message: `Shown, never written: ${control.readOnly}.` })
  if (isView) notes.push({ subject: key, kind: 'read-only', message: `${root.ref.name} is a view.` })
  if (pinned) notes.push({ subject: key, kind: 'read-only', message: 'Pinned by the policy: its value comes from the trusted context, never from the person filling the form.' })
  const writes = writesFor([column], possible, key, notes)
  const required = writes.create && !column.nullable && !column.hasDefault

  return {
    ordinal: column.ordinal,
    field: { key, label: labelFor(column.name), ...control.field, ...(required ? { required: true } : {}) },
    binding: { kind: 'column', field: key, column: column.name, type: column.type, nullable: column.nullable, writes },
    system: generated,
    multiline: control.field.type === 'textarea',
    privilegeOnly: possible,
  }
}

/**
 * Why a column cannot be a version column, or `null`.
 *
 * Every update increments a version column in the statement that checks it
 * (0015), so it must be an integer that statement may write and that means
 * nothing else: not computed by the database, which refuses the write; not
 * part of the key, which is the record's address and, with a tenant in it, its
 * tenant; not bound to a field, which could set it twice. And the account
 * must be allowed to read it and to UPDATE it (0027), or every save fails.
 * The generator holds a column to this before confirming or suggesting it,
 * and the planner holds a bindings file to it, so a form the one makes the
 * other never refuses.
 */
export function versionColumnProblem(column: ColumnMeta, identity: readonly string[], bound: ReadonlySet<string>): string | null {
  if (column.type.kind !== 'integer' || column.nullable) return 'it must be a non-nullable integer'
  if (column.generated !== 'none') return `the database generates it (${column.generated})`
  const access = versionAccessProblem(column)
  if (access !== null) return access
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
  if (rowversion !== undefined && !rowversion.access.select) {
    // Not a field either: a rowversion never is, and this one cannot even be shown.
    notes.push({
      subject: root.ref.name,
      kind: 'blocked',
      message: `Update is not offered: this connection's account may not read ${rowversion.name}, the rowversion a stale save is detected by.`,
    })
    return null
  }
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

/** The pinned columns, and those of them the account may not INSERT, which a create could never write from context. */
interface Pins {
  pinned: ReadonlySet<string>
  fixedOut: readonly ColumnMeta[]
}

function createFor(root: ObjectMeta, planned: readonly Planned[], { pinned, fixedOut }: Pins, notes: GenerationNote[]): boolean {
  const blocked = (message: string) => notes.push({ subject: root.ref.name, kind: 'blocked', message })
  if (!root.columns.some((column) => column.access.insert)) {
    blocked(`Create is not offered: this connection's account may INSERT none of the columns of ${root.ref.schema}.${root.ref.name}.`)
    return false
  }
  for (const column of fixedOut) {
    blocked(`Create is not offered: ${column.name} is pinned by the policy and written from the trusted context, and this connection's account may not INSERT it.`)
  }

  // A create needs a value for every column that has neither a default nor a
  // generator. One with no field written on create — excluded for its type,
  // unreadable, or not insertable — cannot get one. A pinned column gets its
  // value from context, so it is never one nobody can fill; one the account
  // may not insert was said above.
  const bound = new Set([
    ...pinned,
    ...planned.flatMap((entry) => (entry.binding.writes.create ? (entry.binding.kind === 'lookup' ? entry.binding.columns : [entry.binding.column]) : [])),
  ])
  const unreachable = root.columns.filter((column) => !column.nullable && !column.hasDefault && column.generated === 'none' && !bound.has(column.name))
  if (unreachable.length > 0) blocked(`Create is not offered: ${unreachable.map((column) => column.name).join(', ')} must be given a value and no field can give one.`)
  return unreachable.length === 0 && fixedOut.length === 0
}

function operationsFor(
  root: ObjectMeta,
  identity: string[] | null,
  concurrency: ConcurrencyBinding | null,
  planned: readonly Planned[],
  pins: Pins,
  notes: GenerationNote[],
): FormBindings['operations'] {
  if (root.kind === 'view') {
    notes.push({ subject: root.ref.name, kind: 'blocked', message: 'A view is read-only until a writable view is explicitly supported.' })
    return { create: false, update: false }
  }

  const create = createFor(root, planned, pins, notes)
  let update = true
  if (identity === null) {
    // identityFor noted a key the account cannot read; only a table with no key at all is said here.
    update = false
    if (root.primaryKey === null && root.uniqueKeys.length === 0) {
      notes.push({ subject: root.ref.name, kind: 'blocked', message: 'Update is not offered: no primary or unique key identifies a record.' })
    }
  } else if (concurrency === null && root.columns.some((column) => column.type.kind === 'rowversion')) {
    // concurrencyFor noted the rowversion the account cannot read.
    update = false
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
  } else if (planned.some((entry) => entry.privilegeOnly) && !planned.some((entry) => entry.binding.writes.update)) {
    // Something would be written on update but for privilege, and nothing is:
    // the database would refuse every save. A form that writes nothing for
    // other reasons keeps the behaviour it had before 0027.
    update = false
    notes.push({ subject: root.ref.name, kind: 'blocked', message: "Update is not offered: this connection's account may UPDATE none of the columns this form writes." })
  }

  return { create, update }
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
