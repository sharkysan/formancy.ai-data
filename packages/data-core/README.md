<!-- Part of Formancy Data: https://github.com/sharkysan/formancy.ai-data -->

# @formancy/data-core

The database-neutral core of Formancy Data: the port every database adapter
implements, and what the adapters have to agree on so that the rest of the
product never needs to know which database it is talking to.

**No driver, no HTTP, no Node.** The package compiles against `ES2023` with no
`@types/node`, so a Node import here is a compile error rather than a review
finding — the same rule `@formancy/core` holds upstream, for the same reason: a
core that can only run on a server is a core that cannot be checked in a
browser.

## What is here today

- **The adapter port**, `DatabaseAdapter`, with two implementations from the
  first day.
- **The metadata contract**: `MetadataSnapshot` and what it holds, made only
  through `createSnapshot`, which sorts, checks and fingerprints. A snapshot
  carries **gaps** — what the connection could not see, about the scope, a
  schema or an object — so a permission-filtered catalog is never mistaken
  for a complete one. It names the **account** it was taken as, whose user is
  in the fingerprint, and says what that account may SELECT, INSERT and
  UPDATE, column by column, and whether row-level security applies to it, per
  table — `none`, `applies`, or `unknown` with the gap that says why
  ([0027](../../docs/decisions/0027-a-snapshot-says-what-its-account-may-do.md)).
  Since [0049](../../docs/decisions/0049-a-snapshot-says-whether-its-account-may-delete-and-what-refers-to-each-table.md)
  each table and view also says whether the account may DELETE from it
  (`access`) and every foreign key that refers to it, from a table in any
  schema (`referencedBy`), or a `referenced-by` gap says the list may be
  short. Both are absent from a snapshot taken before, which keeps its
  fingerprint; `createSnapshot` refuses one without the other, and a key
  between two tables of the snapshot said otherwise at its two ends.
- **The server a snapshot was read from**: `server`, its product, major
  and, for SQL Server, the connected database's compatibility level, as
  each adapter's `ping` reports them too (`ServerIdentity` extends
  `ServerFacts`) -- outside the fingerprint, so an upgrade is no drift.
  `serverStanding(kind, server)` says whether this release was tested on
  it, against `TESTED_SERVERS`, the majors of the test matrix and SQL
  Server's compatibility floor, with a sentence a person reads; anything
  unknown, a snapshot without `server` included, is not tested.
  `serverName` names a server, a SQL Server release by its year from
  `SQLSERVER_RELEASES`. Nothing refuses a server for being untested
  ([0068](../../docs/decisions/0068-a-snapshot-records-the-server-it-was-read-from-and-nothing-refuses-a-server-discovery-can-read.md)).
  `UNTESTED_PRODUCTS` names, with their names, the products a snapshot
  recognises that no test runs on -- Azure SQL Database and Azure SQL
  Managed Instance -- derived from `TESTED_SERVERS`, and the root README's
  *What it is tested on* row from it
  ([0073](../../docs/decisions/0073-azure-sql-is-not-tested-and-the-release-says-so.md)).
- **Form generation**: `generateForm(snapshot, request)` returns a spec 3
  formancy document, its `FormBindings`, and a note on every choice it made.
  `GENERATED_SPEC_VERSION` is that `"3"`, which the data server also holds
  every stored version to
  ([0042](../../docs/decisions/0042-generated-forms-stay-on-spec-3-after-spec-4-is-released.md)).
  A lookup is a select over its option source, with `widget: "typeahead"`
  when its display includes a text or whole-number column, which is what a
  search matches, and a plain select of its first page otherwise; its note
  says which, and for a plain select what to show to make it searchable.
  A display column with no text form -- binary, rowversion, unsupported
  -- is refused, as `buildLookupConfig` refuses it; `isDisplayType` is
  that rule
  ([0066](../../docs/decisions/0066-a-lookup-a-person-can-search-is-generated-as-a-typeahead.md)).
- **Codecs**: `codecFor(column)` checks and canonicalises one API value for a
  column — decimals as strings, never rounded; integers past 2^53 as strings;
  formancy's date and time shapes on real days
  ([0008](../../docs/decisions/0008-exact-values-travel-as-strings.md)); text
  counted in the unit its column counts, and refused with NUL or an unpaired
  surrogate; a 32-bit float as `canonicalFloat32` names it, the shortest
  decimal for its float, and refused where a real would store infinity or a
  zero nobody wrote
  ([0026](../../docs/decisions/0026-name-every-column-fact-the-engines-disagree-on.md)).
  Both adapters read an instant to the second and a time to the minute,
  shorter than either engine stores them, so `planUpdate` removes an
  unedited echo of one
  ([0040](../../docs/decisions/0040-instants-and-times-are-read-to-the-shape-and-an-unedited-one-is-never-written.md), below).
  The snapshot names what the engines disagree on about a column — a text's
  length unit, a binary's padding, an identity ALWAYS or BY DEFAULT, a check
  enforced or not — and `createSnapshot` refuses one stored before it did.

```ts
import { generateForm } from '@formancy/data-core'

const { form, bindings, notes } = generateForm(snapshot, {
  connection: 'erp',
  root: { schema: 'sales', name: 'order' },
  formId: 'sales-order',
  title: 'Order',
  lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
})
```

Pass the columns the form's policy pins as `pinned`: they become read-only
fields filled from trusted context, never required fields the policy refuses.

A key the database numbers or fills is shown in the Record section and never
written: an identity (0026), and a column with a default and no generation
that is all of the key the request does not pin -- a uuid from
`gen_random_uuid()` or `newsequentialid()`, alone or beside a pinned tenant --
whose note says the database fills it. Where the pins leave more of the key,
a defaulted column of it is still written
([0056](../../docs/decisions/0056-a-key-the-database-fills-is-never-written-and-a-uuid-is-ordered-as-each-engine-orders-it.md)).

The form offers what the snapshot's account may do and nothing else: no field
over a column it may not read, a field written per operation — `writes:
{ create, update }`, bindings version 2 — so a column it may INSERT and not
UPDATE is written on create and read-only on update, and no operation the
database would refuse on every request. Row-level security that applies is an
`access` note. Bindings of version 1 are refused everywhere with "republish"
([0027](../../docs/decisions/0027-a-snapshot-says-what-its-account-may-do.md)).

Exact decimals and integers past 2^53 become text fields with an exact pattern,
never JavaScript numbers. Update is offered only with a proven concurrency
token. See [0009](../../docs/decisions/0009-generation-is-deterministic-and-says-what-it-chose.md).
Delete is offered with one too, where the account may DELETE and the version
proves the record for good: a rowversion, or a version column on a table
whose key the database numbers -- an identity, or a key of one column that
the engine's never-repeating default fills, `gen_random_uuid()` on
PostgreSQL or `newsequentialid()` on SQL Server, compared whole as the
snapshot spells it, and that no foreign key of the table includes
(`numbersKey`). Any other default does not count -- a constant hands out
one value twice, and `uuid_generate_v4()` or `newid()` are not named --
and neither does such a default beside another key column, which a form
without the pin writes, or on a key a foreign key includes, which a lookup
through it writes; drift review stops delete when such a key's default
changes or a foreign key comes to include it
([0050](../../docs/decisions/0050-a-record-is-deleted-one-at-a-time-by-its-token-and-the-version-its-person-read.md),
[0057](../../docs/decisions/0057-a-key-of-one-column-filled-by-a-never-repeating-default-counts-as-numbered.md)).

## Drift review

`diffSnapshots(base, current, bindings, policy)` compares the snapshot a form
was generated from with the database as it is now, through that form's
bindings and its policy's lookup filters, which the bindings do not record.
Each change says what it means for that form, `blocking`, `review` or `info`,
and which fields it touches; the report says what the form may still write.

```ts
import { diffSnapshots } from '@formancy/data-core'

const { changes, blocking, writable } = diffSnapshots(published, rescanned, bindings, policy)
```

Something the connection can no longer see is an access problem, never a
deletion: the snapshot's gaps say which. A privilege the account lost is a
`privilege-narrowed` change that stops exactly the writes resting on it, or
blocks the form when a read rests on it — a bound or identity column, or the
confirmed concurrency token, which every read and every create names; row
security that changed is for review; a snapshot taken as another user is
`account-changed`, blocking while row security is in play. A lookup reads its
target's key, display and filter columns by the types it was published with,
so any change to one of those types, wider or narrower, blocks the lookup
([0028](../../docs/decisions/0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md)). An apparent rename is a dropped
column, a new one and a hint, never inferred. Tables the form neither binds nor
looks up are left out, so an empty report means nothing this form rests on
changed. See [0010](../../docs/decisions/0010-drift-is-classified-against-the-bindings.md).

One change is not about the catalog: when the current snapshot was read from
a server this release was not tested on, as `serverStanding` decides, every
report against it says so, as a `server-untested` change for review that
stops nothing -- an unchanged catalog included, since the server is outside
the fingerprint and an upgrade in place keeps it. A report whose only change
is that one means nothing the form rests on changed, on a server this
release was not tested on. A snapshot that records no server says nothing
here
([0068](../../docs/decisions/0068-a-snapshot-records-the-server-it-was-read-from-and-nothing-refuses-a-server-discovery-can-read.md)).

The report also says `readable` -- no change breaks what the form shows --
and `runtime`, what a request decides against this database (0041): the
verdict of the root's own definition alone, its kind, columns, keys and
foreign keys, which is all a request compares. `runtime` is never stricter
than review, and looser by what only review compares: a lookup's table,
privileges, row security and the account. `ROOT_DEFINITION` is the families
that compare that definition; `diffSnapshots` runs them first, and
`diffRootDefinition(base, described, bindings, policy)` runs only them,
over a root as a request described it, so a rule added to one reaches both.
`describedOf(snapshot, ref)` is a root as a snapshot would describe it, and
`inSnapshotOrder` puts a description in a snapshot's order.

## Presentation over a generated base

A person's edits to a generated form are kept as a patch beside the base the
generator wrote, and carried to the next base when the form is regenerated
([0030](../../docs/decisions/0030-presentation-is-a-patch-over-the-generated-base.md)).
The patch holds exactly the studio's edits — a field's label, a section's
label, a field's place within its section's grid, full width, the
generated section a field is placed in
([0075](../../docs/decisions/0075-a-field-may-move-to-another-generated-section.md)),
and the views a list of the form offers (below) — and nothing else.

```ts
import { presentationOf, rebasePresentation } from '@formancy/data-core'

const derived = presentationOf(base, edited, bindings) // refuses every other difference, by JSON path
const { presentation, form, conflicts } = rebasePresentation(
  { base, presentation: derived.presentation, bindings },
  { base: next.form, bindings: next.bindings },
)
```

A field is anchored by what it stands for — its column, or its lookup's
foreign key — so a label follows the column when a colliding key renumbers.
A section is anchored by the label the generator wrote and which of the
sections with that label it is. A field moved to another section is recorded
on its own entry as `section`, that section's anchor; it lands after the
section's own fields, and a section's order is of the fields it holds once
the moves are made, one decision `placement.ts` makes for applying,
deriving and rebasing alike. A section keeps at least one field. What cannot
be carried as it was is a conflict: a field gone, a field under another key,
a field now placed in another section, a move whose section is gone, cannot
be told apart or would be left with no field (`move-dropped`), a section
gone, a label the generator also changed (the person's is kept). `applyPresentation` is what the server checks a stored
form against; `reassignedKeys` names keys that now stand for another column,
whose grants somebody has to confirm — and the server refuses a publish that
grants on one without confirming it
([0039](../../docs/decisions/0039-a-publish-says-what-happens-to-the-grants-of-reassigned-keys.md)).
`grantsOnKey(policy, key)` is what grants on one means there: a read or
write role on its field, a lookup's filter alone being no grant, since every
lookup field has one and nobody without a role may search it.
`describeReassigned(key)` is the one sentence the server's refusal and the
studio's lists say a reassigned key in.

What it does not do: a renamed column reads as one gone and one new, and its
overrides are reported dropped rather than guessed across; a root whose own
label is `Record` has two sections labelled Record, and when one of them
comes or goes the rebase cannot tell which is left, so their overrides are
reported dropped (`section-gone`) rather than put on the wrong one; help
text, translations, `required`, a numeric span, a section added and a move
that empties a section are refused, not carried. A version-1 reader before
0075 refuses a presentation holding a move, naming `/fields/N/section`.

### List views

A presentation may also name the views a list of the form's records offers
([0105](../../docs/decisions/0105-a-forms-list-offers-views-its-administrator-named.md)):
`views`, left out when there are none, each `{ name, filter, sort }` with
`default: true` on at most one, every term exactly what a list request
carries.

```ts
import { listColumns, viewProblems, viewShapeProblems } from '@formancy/data-core'

viewShapeProblems(presentation.views) // on every read: a name a picker shows, a filter and a sort a request carries
viewProblems(presentation.views, bindings) // at a write: each view one a list of these bindings can run, named where not
listColumns(bindings, readableFields, presentation.views).views // what one person is offered: the views they could have built
```

A view is offered whole or not at all: one naming a field the person may
not read is not offered to them, and neither is a stored one a later
release no longer runs. `rebasePresentation` carries each view by what its
fields stand for, and drops one whose field is gone or no longer offers
what it asks, as `view-dropped`.

## Lookups

The database-neutral half of a foreign-key lookup: what a `select` stores, what
an adapter is asked, and the decisions both adapters would otherwise make twice.
`@formancy/data-postgres` and `@formancy/data-sqlserver` implement the port.

- **A key token** is the string the select stores. `encodeKeyToken(['7', '1001'])`
  is `k1:7,1001`; anything outside `A–Z a–z 0–9 - . _` is escaped as `~` and
  four hex digits, so a token is printable ASCII and one key has one spelling.
  `decodeKeyToken` refuses every other spelling. A key whose token would exceed
  the 200 characters formancy stores is refused, never truncated.
- **`buildLookupConfig(bindings, field, { snapshot })`** derives what an adapter
  may know: the target, the key columns in order with their types, the
  display and search columns with theirs, the sort columns, and the page
  size. Every sort column says where
  NULLs go, last by default, because the engines disagree. It refuses bindings
  from another snapshot, bindings that are not what the root's foreign key
  references, a float, binary, boolean, time or timestamp key, and a search
  over a column the label does not show.
- **`validateLookupQuery`** is the boundary for a search request: exactly a
  search, an offset and a limit, trimmed and bounded.
- **`LookupAdapter`** is the port: `search`, `resolve` and `rejects`, each with
  the actor's trusted row filters, read with `rowFilterTerms`. "Every row" is
  `{ kind: 'unrestricted' }`, written on purpose; an empty list is refused.
- **Row filters** come from `scopeRowFilters(object, filter, where)`, for a
  lookup's target and a record request's root alike. Each term carries its
  column's type and compares the column's canonical value with the trusted
  value exactly: case, accents and trailing spaces count, and the column's
  collation is not consulted. A column that is absent, not readable by the
  snapshot's account, or not text, integer, decimal, uuid or date is
  `invalid-policy` — `rowFilterColumnProblem` names why, and the server's
  publish check and the studio ask the same function. A trusted value not
  spelled as its column holds it (`'042'`, `'AB '` for `char(n)`, an
  upper-case uuid), or text with an unpaired surrogate — which one driver
  sends as U+FFFD and the other as itself — is `invalid-context`. `rowFilterTerms` refuses an untyped
  or misspelled term at run time too.
- **Labels** are spelled once, by `displayText`, from the canonical value the
  adapter's record reader returns: a boolean as `true`, a real as `0.1`, a
  time to the minute and a timestamp to the second, cut and never rounded,
  whatever the session's settings. Labels are not localised.
  `rejects` is the shape formancy's server-side `members` port asks for.
  `lookupKeys`, `lookupPage(config, …)`, `resolvedRows(config, …)` and
  `rejectedTokens` build its
  answers: a token is asked about only when each value is spelled as its key
  column holds it, and is a member only when a row found under those filters
  re-encodes to it exactly.

A token is a reference, not a permission: it says which row was meant, and the
server decides again, every time, whether this actor may name it. See
[0012](../../docs/decisions/0012-a-lookup-token-is-a-reference-not-a-permission.md),
and [0028](../../docs/decisions/0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md)
for filters and labels.

## Access policy

A `FormPolicy` says, per published form, which roles may read, create and
update, which may read and write each field, and which root columns must equal
an attribute of the trusted `PolicyContext` — tenant isolation — with the same
for each lookup's target table. The host builds the context after verifying the
caller's identity; it is never built from request input.

```ts
import { checkSubmittedFields, forcedValues, rowFilter } from '@formancy/data-core'

const context = { actor: { id: 'u-17', roles: ['clerk'] }, attributes: { tenant: '42' } }

checkSubmittedFields(policy, context, bindings, 'create', ['tenant_id', 'name'])
// { ok: false, code: 'over-posting', message: 'tenant_id is pinned by a row filter: …' }
rowFilter(policy, context, 'read') // { ok: true, filter: [{ column: 'tenant_id', value: '42' }] }
forcedValues(policy, context) // the same columns, written from the context on create
```

Deny by default: a field the policy does not name is readable and writable by
nobody, and a lookup it does not name offers nothing. A missing attribute is a
refusal, never an empty filter, because an empty filter is every tenant's rows.
Every function answers `{ ok: true, … }` or a refusal with a stable `code`, and
none of them reads the form document: a hidden or disabled field is
presentation, not authorisation. Each one that returns fields, a filter or
values first authorises the operation it serves, so an actor whose roles hold
field grants and no operation grant gets nothing from any of them.
`validatePolicy(policy, bindings)` refuses a policy that does not fit its
form, and every function given the bindings refuses it too — the lookup
filter among them, so an options search cannot run under a policy the save
would refuse. The request planner below runs them on every read, create and
update it plans. See
[0011](../../docs/decisions/0011-every-operation-carries-a-trusted-policy-context.md).

A table with no tenant column of its own -- an order's lines -- is scoped
through a parent instead: `through: ['order']` names lookup fields whose
filter on their target also scopes the form's rows
([0043](../../docs/decisions/0043-a-child-forms-rows-are-reached-only-through-a-parent-its-policy-admits.md)).

```ts
const linePolicy = { …, rowFilters: [], lookups: { order: [{ column: 'tenant_id', attribute: 'tenant' }] }, through: ['order'] }
throughFilters(linePolicy, context, bindings, 'read') // { ok: true, through: [{ field: 'order', filter: [{ column: 'tenant_id', value: '42' }] }] }
throughProblems(snapshot, bindings, linePolicy)        // [] -- or why its lookup cannot scope: it does not configure, or its key is text
```

`validatePolicy` refuses a through that is not a lookup of the form, is
named twice, or whose list offers every row; `throughProblems` refuses one
whose key is text on either side, which no snapshot records a collation to
compare by, on both engines. `throughFilters` authorises the operation and
refuses a missing attribute, and asks for no grant on the field: a through
scopes rows and offers no options. `authorizeOperation` refuses every
operation, create included, whose through the context cannot resolve, so a
form is never offered for what every request would then be refused. And a
through names a key: `grantsOnKey` counts it, so a regeneration that
re-points that key is asked about (0039) whether or not anybody holds a role
on its field. Optional: a policy without it means what it meant, and a server
older than it refuses a policy that uses it.

A field holding where a record stands -- an order's status -- can be held to
the moves the policy lists, each a pair of values for named roles
([0112](../../docs/decisions/0112-a-policy-holds-a-state-field-to-the-moves-it-lists.md)):

```ts
const orderPolicy = {
  …,
  transitions: {
    field: 'status',
    moves: [
      { from: null, to: 'placed', roles: ['clerk'] }, // a new record starts here
      { from: 'placed', to: 'shipped', roles: ['clerk'] },
      { from: 'shipped', to: 'delivered', roles: ['dispatcher'] },
    ],
  },
}
checkTransition(orderPolicy, context, bindings, 'shipped', 'placed')
// { ok: false, code: 'transition-denied', message: 'status may not move from where it is to where this update puts it, for your roles.' }
```

`validatePolicy` refuses a field that is not a text or whole-number column
field, a value its column could not hold, a move named twice or to the
value it starts from, and a role that may not make the move: update, or
create for a move from `null`, and read and write the field. The planner
asks `checkTransition` of every create and update that changes the field,
from the record as read -- a create from `null`, a create that leaves the
field to its default unchecked -- and says on the plan whether it `moved`,
for the audit. A move to NULL is refused; an update read at a newer version
than it names is left to the version guard, which answers it stale.

## Record requests

The one place a browser's request becomes an adapter's: the policy, the
codecs, the tokens and the bindings meet here, so both adapters receive the
same typed request for the same answers. Pure — no I/O, no clock — and
`@formancy/data-server` calls it on every runtime request.

```ts
import { planCreate, planUpdate, rejectedSelection, toFormAnswers } from '@formancy/data-core'

const described = await records.describe(bindings.root) // the table as the catalog has it now (0041)
if (!described.ok) return described
const planned = planCreate(snapshot, bindings, policy, context, body, described.described)
if (!planned.ok) return planned // a refusal with a stable code, or { code: 'invalid-values', fieldErrors }
for (const check of planned.memberships) {
  if ((await lookups.rejects(check.config, check.tokens, check.filters)).length > 0) {
    return { ok: false, code: 'invalid-values', fieldErrors: [rejectedSelection(check.field)] }
  }
}
const saved = await records.insert(planned.request)
return saved.ok ? toFormAnswers(bindings, planned.fields, saved) : saved // { record, version, answers }
```

- **A record token** addresses a record: `recordToken` encodes its identity
  values with the lookup's key-token encoding, and `decodeRecordKey` holds
  each value to its key column's spelling.
- **`planRead`, `planCreate`, `planUpdate`** check the bindings against the
  snapshot they were generated from (`drift` otherwise), the policy —
  over-posting first — and then every answer through its column's codec,
  reporting every bad field at once. The tenant is written from the context;
  an omitted field lets a default apply on create and is unchanged on update;
  the key and the pinned columns are never set; update needs a confirmed
  concurrency token. A version column, which every update increments, is
  never the key, a field's column or a generated one, and never pinned by a
  row filter.
- **The write planners take the table as the request described it**
  (0041). `planCreate(…, answers, described)` and `planUpdate(…, answers,
  asRead, described)` refuse `drift` a write the description stops, by
  `driftRefusal` -- drift review's root families over it, after the policy
  and before the token, the version and the codecs -- and put
  `described.definition` on the request, so the adapter writes only while
  the table still has it. A read is decided after its statement, over the
  description the read returned; `runtimeOperations` is what opening a form
  may offer. The refusals' sentences (`READ_REFUSED`, `WRITE_REFUSED`,
  `NOTHING_LEFT`) name no column; a refusal's `drift` lists the blocking
  changes for a log.
- **An update takes the record as read.** An instant or a time read cut to
  the shape and sent back unedited would, set, replace the stored fraction
  or seconds. `planUpdate(…, answers, asRead, described)` takes what `toFormAnswers`
  made of the record `planRead` and the adapter read for this actor just
  before the update, and does not set an instant or a time the actor may
  write and read that equals it at the version named; at another version
  nothing is removed, and the version guard answers. Without that read, or with
  another record's, an update carrying one is refused `record-not-read`. A
  field the actor may not read is never compared, and needs no read
  ([0040](../../docs/decisions/0040-instants-and-times-are-read-to-the-shape-and-an-unedited-one-is-never-written.md)).
- **Throughs are on every read and update** (0043). `planRead` and
  `planUpdate` put a typed `Through` on the request for each lookup the
  policy names -- the root's foreign-key columns, the target and its key,
  and the lookup's filter scoped as every filter is -- and an adapter reads
  them with `throughTerms`, as it reads filters with `rowFilterTerms`: a
  request without `through` (`[]` for none) is thrown before anything is
  sent. A through field is required on create, omitted or null, and may not
  be cleared on update, whatever its column allows: a row whose foreign key
  is NULL references no parent, and nobody could reach it again.
- **A page of records** (0044). `listable(snapshot, bindings, policy,
  context)` decides whether this person is offered a list at all: the
  policy first, then a key a token can carry and the snapshot holds NOT
  NULL, rows something scopes where a lookup's options are filtered
  (`unscopedLookups`), and every key column in a field the person may read
  or pinned by their filter. `listColumns(bindings, fields)` is what a list
  may be sorted and searched by, which `GET /v1/forms/:id` sends as `list`.
  `validateListQuery` checks a body from a browser; `planList` plans a
  `ListRequest` -- the read's columns, filters and throughs, the order
  `listOrder` makes total with the key, the search, the parent -- or no
  parent, `record: null`, planned as `null` conditions on the field's
  columns (0110) -- and the key
  the page continues after, which `decodeListCursor` reads from a body's
  `after` (`invalid-cursor`, 0108) -- and `recordPage` builds `{ rows,
  hasMore, next }` from the `limit + 1` rows an adapter fetched, each row
  what `toFormAnswers` makes of a read of it, `next` the cursor
  `listCursor` spells of the last row shown. `listTerms` gives an adapter
  the key and the seek, the order less every column the scope holds to one
  value; `cursorRefusal` refuses a page whose statement found the row gone
  (`cursor-gone`). An
  adapter reads a request through `listTerms`, which throws on anything
  `planList` would not have produced. A page is decided over the
  description its own statement carried by `driftRefusal(…, 'list')`: a
  read's refusal, and `LIST_REFUSED` when the table no longer holds the key
  unique and NOT NULL.
- **A file of records** (0079). `validateExportQuery` checks an export's
  body: a list's `search`, `sort` and `parent`, read by the same checks,
  and nothing else -- a cursor or a limit is `malformed`, since the
  server reads every page, each after the last row of the one before. The pages are `planList`'s. `exportColumns(form,
  bindings, readable)` is the file's columns: the readable fields in the
  form's `model.fields` order, headed by a string label or else the key, a
  lookup as two, its label and then its token under `<header> (key)`.
  `exportHeader` writes the header row after a byte-order mark;
  `exportRecord(columns, record, labels)` writes one record from a page's
  answers and the labels the page's resolves gave, refusing `unencodable`
  for a lookup whose key fits no token and, through `csv.ts`, for text
  UTF-8 cannot carry or a NUL, naming the column and never the value.
  `exportText(type, value)` is a cell's text: `displayText`'s, except a
  time and a timestamp, written as read. `csv.ts` quotes by RFC 4180 and
  puts one apostrophe before a cell that starts as a formula, or with an
  apostrophe, unless it is a number. `EXPORT_MAX_BYTES`, 16 MiB, is the
  budget server and client share, and `exportFileName(formId)` the name a
  file is saved under, `<form id>.csv`. `fieldHeading(field)` is what a
  page or a file calls a field: its label where that is a string, otherwise
  its key, so a `{ $t }` reference is never "[object Object]".
- **A copy of a record** (0107). `copiedFields(snapshot, bindings, policy,
  context)` is the fields a copy of one of the form's records carries into
  a new one, which `GET /v1/forms/:id` sends as `copied` where it offers
  create: the fields this person may read whose answer a create accepts
  from them -- `checkSubmittedFields` asked one field at a time -- less
  every field over a column of the root's primary or unique keys, in the
  bindings' order. Empty when the person may not read or may not create.
- **A delete** (0050). `planDelete(snapshot, bindings, policy, context,
  recordToken, expectedVersion, described)` asks the policy first -- its
  filters and throughs scope a delete as an update's do -- then whether the
  form offers delete (`offers()`, where an absent flag is not offered) with
  a confirmed token, as its own snapshot says it can (`deleteUnoffered`),
  what a delete also does (`deleteProblems`), the description
  (`driftRefusal(…, 'delete')`, `DELETE_REFUSED`), the token and the
  version. What a delete also does is walked from the snapshot (0051):
  every key onto the root, and onto every table a cascade reaches, that
  cascades, sets NULL or sets a default must be named in the policy's
  `cascades` with its action, the account must be able to DELETE from
  every table reached, and a table outside the scope, a `referenced-by`
  gap, a SET NULL another key follows ON UPDATE and a `cascades` entry
  that names a key the delete does not act through are refused. `deleteReach` gives
  the request's `reach` -- the tables removed, the root first, the tables
  cleared with their columns, and each accepted key with the table it
  refers to -- `deleteEffects` what a page says of it, and `deleteReview`
  the same walk key by key, for an administrator to accept each (0052):
  every key that acts with whether `cascades` names it with its action,
  every key that only refuses, each acceptance that names nothing the
  delete acts through, and in `deleteProblems`' own words what no
  acceptance can fix. An adapter
  reads the request through `deleteTerms`, which throws on a key that is
  not the identity, a missing version, filter or through, and a reach
  that does not begin with the root or whose tables and keys do not account
  for each other; `reachesPast` says whether it reaches past the root.
- **A person's menu** (0045). `menuForm(bundle, context)` reads one
  published form alone for this person -- a bundle it cannot read throws
  there, for the caller to leave out -- and `formMenu(forms)` names, in
  codepoint order, every one whose policy lets this person read, with
  `grantedOperations` -- what the policy grants of what the form offers
  as published, the part of `GET /v1/forms/:id`'s answer that asks no
  database -- and the children under each, comparing only what
  `menuForm` read. `childFields(parent, child)` is
  the structure: a lookup of the child, on the same connection, onto the
  parent's identity column for column in order, each foreign-key column of
  the referenced key's normalized type in each side's own snapshot, so the
  parent's record token is a value the child's field takes. The child's
  list narrowed by it holds the rows whose foreign key references that
  record by the database's own equality, which on a text key under a
  collation that ignores case or trailing spaces is not byte equality: a
  row's field can spell the key otherwise than the parent's token does.
  The menu names a child only when this person may list it (`listable`)
  and read that field. It asks no database: what the table allows now is
  decided when a form is opened. A child through a lookup the generator
  made a section of the parent's records (0109, `generate/section.ts`:
  the child's key is that foreign key, with an optional condition on a
  column of the parent's table) is `one`, and its `when` is the parent's
  field this person may read bound to that column, with the condition's
  value as the field's answer holds it (`formValue`), or `null` to show it
  always.
- **Membership is the database's.** A lookup token whose key carries the tenant
  is refused when the tenant is not the context's; one that does not — a
  surrogate id — cannot be judged without a query. Every selection comes back
  as a `MembershipCheck` for the caller to run against `rejects` before it
  writes, and every non-member, forged or foreign, gets the same
  `rejectedSelection`.
- **The record port describes the table** (0041): `describe(table)` reads
  the root's kind, columns, keys and foreign keys in one statement, `read`
  answers the same description beside the record, or beside `null` when no
  row is inside the filters, `list` answers it beside a page, and every
  `InsertRequest` and `UpdateRequest` carries the `definition` the decision
  was made over. An insert or an
  update runs only while the table's definition is that one; otherwise it is
  `schema-changed`, and the record was not written.
- **A database's refusal** is a `RecordFailure` with a stable code. `refused`
  is a refusal this port has no code for — a trigger's own error, a write
  declined without one, an error the adapter does not recognise — and is
  expected to be refused again. `unavailable` means only what passes: the
  database unreachable, or a deadlock or lock timeout the engine documents as
  such. Nothing was written in either case.
- **`toFormAnswers`** is the inverse, for the fields the actor may read: a
  lookup as its token, the three-state select as `'true'`/`'false'`/`null`, and
  a whole number as a number, because the released engine reports canonical
  text in a number field as below its minimum.

See [0018](../../docs/decisions/0018-one-planner-turns-answers-into-requests.md).

### Versions of one thing

A root whose rows are versions -- a product's price per date -- is
generated with `validity: { from, to }`, and its bindings keep the chain:
the two columns and the key one thing's versions share
([0113](../../docs/decisions/0113-a-form-over-versions-changes-the-open-one-from-a-date.md)).

```ts
const { bindings } = generateForm(snapshot, { …, validity: { from: 'valid_from', to: 'valid_to' } })
bindings.validity // { from: 'valid_from', to: 'valid_to', key: ['tenant_id', 'product_no'] }
const change = planSupersede(snapshot, bindings, policy, context, token, version, { valid_from: '2026-07-01', amount: '10.00' }, asRead, described)
if (change.ok) await records.supersede(change.request) // the open version ended, the next one inserted
```

- `validityFor` refuses a pair no chain can be held to: not both dates or
  both instants, a start that may be NULL or an end that may not, no
  version column, no key holding the start and another column.
- The end is never written by the form, the start and the chain's key on
  create only, and no delete is offered; `versionFields` names the start
  and end fields where a change is offered, and the chain's key fields a
  next version takes from the one it follows (0115).
- `planSupersede` asks update and create of the policy, drops a copy's
  echoes of the chain's key and the empty end, refuses an ended version
  and an early start from the version as read at the version named, and
  decodes the next version as a create. A create of a form over versions
  carries `fresh`, the chain's key it must not find, and an update `open`,
  the end it must find NULL.

## Licence

Source-available, not open source. See [`LICENSE.md`](./LICENSE.md): free to
read, fork, evaluate, develop and test; a paid licence for production use.
