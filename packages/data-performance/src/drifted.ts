import { EMPTY_PRESENTATION, encodeKeyToken } from '@formancy/data-core'
import type { FieldBinding, FormPolicy } from '@formancy/data-core'
import type { DataClient, WriteOutcome } from '@formancy/data-client'
import { DRIFTING, runtimeOf, WRITER } from '@formancy/data-fixtures'
import type { DriftingCase } from '@formancy/data-fixtures'
import mssql from 'mssql'
import postgres from 'postgres'
import type { CatalogueRefusal, EngineKey } from './results.js'
import { ENGINE_KEYS } from './results.js'

/*
 * The catalogue's refusals (0034, 0041): a create and an update on a form
 * whose own table its owner changed after the form was published, in a way
 * drift review says stops both writes and still allows reading. The runtime
 * must answer 409 `drift` and send the database nothing past the description
 * it decided over; the counting pass holds that to the catalogue's pins, and
 * nothing here is timed.
 *
 * The change is the shared `narrowed-decimal` case of `DRIFTING`
 * (`@formancy/data-fixtures`) -- its table, its ALTER, its create and the
 * reproduction's own update -- rather than one written here: the adapters'
 * definition suites and the server's drift suite run the same case on both
 * engines, so a runtime that stopped refusing it fails there as well as
 * here, and a case edited into one that no longer stops both writes is
 * refused by setup before anything is counted. The table is in schema
 * `drifting`, made by the database's owner, and granted to the order form's
 * writer, whose account every measured request uses.
 */

const CASE_NAME = 'narrowed-decimal'

/** The shared case, held to what the refusals need of it: reads allowed, both writes stopped, on both engines. */
export function driftedCase(cases: readonly DriftingCase[] = DRIFTING): DriftingCase {
  const entry = cases.find((candidate) => candidate.name === CASE_NAME)
  if (entry === undefined) throw new Error(`DRIFTING has no ${CASE_NAME} case`)
  const runtime = runtimeOf(entry)
  if (runtime === null || !runtime.read || runtime.create || runtime.update) throw new Error(`${CASE_NAME} no longer stops both writes while allowing reads: ${JSON.stringify(runtime)}`)
  if (entry.setUp.postgres === undefined || entry.setUp.sqlserver === undefined || entry.alter.postgres === undefined || entry.alter.sqlserver === undefined) {
    throw new Error(`${CASE_NAME} no longer runs on both engines`)
  }
  return entry
}

/** How the owner reaches each database: the fixtures' admin connection. */
export interface Owners {
  pg: string
  ms: mssql.config
}

/** Statements run one at a time as the owner; SQL Server's `create schema` must be a batch of its own. */
async function asOwner(owners: Owners, engine: EngineKey, statements: readonly string[]): Promise<void> {
  if (engine === 'pg') {
    const sql = postgres(owners.pg, { onnotice: () => {}, max: 1 })
    try {
      for (const statement of statements) await sql.unsafe(statement)
    } finally {
      await sql.end({ timeout: 5 })
    }
    return
  }
  const pool = await new mssql.ConnectionPool(owners.ms).connect()
  try {
    for (const statement of statements) await pool.request().batch(statement)
  } finally {
    await pool.close()
  }
}

/** The table as the case makes it, with its one row, and the writer granted what the clerk's form needs of it. */
export async function prepareDrifted(owners: Owners): Promise<void> {
  const entry = driftedCase()
  const table = `drifting.${entry.table}`
  await asOwner(owners, 'pg', ['create schema drifting', ...(entry.setUp.postgres as readonly string[]), `grant usage on schema drifting to ${WRITER.user}`, `grant select, insert, update on ${table} to ${WRITER.user}`])
  await asOwner(owners, 'ms', ['create schema drifting', ...(entry.setUp.sqlserver as readonly string[]), `grant select, insert, update on ${table} to ${WRITER.user}`])
}

/** The case's ALTER, as the owner, after the forms are published and their record read. */
export async function alterDrifted(owners: Owners): Promise<void> {
  const entry = driftedCase()
  await asOwner(owners, 'pg', entry.alter.postgres as readonly string[])
  await asOwner(owners, 'ms', entry.alter.sqlserver as readonly string[])
}

/** The connection the drifted forms are published on: the writer through the hop, the case's schema only. */
export const driftingConnection = (engine: EngineKey): string => `${engine}-hop-drifting`

/** `pg-hop-drifted`, `ms-hop-drifted`: counted through the hop only, never timed. */
export const driftedFormId = (engine: EngineKey): string => `${engine}-hop-drifted`

/** Everything the form offers, to the clerk, with no row filter: only drift can refuse. */
function everythingPolicy(fields: readonly FieldBinding[]): FormPolicy {
  return {
    version: 1,
    operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
    fields: Object.fromEntries(fields.map((binding) => [binding.field, { read: ['clerk'], write: binding.writes.create || binding.writes.update ? ['clerk'] : [] }])),
    rowFilters: [],
    lookups: Object.fromEntries(fields.filter((binding) => binding.kind === 'lookup').map((binding) => [binding.field, []])),
  }
}

/** Publishes one drifted form per engine through the administrator's plane, as `publishForms` does the order forms. */
export async function publishDrifted(admin: (path: string, body: unknown) => Promise<Record<string, unknown>>): Promise<void> {
  const entry = driftedCase()
  for (const engine of ENGINE_KEYS) {
    const formId = driftedFormId(engine)
    const connection = driftingConnection(engine)
    const { form, bindings, snapshot, generation } = await admin('/v1/form-proposals', {
      connection,
      root: { schema: 'drifting', name: entry.table },
      formId,
      title: entry.table,
      lookups: entry.lookups ?? [],
      ...(engine === 'pg' ? { versionColumn: 'row_version' } : {}),
    })
    const fields = (bindings as { fields: FieldBinding[] }).fields
    await admin(`/v1/forms/${formId}/versions`, {
      expectedBase: null,
      bundle: { format: 2, connection, generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy: everythingPolicy(fields), snapshot },
    })
  }
}

/** The case's one row, as the clerk read it before the ALTER: what the update sends back. */
export interface DriftedRecord {
  record: string
  version: string
}

/** Reads row 1 of each drifted form as the clerk, before the ALTER, for the update to name. */
export async function readDrifted(client: DataClient): Promise<Record<EngineKey, DriftedRecord>> {
  const encoded = encodeKeyToken(['1'])
  if (!encoded.ok) throw new Error(encoded.message)
  const read = {} as Record<EngineKey, DriftedRecord>
  for (const engine of ENGINE_KEYS) {
    const outcome = await client.read(driftedFormId(engine), encoded.token)
    if (!outcome.ok) throw new Error(`setup could not read row 1 of ${driftedFormId(engine)}: ${outcome.message}`)
    read[engine] = { record: outcome.value.record ?? '', version: outcome.value.version ?? '' }
  }
  return read
}

/** One refusal as the counting pass sends it and checks it. */
export interface RefusalExecutable {
  name: string
  formId: string
  send(): Promise<WriteOutcome>
  /** Throws naming the refusal on any answer but the catalogue's; returns what answered. */
  check(answer: WriteOutcome): { status: number; code: string }
}

/** Each catalogue refusal for one engine, against its drifted form. */
export function refusalsFor(engine: EngineKey, refusals: readonly CatalogueRefusal[], client: DataClient, record: DriftedRecord): Map<string, RefusalExecutable> {
  const entry = driftedCase()
  const formId = driftedFormId(engine)
  // The reproduction's own first write: on the narrowed column, a value its new scale would have rounded.
  const [update] = entry.updates
  if (update === undefined) throw new Error(`${CASE_NAME} has no update to send`)
  const sends: Record<string, () => Promise<WriteOutcome>> = {
    'create-drifted': () => client.create(formId, entry.insert),
    'update-drifted': () => client.update(formId, { record: record.record, version: record.version, answers: { [update.field]: update.value } }),
  }
  return new Map(
    refusals.map((refusal) => {
      const send = sends[refusal.name]
      if (send === undefined) throw new Error(`no request for the refusal ${refusal.name}`)
      const executable: RefusalExecutable = {
        name: refusal.name,
        formId,
        send,
        check(answer) {
          const wanted = `${String(refusal.answer.status)} ${refusal.answer.code}`
          if (answer.ok) throw new Error(`${engine} ${refusal.name} on ${formId}: saved, where the catalogue says ${wanted}`)
          if (answer.status !== refusal.answer.status || answer.code !== refusal.answer.code) {
            throw new Error(`${engine} ${refusal.name} on ${formId}: answered ${String(answer.status)} ${answer.code}: ${answer.message}, where the catalogue says ${wanted}`)
          }
          return { status: answer.status, code: answer.code }
        },
      }
      return [refusal.name, executable]
    }),
  )
}
