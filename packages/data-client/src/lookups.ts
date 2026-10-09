import type { FieldDef, FormSchema, RemoteOption } from '@formancy/spec'
import type { DataClient, LookupOperation } from './client.js'

export type { LookupOperation } from './client.js'

/*
 * The option sources a host hands either renderer (formancy.ai 0077). The
 * document names a list; the deployment says where it comes from, and here
 * that is always the runtime plane, under the same form, for the operation
 * the host has the form open for. A document decides which names exist and
 * nothing else: not a URL, a header, a token, a tenant or an operation (0012).
 *
 * `@formancy/react` and `@formancy/angular` each declare their own
 * `OptionsSource`, on purpose. A `LookupSource` declares only what it reads of
 * a request, and is assignable to both; a host's type check of
 * `OptionsSourcesProvider` and `provideFormancyOptionsSources` is what fails
 * when either contract moves.
 */

/** What a source reads of a renderer's request: the kind, the query or the stored values, the limit, and the signal. */
export type LookupRequest = { kind: 'search' | 'labels'; query: string; values: readonly string[]; limit: number; signal: AbortSignal }

/** One named list, answering through the runtime plane. */
export type LookupSource = { resolve(request: LookupRequest): Promise<readonly RemoteOption[]> }

function collect(fields: readonly FieldDef[], into: Set<string>): void {
  for (const field of fields) {
    if (field.optionsSource !== undefined) into.add(field.optionsSource)
    if (field.fields !== undefined) collect(field.fields, into)
  }
}

/** Every optionsSource the document names -- in groups and repeaters too -- once each, in document order. */
export function sourceNames(form: FormSchema): string[] {
  const names = new Set<string>()
  collect(form.model.fields, names)
  return [...names]
}

/**
 * One source per name the document carries, each answering through this
 * form's lookup routes.
 *
 * `operation` may be a getter: it is read on every request, so a form that
 * moves from create to update after its first save asks under update's filter
 * without a new map -- which, in Angular, would mean a new application.
 *
 * A search sends the renderer's query and limit; a label request resolves the
 * stored tokens, and asks nothing when there are none. A token the person may
 * not see is left out, not an error. A refusal rejects with the server's
 * sentence, which the renderer shows as "could not be loaded"; an abort
 * rejects with the AbortError. `hasMore` and `omitted` do not reach the
 * renderer, whose 0.3.0 contract has nowhere to put them (0029).
 */
export function lookupSources(
  client: DataClient,
  formId: string,
  form: FormSchema,
  operation: LookupOperation | (() => LookupOperation),
): Readonly<Record<string, LookupSource>> {
  const current = typeof operation === 'function' ? operation : () => operation
  const source = (name: string): LookupSource => ({
    async resolve(request) {
      if (request.kind === 'labels' && request.values.length === 0) return []
      const outcome =
        request.kind === 'search'
          ? await client.query(formId, name, { operation: current(), search: request.query, limit: request.limit }, request.signal)
          : await client.resolve(formId, name, { operation: current(), tokens: request.values }, request.signal)
      if (!outcome.ok) throw new Error(outcome.message)
      const rows = Array.isArray(outcome.value) ? outcome.value : outcome.value.rows
      return rows.map((row) => ({ value: row.token, label: row.label }))
    },
  })
  return Object.fromEntries(sourceNames(form).map((name) => [name, source(name)]))
}
