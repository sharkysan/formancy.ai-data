/*
 * The four forms the image publishes at build time, and how each one's
 * policy and presentation are derived from what the generator makes of
 * the demo account's snapshot: customers, their orders, and each order's
 * lines and deliveries -- the master-detail chain the host page draws.
 * Parcels have rows and no form; a delete reaches them through the
 * cascades named.
 *
 * Nothing here chooses by field key. The generator's keys renumber -- the
 * order's two employee lookups are `employee` and `employee_2` -- so every
 * filter, through and label is chosen by foreign key and mapped onto
 * whatever key the bindings give it (0030). Who may do what is
 * personas.ts's ROLE_GRANTS; the fields' roles are the studio's "Fill
 * every field from the operations".
 */
import { applyPresentation, fieldAnchor, PRESENTATION_VERSION } from '@formancy/data-core'
import type {
  CascadeRule,
  FieldBinding,
  FormBindings,
  FormPolicy,
  GeneratedForm,
  GenerationRequest,
  MetadataSnapshot,
  PolicyOperation,
  PresentationOverrides,
  RowFilterRule,
} from '@formancy/data-core'
import { ROLE_GRANTS } from '../personas.js'
import type { DemoFormId, DemoRole } from '../personas.js'

/** The connection deploy/demo/connections.json names: the image's one database, as the demo's own account. */
export const CONNECTION = 'demo'

/** The schema every demo form's table is in: the fixture's. */
const SCHEMA = 'sales'

/** Rows of the person's tenant only. */
const TENANT: readonly RowFilterRule[] = [{ column: 'tenant_id', attribute: 'tenant' }]
/** Every row: a table shared by both tenants, as countries and employees are. */
const SHARED: readonly RowFilterRule[] = []

/** One lookup a demo form offers: what the generator is asked for, and what the policy and presentation say of it. */
export interface DemoLookup {
  foreignKey: string
  display: readonly string[]
  /** Which rows of its target it offers, as the policy's `lookups` says it. */
  filter: readonly RowFilterRule[]
  /** Its target's filter also scopes the form's own records (0043). */
  through?: true
  /** The label the presentation gives it, where the generator's says less. */
  label?: string
}

export interface DemoFormSpec {
  id: DemoFormId
  title: string
  table: string
  lookups: readonly DemoLookup[]
  /** Root columns the policy pins to the person's context: the tenant. */
  pinned: readonly string[]
  versionColumn?: string
  rowFilters: readonly RowFilterRule[]
  /** Every key a delete of a record acts through, with its action (0051): what the fixture declares. */
  cascades: readonly CascadeRule[]
}

const cascade = (table: string, foreignKey: string): CascadeRule => ({ table: { schema: SCHEMA, name: table }, foreignKey, onDelete: 'cascade' })

/** In DEMO_FORMS' order. */
export const DEMO_FORM_SPECS: readonly DemoFormSpec[] = [
  {
    id: 'customer',
    title: 'Customer',
    table: 'customer',
    lookups: [{ foreignKey: 'fk_customer_country', display: ['name'], filter: SHARED }],
    pinned: ['tenant_id'],
    rowFilters: TENANT,
    cascades: [],
  },
  {
    id: 'order',
    title: 'Order',
    table: 'order',
    lookups: [
      { foreignKey: 'fk_order_customer', display: ['name'], filter: TENANT },
      { foreignKey: 'fk_order_created_by', display: ['name'], filter: SHARED, label: 'Created by' },
      { foreignKey: 'fk_order_approved_by', display: ['name'], filter: SHARED, label: 'Approved by' },
    ],
    pinned: ['tenant_id'],
    versionColumn: 'row_version',
    rowFilters: TENANT,
    cascades: [cascade('delivery', 'fk_delivery_order'), cascade('order_line', 'fk_order_line_order'), cascade('parcel', 'fk_parcel_delivery')],
  },
  {
    id: 'order-line',
    title: 'Order line',
    table: 'order_line',
    // A line has no tenant of its own: it is its order's tenant's, through
    // the order (0043). An order is shown by its number and date: by its
    // date alone the generator draws a plain list of the first page, since
    // a search matches text and whole numbers only, and no order past it
    // could be chosen; by its number it is a typeahead.
    lookups: [{ foreignKey: 'fk_order_line_order', display: ['id', 'order_date'], filter: TENANT, through: true }],
    pinned: [],
    versionColumn: 'row_version',
    rowFilters: [],
    cascades: [],
  },
  {
    id: 'delivery',
    title: 'Delivery',
    table: 'delivery',
    // By number and date, as a line's order is.
    lookups: [{ foreignKey: 'fk_delivery_order', display: ['id', 'order_date'], filter: TENANT }],
    pinned: ['tenant_id'],
    versionColumn: 'row_version',
    rowFilters: TENANT,
    cascades: [cascade('parcel', 'fk_parcel_delivery')],
  },
]

/** What `POST /v1/form-proposals` is asked for this form. */
export function generationRequest(spec: DemoFormSpec): GenerationRequest {
  return {
    connection: CONNECTION,
    root: { schema: SCHEMA, name: spec.table },
    formId: spec.id,
    title: spec.title,
    lookups: spec.lookups.map(({ foreignKey, display }) => ({ foreignKey, display: [...display] })),
    ...(spec.pinned.length === 0 ? {} : { pinned: [...spec.pinned] }),
    ...(spec.versionColumn === undefined ? {} : { versionColumn: spec.versionColumn }),
  }
}

type LookupBinding = Extract<FieldBinding, { kind: 'lookup' }>

/** Each lookup binding with the demo's choice for its foreign key; refuses one the demo does not name, and a named one the bindings lack. */
function chosenLookups(spec: DemoFormSpec, bindings: FormBindings): Array<{ binding: LookupBinding; choice: DemoLookup }> {
  const lookups = bindings.fields.filter((binding): binding is LookupBinding => binding.kind === 'lookup')
  const chosen = lookups.map((binding) => {
    const choice = spec.lookups.find((candidate) => candidate.foreignKey === binding.foreignKey)
    if (choice === undefined)
      throw new Error(`${spec.id}: the generated form has a lookup over ${binding.foreignKey}, and the demo says nothing of which of its rows it may offer`)
    return { binding, choice }
  })
  for (const choice of spec.lookups) {
    if (!lookups.some((binding) => binding.foreignKey === choice.foreignKey))
      throw new Error(`${spec.id}: the demo names a lookup over ${choice.foreignKey}, and the generated form has none`)
  }
  return chosen
}

/**
 * The studio's "Fill every field from the operations"
 * (apps/studio/src/policy-model.ts, fillFromOperations): read to whoever
 * may read; write to whoever may create or update, where the form writes
 * the field at all and no row filter pins its column. forms.test.ts fails
 * when the two disagree.
 */
export function fieldsFromOperations(policy: FormPolicy, bindings: FormBindings): FormPolicy['fields'] {
  const pinned = new Set(policy.rowFilters.map((rule) => rule.column))
  const writers = [...new Set([...policy.operations.create, ...policy.operations.update])]
  const fields: FormPolicy['fields'] = {}
  for (const binding of bindings.fields) {
    const pinnedColumn = binding.kind === 'column' && pinned.has(binding.column)
    const written = binding.writes.create || binding.writes.update
    fields[binding.field] = { read: [...policy.operations.read], write: written && !pinnedColumn ? [...writers] : [] }
  }
  return fields
}

/**
 * This form's policy over the bindings the generator made: each operation
 * granted to the roles ROLE_GRANTS gives it here -- delete left out when
 * nobody may, so a form that offers none is not refused for a grant -- the
 * fields filled from the operations, each lookup filtered as the demo
 * chose for its foreign key, and the cascades named where somebody may
 * delete.
 */
export function demoPolicy(spec: DemoFormSpec, bindings: FormBindings): FormPolicy {
  const roles = (operation: PolicyOperation): string[] =>
    (Object.keys(ROLE_GRANTS) as DemoRole[]).filter((role) => ROLE_GRANTS[role].may[spec.id].includes(operation))
  const deleting = roles('delete')
  const lookups: FormPolicy['lookups'] = {}
  const through: string[] = []
  for (const { binding, choice } of chosenLookups(spec, bindings)) {
    lookups[binding.field] = choice.filter.map((rule) => ({ ...rule }))
    if (choice.through === true) through.push(binding.field)
  }
  const policy: FormPolicy = {
    version: 1,
    operations: { read: roles('read'), create: roles('create'), update: roles('update'), ...(deleting.length === 0 ? {} : { delete: deleting }) },
    fields: {},
    rowFilters: spec.rowFilters.map((rule) => ({ ...rule })),
    lookups,
    ...(through.length === 0 ? {} : { through }),
    ...(deleting.length === 0 || spec.cascades.length === 0 ? {} : { cascades: spec.cascades.map((rule) => ({ ...rule, table: { ...rule.table } })) }),
  }
  return { ...policy, fields: fieldsFromOperations(policy, bindings) }
}

/** The labels the demo gives its lookups, each on the field its foreign key has in the base, in the base's field order (0030). */
export function demoPresentation(spec: DemoFormSpec, base: GeneratedForm['form'], bindings: FormBindings): PresentationOverrides {
  const labelled = new Map(
    chosenLookups(spec, bindings).flatMap(({ binding, choice }) =>
      choice.label === undefined ? [] : [[binding.field, { binding, label: choice.label }] as const],
    ),
  )
  const fields = base.model.fields.flatMap((field) => {
    const entry = labelled.get(field.key)
    return entry === undefined ? [] : [{ field: field.key, anchor: fieldAnchor(entry.binding), label: entry.label }]
  })
  return { version: PRESENTATION_VERSION, fields, sections: [] }
}

/** What `POST /v1/form-proposals` answers. */
export interface Proposal extends GeneratedForm {
  snapshot: MetadataSnapshot
  generation: GenerationRequest
}

/**
 * The bundle `POST /v1/forms/:id/versions` publishes for a proposal: the
 * generated base, the demo's presentation and the form it makes of the
 * base, the bindings, the demo's policy and the snapshot -- format 2, as
 * the studio publishes and as scripts/getting-started/journey.mjs does.
 * Throws when the presentation does not apply to the base.
 */
export function demoBundle(spec: DemoFormSpec, proposal: Proposal) {
  const presentation = demoPresentation(spec, proposal.form, proposal.bindings)
  const presented = applyPresentation(proposal.form, presentation, proposal.bindings)
  if (!presented.ok) throw new Error(`${spec.id}: the demo's labels do not apply to the generated form: ${presented.problems.join('; ')}`)
  return {
    format: 2 as const,
    connection: CONNECTION,
    generation: proposal.generation,
    base: proposal.form,
    presentation,
    form: presented.form,
    bindings: proposal.bindings,
    policy: demoPolicy(spec, proposal.bindings),
    snapshot: proposal.snapshot,
  }
}
