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
- **Form generation**: `generateForm(snapshot, request)` returns a spec 3
  formancy document, its `FormBindings`, and a note on every choice it made.
  `GENERATED_SPEC_VERSION` is that `"3"`, which the data server also holds
  every stored version to
  ([0042](../../docs/decisions/0042-generated-forms-stay-on-spec-3-after-spec-4-is-released.md)).
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
The patch holds exactly four edits — a field's label, a section's label, a
field's place within its own section's grid, and full width — and nothing
else.

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
sections with that label it is. What cannot be carried as it was is a
conflict: a field gone, a field under another key, a field the generator put
in another section, a section gone, a label the generator also changed (the
person's is kept). `applyPresentation` is what the server checks a stored
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
text, translations, `required`, a numeric span and a move between sections
are refused, not carried.

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
- **Membership is the database's.** A lookup token whose key carries the tenant
  is refused when the tenant is not the context's; one that does not — a
  surrogate id — cannot be judged without a query. Every selection comes back
  as a `MembershipCheck` for the caller to run against `rejects` before it
  writes, and every non-member, forged or foreign, gets the same
  `rejectedSelection`.
- **The record port describes the table** (0041): `describe(table)` reads
  the root's kind, columns, keys and foreign keys in one statement, `read`
  answers the same description beside the record, or beside `null` when no
  row is inside the filters, and every `InsertRequest` and `UpdateRequest`
  carries the `definition` the decision was made over. An insert or an
  update runs only while the table's definition is that one; otherwise it is
  `schema-changed`, and the record was not written.
- **A database's refusal** is a `RecordFailure` with a stable code. `refused`
  is a refusal this port has no code for — a trigger's own error, a write
  declined without one, an error the adapter does not recognise — and is
  expected to be refused again. `unavailable` means only what passes: the
  database unreachable, or a deadlock or lock timeout the engine documents as
  such. Nothing was written in either case.
- **`toFormAnswers`** is the inverse, for the fields the actor may read: a
  lookup as its token, the three-state radio as `'true'`/`'false'`/`null`, and
  a whole number as a number, because the released engine reports canonical
  text in a number field as below its minimum.

See [0018](../../docs/decisions/0018-one-planner-turns-answers-into-requests.md).

## Licence

Source-available, not open source. See [`LICENSE.md`](./LICENSE.md): free to
read, fork, evaluate, develop and test; a paid licence for production use.
