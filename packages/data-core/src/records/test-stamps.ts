import type { DatabaseKind } from '../adapter.js'
import { generateForm } from '../generate/generate.js'
import type { GeneratedForm, GenerationRequest, StampChoice } from '../generate/types.js'
import type { MetadataSnapshot, NormalizedType, ObjectMeta } from '../metadata.js'
import type { FormPolicy, PolicyContext } from '../policy/types.js'
import { col, DATE, INT32, sales, snapshot, table, TENANT, text, withDeleteFacts } from './test-support.js'

/*
 * A table whose rows say who wrote them and when (0153), as the parity
 * fixture's `audited` is: the person and the time of the create, the site
 * the person worked in, the person and the time of the last update, the
 * day of it, and `noted_at`, which the database fills by its own default
 * and nothing stamps.
 */

const INSTANT: NormalizedType = { kind: 'timestamp', withTimeZone: true, precision: 6 }
const WALL_CLOCK: NormalizedType = { kind: 'timestamp', withTimeZone: false, precision: 3 }

/** The snapshot with `sales.audited`, edited as a case needs. */
export function audited(kind: DatabaseKind, edit: (objects: ObjectMeta[]) => void = () => {}): MetadataSnapshot {
  return snapshot(kind, (objects) => {
    objects.push(
      table(
        'audited',
        [
          col('id', 1, INT32, { generated: 'identity-always' }),
          col('tenant_id', 2, INT32),
          col('note', 3, text(50), { nullable: true }),
          col('created_by', 4, text(40)),
          col('created_at', 5, INSTANT),
          col('created_in', 6, text(20), { nullable: true }),
          col('changed_by', 7, text(40), { nullable: true }),
          col('changed_at', 8, WALL_CLOCK, { nullable: true }),
          col('changed_on', 9, DATE, { nullable: true }),
          col('noted_at', 10, INSTANT, { hasDefault: true, defaultExpression: kind === 'postgres' ? 'now()' : '(sysdatetimeoffset())' }),
          col('version', 11, INT32, { hasDefault: true }),
        ],
        { primaryKey: { name: 'pk_audited', columns: ['id'] } },
      ),
    )
    edit(objects)
    withDeleteFacts(objects)
  })
}

/** What the administrator confirms: who created the row, when and where, who changed it last and when, and the day. */
export const STAMPS: StampChoice[] = [
  { column: 'created_by', value: { kind: 'actor' }, on: 'create' },
  { column: 'created_at', value: { kind: 'time' }, on: 'create' },
  { column: 'created_in', value: { kind: 'attribute', attribute: 'site' }, on: 'create' },
  { column: 'changed_by', value: { kind: 'actor' }, on: 'update' },
  { column: 'changed_at', value: { kind: 'time' }, on: 'both' },
  { column: 'changed_on', value: { kind: 'time' }, on: 'update' },
]

/** The audited form: its stamps -- STAMPS unless a case names others, `null` for none at all -- the tenant pinned, the version column confirmed. */
export function auditedForm(
  source: MetadataSnapshot,
  stamps: StampChoice[] | null = STAMPS,
  extra: { [Key in keyof GenerationRequest]?: GenerationRequest[Key] | undefined } = {},
): GeneratedForm {
  const request: Record<string, unknown> = {
    connection: 'erp',
    root: sales('audited'),
    formId: 'sales-audited',
    title: 'Audited',
    lookups: [],
    pinned: ['tenant_id'],
    versionColumn: 'version',
    ...(stamps === null ? {} : { stamps }),
    ...extra,
  }
  // A case's `undefined` takes the property out, as a request without it.
  for (const [key, value] of Object.entries(request)) if (value === undefined) delete request[key]
  return generateForm(source, request as unknown as GenerationRequest)
}

const READ = { read: ['clerk', 'auditor'], write: [] }

/** Clerks write notes in tenant 1; an auditor reads every field. Nobody writes a stamp: there is no grant that could. */
export const AUDITED_POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk', 'auditor'], create: ['clerk'], update: ['clerk'] },
  fields: {
    id: READ,
    tenant_id: READ,
    note: { read: ['clerk', 'auditor'], write: ['clerk'] },
    created_by: READ,
    created_at: READ,
    created_in: READ,
    changed_by: READ,
    changed_at: READ,
    changed_on: READ,
    noted_at: READ,
  },
  rowFilters: TENANT,
  lookups: {},
}

/** A clerk of tenant 1 working at `site`, signed in as `id`. */
export const signedIn = (id: string, attributes: Record<string, string> = { tenant: '1', site: 'Bern' }): PolicyContext => ({
  actor: { id, roles: ['clerk'] },
  attributes,
})

export { DATE, INSTANT, WALL_CLOCK }
