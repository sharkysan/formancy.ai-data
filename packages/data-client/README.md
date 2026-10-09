<!-- Part of Formancy Data: https://github.com/sharkysan/formancy.ai-data -->

# @formancy/data-client

The browser's side of Formancy Data's runtime plane: one function per route
for a published form's definition, records and lookups, option sources that
both formancy renderers take, and a refusal's field problems in the shape a
form engine applies them
([0029](../../docs/decisions/0029-a-host-renders-a-published-form-through-one-client.md)).

Framework-neutral and fetch-based. It uses no Node API — the package's own
type check has no Node types, so a `node:` import does not compile — and runs
wherever `fetch` and `AbortSignal` exist.

**Licence.** Source-available under the Formancy Data licence in
[`LICENSE.md`](LICENSE.md), like every package in this repository; see the
licence table in the [repository README](../../README.md). It depends on the
Apache-2.0 `@formancy/spec` for types only.

## What it exports

```ts
createDataClient({ token, base?, fetch? }) // → { form, read, create, update, query, resolve }
lookupSources(client, formId, form, operation | () => operation) // → { [source]: { resolve } }
sourceNames(form)       // → every optionsSource the document names, once each, in document order
fieldProblems(refusal)  // → { [field]: [sentence, …] }, for engine.applyServerErrors
```

Every client function resolves to an `Outcome`: `{ ok: true, value }` or a
`Refusal` — `{ ok: false, status, code, message, fieldErrors? }`. It rejects
only for an abort the caller asked for, with the AbortError it raised.

| Function | Route |
|---|---|
| `form(formId)` | `GET /v1/forms/:id` → `{ form, operations, readable }` |
| `read(formId, record)` | `POST /v1/forms/:id/records/read` |
| `create(formId, answers)` | `POST /v1/forms/:id/records/create` |
| `update(formId, { record, version, answers })` | `POST /v1/forms/:id/records/update` |
| `query(formId, source, { operation, search, offset?, limit? }, signal?)` | `POST /v1/forms/:id/lookups/:source/query` |
| `resolve(formId, source, { operation, tokens }, signal?)` | `POST /v1/forms/:id/lookups/:source/resolve` |

The reply types — `PublishedForm`, `FormRecord`, `LookupResult`, `LookupRow`,
`FieldError` — are re-exported from `@formancy/data-core`, where the server's
handlers are checked against the same declarations.

## The rules it keeps for a host

- **The token is the host's, per request.** `token()` is called once for every
  request and its answer goes in `Authorization: Bearer …` and nowhere else —
  not a URL, not a body, not storage. A host whose session renews the token is
  never answered for the old one.
- **Same origin.** `base` defaults to `''`. The server sends no CORS headers
  ([0024](../../docs/decisions/0024-the-studio-speaks-only-the-admin-plane.md)),
  so the page that calls it is served from the server's origin or through a
  proxy on the page's own.
- **A name is one path segment.** A form id or a source name is
  `encodeURIComponent`'d into one segment under the form's routes. Empty, `.`
  and `..` cannot be one — `fetch` would resolve them to another route — and
  are refused as `invalid-name` before any request or token is made. A
  document decides which names exist, and never a URL, a header, a token, a
  tenant or an operation (formancy.ai 0077,
  [0012](../../docs/decisions/0012-a-lookup-token-is-a-reference-not-a-permission.md)).
- **Refusals are the server's, verbatim.** The client adds words only when
  the server said none: `unreachable` (status 0) when nothing answered,
  `unexpected` when what answered was not the data server's shape — a proxy's
  HTML page, a redirect, a captive portal's `200`. A refusal with a sentence
  and no code is `http-<status>`.
- **Field problems are sentences.** The 0.3.0 renderers print an error entry
  as it is, beside the field and in the error summary, so `fieldProblems`
  hands them the server's sentence, which never echoes a value. The code
  stays on the refusal for a program.

## In React

```tsx
import { createFormEngine } from '@formancy/core'
import { ErrorSummary, FormancyForm, FormancyProvider, OptionsSourcesProvider } from '@formancy/react'
import { createDataClient, fieldProblems, lookupSources } from '@formancy/data-client'

const client = createDataClient({ token: () => session.token() })
const published = await client.form('order')            // check .ok
const { form } = published.value
let held = { record: undefined as string | undefined, version: '', operation: 'create' as 'create' | 'update' }
const sources = lookupSources(client, 'order', form, () => held.operation)
const engine = createFormEngine({ schema: form, formId: 'order-react', capabilities })

async function save(outcome) {
  if (!outcome.ok) return                              // the engine's own errors are showing
  const saved = held.record === undefined
    ? await client.create('order', outcome.data)
    : await client.update('order', { record: held.record, version: held.version, answers: outcome.data })
  if (!saved.ok) {
    engine.applyServerErrors(fieldProblems(saved))       // {} when the refusal concerns no field
    return show(saved.message)                           // 409 stale: keep the draft and say so
  }
  held = { record: saved.value.record ?? undefined, version: saved.value.version ?? '', operation: 'update' }
}

<OptionsSourcesProvider value={sources}>
  <FormancyProvider engine={engine}>
    <ErrorSummary />
    <FormancyForm submitLabel="Save" onSubmit={save} />
  </FormancyProvider>
</OptionsSourcesProvider>
```

## In Angular

```ts
import { provideFormancy, provideFormancyOptionsSources } from '@formancy/angular'

const app = await createApplication({
  providers: [provideZonelessChangeDetection(), provideFormancy(engine), provideFormancyOptionsSources(sources)],
})
```

The same `sources` object serves both renderers: each declares its own
`OptionsSource` on purpose, and a `LookupSource` is assignable to both, which
a host's type check proves. Angular's providers are fixed once its injector
exists, so the operation is passed as a getter: a form that moves from create
to update asks under update's filter without a new application.

## What it does not do

- **No cache and no retry.** The server asks the policy on every request
  ([0022](../../docs/decisions/0022-the-runtime-plane-asks-the-policy-every-time.md)),
  and a write whose outcome is unknown — `502 unknown-outcome`, "may have been
  saved" — is the host's to reconcile, never the client's to send again
  ([0015](../../docs/decisions/0015-a-record-operation-is-one-guarded-statement.md)).
- **`hasMore` and `omitted` do not reach the person.** A renderer's 0.3.0
  option contract is a list of `{ value, label }`, so a list of exactly one
  page looks complete. A typeahead keeps narrowing; a plain select does not.
- **Records are addressed by token only.** The definition does not name the
  identity columns, so a host keeps the tokens that create, read and lookups
  return, or encodes its own key with data-core's `encodeKeyToken`.
- **Error sentences are the server's English.** The codes stay on the refusal
  for a host that translates.
- **A source answers for every name the document carries.** A host with its
  own named lists merges maps; a name the server does not know fails closed,
  as "could not be loaded".
