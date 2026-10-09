import { encodeKeyToken, formatLabel } from '@formancy/data-core'
import type { FieldBinding, ObjectRef } from '@formancy/data-core'
import type { OptionsSource, OptionsSources } from '@formancy/react'
import type { RemoteOption } from '@formancy/spec'
import type { Example } from './examples.js'
import customers from './fixture-customers.json'

/** One row as the database spelled it: every value text, or null. */
export type CapturedRow = Readonly<Record<string, string | null>>

/** Rows of one table, captured with the snapshot. */
export interface CapturedTable {
  table: ObjectRef
  rows: readonly CapturedRow[]
}

type LookupBinding = Extract<FieldBinding, { kind: 'lookup' }>

/**
 * The rows this page has, which are the fixture's two customers, read from the
 * same database in the same run as the snapshot (`scripts/capture-snapshot.mjs`).
 */
export const CAPTURED: readonly CapturedTable[] = [{ table: { schema: 'sales', name: 'customer' }, rows: customers.rows }]

function keyOf(binding: LookupBinding, row: CapturedRow): string[] {
  return binding.target.columns.map((column) => {
    const value = row[column]
    // A key column with no value has no canonical text and so no token.
    // Offering the row anyway would mean a select that stores a reference to
    // nothing, so the source refuses to exist instead.
    if (value === undefined || value === null) {
      throw new Error(`A captured ${binding.target.table.name} row has no ${column}, and ${binding.foreignKey} needs it for the key.`)
    }
    return value
  })
}

/**
 * An option source over rows held in memory, for one generated lookup.
 *
 * **In memory, because this page has no server.** A host resolves the same
 * name through the runtime plane's lookup routes, which `@formancy/data-client`
 * calls under the host's authorisation (0011, 0012, 0029), and apps/host
 * shows; these rows are not involved there. What this does the way the
 * server does: each option's value is the token `encodeKeyToken`
 * makes of the referenced key, in the foreign key's column order, and its
 * label is `formatLabel` over the display columns the bindings name. So the
 * answers a person stores here are the answers the server decodes.
 *
 * The narrowing is the source's job, not the control's (formancy.ai 0077), so
 * a search filters by label here and the control shows what it is given.
 */
export function inMemorySource(binding: LookupBinding, rows: readonly CapturedRow[]): OptionsSource {
  const options: RemoteOption[] = rows.map((row) => {
    const key = keyOf(binding, row)
    const token = encodeKeyToken(key)
    if (!token.ok) throw new Error(`${binding.foreignKey}: ${token.message}`)
    return { value: token.token, label: formatLabel(binding.display.map((column) => row[column] ?? null), key) }
  })

  return {
    resolve: ({ kind, query, values, limit, signal }) => {
      if (signal.aborted) return Promise.reject(new DOMException('The request was abandoned before it was answered.', 'AbortError'))
      if (kind === 'labels') return Promise.resolve(options.filter((option) => values.includes(option.value)))
      const folded = query.trim().toLowerCase()
      return Promise.resolve(options.filter((option) => option.label.toLowerCase().includes(folded)).slice(0, limit))
    },
  }
}

/**
 * The captured rows of one table, or `undefined` when there are none.
 *
 * Matched on schema and name separately, never on a joined `schema.name`: a
 * dot is legal in both, and this repository has been bitten by `a.b`.`c`
 * reading as `a`.`b.c` before. The page's note and the options map both ask
 * here, so the note cannot describe a source the renderers do not have.
 */
export function capturedRows(captured: readonly CapturedTable[], table: ObjectRef): readonly CapturedRow[] | undefined {
  return captured.find((entry) => entry.table.schema === table.schema && entry.table.name === table.name)?.rows
}

/**
 * The host's options map: one source per generated lookup whose target table
 * has captured rows, under the exact name the document carries.
 *
 * A lookup with no rows gets no entry, and the renderer then says on screen
 * that the application has not provided its list. That is the honest
 * fallback; an empty list would be a chooser with nothing in it.
 *
 * Both renderers get this one map. A capability belongs to the deployment and
 * not to a renderer -- formancy.ai's playground once gave it to React only,
 * and the Angular half quietly rendered one control fewer.
 */
export function lookupSources(examples: readonly Example[], captured: readonly CapturedTable[]): OptionsSources {
  const sources: Record<string, OptionsSource> = {}
  for (const example of examples) {
    for (const binding of example.generated.bindings.fields) {
      if (binding.kind !== 'lookup') continue
      const rows = capturedRows(captured, binding.target.table)
      if (rows !== undefined) sources[binding.source] = inMemorySource(binding, rows)
    }
  }
  return sources
}
