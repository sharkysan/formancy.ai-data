<!-- Part of Formancy Data: https://github.com/sharkysan/formancy.ai-data -->

# @formancy/data-client

The browser's side of Formancy Data's runtime plane: one function per route
for the forms a person may read, a published form's definition, records and
lookups, option sources that
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
createDataClient({ token, base?, fetch? }) // → { forms, form, read, list, exportRecords, create, update, delete, reconcile, query, resolve }
isUnknownWrite(outcome) // → whether a create, update or delete's outcome is an UnknownWrite
lookupSources(client, formId, form, operation | () => operation) // → { [source]: { resolve, maxRows } }
sourceNames(form)       // → every optionsSource the document names, once each, in document order
fieldProblems(refusal)  // → { [field]: [sentence, …] }, for engine.applyServerErrors
```

Every client function resolves to an `Outcome`: `{ ok: true, value }` or a
`Refusal` — `{ ok: false, status, code, message, fieldErrors? }`. It rejects
only for an abort the caller asked for, with the AbortError it raised.
`create` and `update` resolve to a `WriteOutcome`, which is that or an
`UnknownWrite` — see below; `delete` to a `DeleteOutcome`, the server's
`{ record, deleted: true }` or a refusal, or an `UnknownWrite`.

| Function | Route |
|---|---|
| `forms(signal?)` | `GET /v1/forms` → `{ forms: [{ id, title, operations, children }] }` |
| `form(formId)` | `GET /v1/forms/:id` → `{ form, operations, readable, list, deleting, copied }` |
| `read(formId, record)` | `POST /v1/forms/:id/records/read` |
| `list(formId, query?, signal?)` | `POST /v1/forms/:id/records/list` → `{ rows, hasMore }` |
| `exportRecords(formId, query?, signal?)` | `POST /v1/forms/:id/records/export` → `{ file, name }`, a `Blob` of CSV and `<form id>.csv` |
| `create(formId, answers)` | `POST /v1/forms/:id/records/create` |
| `update(formId, { record, version, answers })` | `POST /v1/forms/:id/records/update` |
| `delete(formId, { record, version })` | `POST /v1/forms/:id/records/delete` → `{ record, deleted: true }` |
| `reconcile(formId, unknown)` | `POST /v1/forms/:id/records/read`, or nothing when there is no token |
| `query(formId, source, { operation, search, offset?, limit? }, signal?)` | `POST /v1/forms/:id/lookups/:source/query` |
| `resolve(formId, source, { operation, tokens }, signal?)` | `POST /v1/forms/:id/lookups/:source/resolve` |

The reply types — `FormMenu`, `FormMenuEntry`, `FormMenuChild`,
`PublishedForm`, `FormRecord`, `RecordList`, `RecordListQuery`,
`RecordExportQuery`, `ListSortTerm`, `ListFilterTerm`, `FilterCondition`,
`FilterOp`, `FilterOffer`, `FilterInput`, `FilterableField`, `ListColumns`, `ListView`,
`LookupResult`, `LookupRow`, `FieldError` — and `LIST_PAGE_SIZE`,
`EXPORT_MAX_BYTES` and `exportFileName` are re-exported from
`@formancy/data-core`, where the server's handlers are checked against the
same declarations. A form's `list`
is `null` when the server would refuse this person a page, and otherwise
says which fields a page may be searched, sorted and filtered by
([0044](../../docs/decisions/0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md),
[0104](../../docs/decisions/0104-a-list-and-a-browse-are-filtered-by-conditions-on-their-columns.md)): `filterable` is one `{ field, operators, input, days }` per field a
condition may name, the operators among `equals`, `range`, `contains`,
`null` and `not-null`, and `input` what a value is typed as -- `text`,
`integer`, `decimal`, `date`, `uuid` or `boolean`, a timestamp's range
being days -- or `null` where only `null` and `not-null` are offered, and
`days` whose clock a timestamp's days are on, `utc` for an instant and
`wall` for one in no zone, `null` for any other field. `views` is the
published views this person could have built from the rest
([0105](../../docs/decisions/0105-a-forms-list-offers-views-its-administrator-named.md)),
each `{ name, filter, sort }` and `default: true` on the one a grid opens
on, every term one `list` sends as it is.
A `form` reply without `list` is `unexpected`, as from a server older than
lists, and so is a list without `filterable`, as from a server older than
filters, or with an offer a panel could not draw: no operator, one or an
`input` this package's data-core does not name, an `input` that does
not fit the operators, or a `days` data-core does not name or on anything
but a date. So is a list without `views`, as from a server older than
views, or with a view a page could not send: no name, a condition with no
field or an operator data-core does not name, a direction other than `asc`
or `desc`, or a `default` other than `true`. `list` sends exactly `search`, `sort`, `parent`,
`filter`, `after` and `limit` in a POST body, each left out the server's
default, so the search and a filter's values are in no URL. A page
answers `next`, the cursor of its last row when more follow, which the
page after it is asked for as `after` (0108); a page without one, from a
server older than that, is `unexpected`, and a page after a row that is
gone is refused `cursor-gone`, the first page being where to start again. `filter` is a
list of `{ field, op, … }`, each field once, every condition holding:
`{ op: 'equals', value }`, `{ op: 'range', from, to }` with either bound
`null`, `{ op: 'contains', text }`, `{ op: 'null' }` or
`{ op: 'not-null' }`, every value as the text a person typed. The server
spells it as the column holds it, and refuses a condition `filterable`
does not offer, or a value its column cannot hold, 400 `not-filterable`
in a sentence that names the field and never the value; a filter
narrows, and the policy still decides which records exist. A form's
`deleting` says what a delete also does -- whether it
cascades, clears references, or may be refused while other rows refer to
the record -- for a page to word its confirmation by, and is `null`
exactly when `operations` holds no `delete`; a reply that breaks that is
`unexpected`, as is one without `deleting` from a server older than
deletes, so a host upgrades its server first
([0050](../../docs/decisions/0050-a-record-is-deleted-one-at-a-time-by-its-token-and-the-version-its-person-read.md)).
A form's `copied` names the fields a copy of one of its records carries
into a new one -- what this person may read and give on create, less every
column of a key -- for a page to open a new record holding those answers,
as read, and send them to `create`; it is `null` exactly when `operations`
holds no `create`, and a reply that breaks that, or one from a server older
than copies, which sends none, is `unexpected`
([0107](../../docs/decisions/0107-a-record-is-duplicated-into-a-new-one-of-the-fields-the-server-names.md)).
`delete` sends exactly `record` and `version`, with a write id of its own,
and is done only on the server's `{ record, deleted: true }`, whose token
is the row the statement deleted.

`exportRecords` is the file of every record `list` would page through for
the same `search`, `sort`, `parent` and `filter`, the four keys it sends,
in a POST body
([0079](../../docs/decisions/0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md),
0104), refused `not-filterable` as `list` would be.
It resolves to a `RecordFile`, `{ file, name }`: the server's bytes as a
`Blob`, byte-order mark included, and `<form id>.csv`, taken from the form's
id and not from `content-disposition`, which a page on another origin cannot
read (0060); `exportFileName(formId)` is that name, for a page that says it
before the file arrives, as the host page's Download CSV does
([0080](../../docs/decisions/0080-a-host-downloads-the-records-its-grid-lists-and-the-browser-saves-the-servers-file.md)).
The server makes the file whole or refuses it with its own
code -- `export-too-large` past `EXPORT_MAX_BYTES`, `export-timeout`,
`export-busy`, `moved`, `unencodable` among them -- and the client adds two
of its own: a 200 that is not `text/csv` is `unexpected`, and a body that
did not arrive whole -- the connection cut, fewer bytes than the server
announced, which `fetch` refuses -- is `incomplete`, never a shorter file.
It asks for `text/csv, application/json`, an `accept` value CORS counts as
safelisted, so the preflight a cross-origin export sends anyway -- for its
`authorization` and its JSON `content-type` -- need not grant it, and the
server's allowed request headers are unchanged. An abort rejects with the
AbortError.
Saving the `Blob` is the host's: an object URL and an `<a download>`.

`forms` is the menu
([0045](../../docs/decisions/0045-the-runtime-plane-lists-the-forms-a-person-may-read-and-nothing-about-the-others.md)):
the forms the server says this person may read, each with its title, the
operations its policy grants them as published, and its children -- a
child form and the lookup field its rows name this form's records by, so a
host lists one record's children with
`list(child.form, { parent: { field: child.field, record } })` -- and,
with `record: null`, the rows whose field references none: a tree's roots
(0110). The server
asks no database for it: `form(formId)` says what the database allows now,
and can still refuse a form the menu named. A child that is `one` is a
section of the record (0109): at most one of its rows references it, a page
shows that row in a form under the record, and `when`, when it is not
`null`, is the field whose answer shows it and the answer, compared as the
record holds it. An answer whose entries lack a title, operations or
children, or a child without `one`, or a section whose `when` is not a
field and a text, a number or a yes/no, is `unexpected`.

## The rules it keeps for a host

- **The token is the host's, per request.** `token()` is called once for every
  request and its answer goes in `Authorization: Bearer …` and nowhere else —
  not a URL, not a body, not storage. A host whose session renews the token is
  never answered for the old one.
- **Same origin, or a listed one.** `base` defaults to `''`, the page's own
  origin: served from the server's origin, or through a proxy on the page's
  own ([0024](../../docs/decisions/0024-the-studio-speaks-only-the-admin-plane.md)).
  A page on another origin sets `base` to the server's, and is answered only
  when the server's operator lists the page's origin exactly in
  `FORMANCY_DATA_CORS_ORIGINS`
  ([0060](../../docs/decisions/0060-the-runtime-plane-answers-the-origins-an-operator-lists-and-the-administrators-plane-none.md));
  otherwise every call is a refused preflight, a read `unreachable` and a
  write unknown though nothing was sent, and only the server's log says why.
  Across origins the client sends only headers the server grants --
  `authorization`, `content-type` and `formancy-write-id`, and `accept`,
  which a browser sends without asking -- and asks for no credentials: a
  `fetch` the host passes must not add a header or set `credentials:
  'include'`, which the server never allows.
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
- **An abort stops the lookup in the database.** The signal a renderer
  passes a source, or a host passes `query` and `resolve`, aborts the
  request; the server notices its client left and stops the statement it
  started, on both engines, and the call rejects with the AbortError
  ([0061](../../docs/decisions/0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md)).
  A search that runs past the server's deadline is refused 503
  `lookup-timeout`, whose sentence says the same search will take as long
  again, where `unavailable` invites another try; a resolve past it is
  `unavailable`, since trying again helps a read by key. A source rejects
  with either, and a renderer shows "could not be loaded". The 499 `abandoned` the server
  answers an abandoned lookup reaches nobody: it is the audit trail's.
- **A search says whether its list goes on, never how long it is**
  ([0085](../../docs/decisions/0085-a-lookup-says-when-its-list-goes-on-never-how-long-it-is.md)).
  A source answers a search with one page, `{ options, more, withheld }`:
  `more` exactly when the server read a row past the page, `withheld` the
  matching rows whose key does not fit a token, which the server counts as
  `omitted` and cannot offer
  ([0012](../../docs/decisions/0012-a-lookup-token-is-a-reference-not-a-permission.md)).
  A label request answers the rows it names, as a list. Each source's
  `maxRows` is `DEFAULT_MAX_PAGE_SIZE`, the largest page the runtime plane
  answers a lookup, so a renderer asks for and shows exactly that page.
  What a control says of it is the renderer's own (formancy.ai 0177): in
  an open typeahead "Showing the first 50; there are more — keep typing to
  narrow.", under a plain select "Showing the first 50; there are more
  than this list can show.", how many matches cannot be chosen here only
  when the list is complete, and nothing under a closed typeahead or a
  field a rule disables. formancy 0.6.0's and 0.7.0's Blueprint theme draws a
  typeahead's open list over the line its sentence is on, as the other
  three reference themes' stylesheets place it too, so a sighted person
  does not read the sentence while the list is open; a screen reader hears
  it from the line's live region (measured in Chromium and Firefox on
  2026-10-18).
- **A write is known only when the data server says what happened**
  ([0031](../../docs/decisions/0031-an-answer-lost-after-a-write-is-unknown.md)).
  A record, the server's 502 `unknown-outcome`, a 4xx with a sentence, or a
  503 `unavailable`. Anything else — a rejected `fetch`, a body that cannot be
  read or is not JSON, a proxy's 502 or 504, a 500, a 2xx that is not a
  record — may have reached the database, so it is an `UnknownWrite`:
  `{ ok: false, status, code: 'unknown-outcome', message, operation, record,
  version, origin }`, `origin` being `database` (the server's 502, whose
  `record` and `version` it carries) or `transport` (the update's or the
  delete's own, or `null` for a create). `ok` is false, so a host that
  checks only `ok` fails closed. Nothing is ever sent again.
  `reconcile(formId, unknown)` reads what it addressed and says `unchanged`
  (an update's or a deletion's record still at the version sent: saving or
  deleting again with it is done at most once), `changed`, `present`,
  `absent` (the read's 404, through this person's read filter: not proof the
  row is not stored, but creating again is safe, because the key stops a
  second row; for a deletion, the record is gone, by it or another) or
  `unverifiable` (no token, and no request) — or passes on the read's own
  refusal. On a read, 0029's rules stand: a proxy's page is
  `unexpected`.
- **Every write carries a write id of its own**, in the `formancy-write-id`
  header: 128 random bits from `crypto.getRandomValues`, new for every
  `create`, `update` and `delete` call. Over HTTP/1.1, when a connection the
  browser reused closes after the server read a write and before any byte of
  an answer, Chromium and Firefox send it again on their own, below the page;
  one server process answers that copy with the first one's answer instead of
  applying it twice (0031). WebKit on Linux sends every write on a new
  connection and never sends one twice, so there the write is unknown
  ([0058](../../docs/decisions/0058-the-browser-gates-run-in-chromium-firefox-and-webkit-and-each-fact-the-browsers-disagree-on-is-named-and-held.md)). The client itself still never sends anything again.
- **Field problems are sentences.** The renderers print an error entry as
  it is, beside the field and in the error summary, as observed at 0.3.0 on
  2026-10-09, at 0.4.0 on 2026-10-10 and at 0.5.0 on 2026-10-11, and read
  in 0.6.0's code on 2026-10-18 and 0.7.0's on 2026-10-22, so `fieldProblems` hands them the server's
  sentence, which never echoes a value. The code stays on the
  refusal for a program.

## In React

```tsx
import { createFormEngine } from '@formancy/core'
import { ErrorSummary, FormancyForm, FormancyProvider, OptionsSourcesProvider } from '@formancy/react'
import { createDataClient, fieldProblems, isUnknownWrite, lookupSources } from '@formancy/data-client'

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
  if (isUnknownWrite(saved)) return showUnknown(saved)  // it may have been saved: client.reconcile, never a resend
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
  What the browser sends again on its own is answered by the server once per
  write id, in its process only: a copy that reaches another replica is
  applied again.
- **No total.** A search's page says that more rows match, never how
  many: the server reads one row past the page rather than counting
  (0012), and since formancy 0.6.0 a renderer refuses a page that names a
  total, as a source that failed. Until 0.6.0 a renderer's option contract
  was a list of `{ value, label }`, so a list of exactly one page looked
  complete. Past the page a typeahead narrows as the person types; a plain
  select cannot, and says so.
- **Its types are `@formancy/spec` 0.7.0's.** `PublishedForm.form` is the
  `FormSchema` of the `@formancy/spec` this package pins exactly (0002), and
  there `specVersion` may be `"4"`, so a host whose engine is
  `@formancy/core` 0.3.0 does not compile the React snippet above: TS2322 at
  `createFormEngine`, measured with TypeScript 6.0.3 and `skipLibCheck` off
  on 2026-10-10, and again against 0.5.0's types on 2026-10-11, when a host
  whose engine is at 0.4.0 compiled it; 0.6.0's and 0.7.0's `FormSchema`
  declarations are byte-identical to 0.5.0's, compared on 2026-10-18 and
  2026-10-22. The document itself is spec 3
  ([0042](../../docs/decisions/0042-generated-forms-stay-on-spec-3-after-spec-4-is-released.md)),
  so such a host casts it to its own `@formancy/spec`'s `FormSchema`, or
  moves its renderer to 0.4.0 or later. Nothing here type-checks a 0.3.0 or
  a 0.4.0 host.
- **Records are addressed by token only.** The definition does not name the
  identity columns, so a host keeps the tokens that create, read and lookups
  return, or encodes its own key with data-core's `encodeKeyToken`.
- **Error sentences are the server's English.** The codes stay on the refusal
  for a host that translates.
- **A source answers for every name the document carries.** A host with its
  own named lists merges maps; a name the server does not know fails closed,
  as "could not be loaded".
