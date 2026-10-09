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
  carries **gaps** — what the connection could not see — so a
  permission-filtered catalog is never mistaken for a complete one.
- **Form generation**: `generateForm(snapshot, request)` returns a spec 3
  formancy document, its `FormBindings`, and a note on every choice it made.
- **Codecs**: `codecFor(column)` checks and canonicalises one API value for a
  column — decimals as strings, never rounded; integers past 2^53 as strings;
  formancy's date and time shapes on real days
  ([0008](../../docs/decisions/0008-exact-values-travel-as-strings.md)).

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

Exact decimals and integers past 2^53 become text fields with an exact pattern,
never JavaScript numbers. Update is offered only with a proven concurrency
token. See [0009](../../docs/decisions/0009-generation-is-deterministic-and-says-what-it-chose.md).

## Drift review

`diffSnapshots(base, current, bindings)` compares the snapshot a form was
generated from with the database as it is now, through that form's bindings.
Each change says what it means for that form, `blocking`, `review` or `info`,
and which fields it touches; the report says what the form may still write.

```ts
import { diffSnapshots } from '@formancy/data-core'

const { changes, blocking, writable } = diffSnapshots(published, rescanned, bindings)
```

Something the connection can no longer see is an access problem, never a
deletion: the snapshot's gaps say which. An apparent rename is a dropped
column, a new one and a hint, never inferred. Tables the form neither binds nor
looks up are left out, so an empty report means nothing this form rests on
changed. See [0010](../../docs/decisions/0010-drift-is-classified-against-the-bindings.md).

## Lookups

The database-neutral half of a foreign-key lookup: what a `select` stores, what
an adapter is asked, and the decisions both adapters would otherwise make twice.
No adapter implements the port yet.

- **A key token** is the string the select stores. `encodeKeyToken(['7', '1001'])`
  is `k1:7,1001`; anything outside `A–Z a–z 0–9 - . _` is escaped as `~` and
  four hex digits, so a token is printable ASCII and one key has one spelling.
  `decodeKeyToken` refuses every other spelling. A key whose token would exceed
  the 200 characters formancy stores is refused, never truncated.
- **`buildLookupConfig(bindings, field, { snapshot })`** derives what an adapter
  may know: the target, the key columns in order with their types, display,
  search and sort columns, and the page size. Every sort column says where
  NULLs go, last by default, because the engines disagree. It refuses bindings
  from another snapshot, bindings that are not what the root's foreign key
  references, a float, binary, boolean, time or timestamp key, and a search
  over a column the label does not show.
- **`validateLookupQuery`** is the boundary for a search request: exactly a
  search, an offset and a limit, trimmed and bounded.
- **`LookupAdapter`** is the port: `search`, `resolve` and `rejects`, each with
  the actor's trusted row filters, read with `rowFilterTerms`. "Every row" is
  `{ kind: 'unrestricted' }`, written on purpose; an empty list is refused.
  `rejects` is the shape formancy's server-side `members` port asks for.
  `lookupKeys`, `lookupPage`, `resolvedRows` and `rejectedTokens` build its
  answers: a token is asked about only when each value is spelled as its key
  column holds it, and is a member only when a row found under those filters
  re-encodes to it exactly.

A token is a reference, not a permission: it says which row was meant, and the
server decides again, every time, whether this actor may name it. See
[0012](../../docs/decisions/0012-a-lookup-token-is-a-reference-not-a-permission.md).

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
nothing calls it yet; the server that will is still to come.

```ts
import { planCreate, planUpdate, rejectedSelection, toFormAnswers } from '@formancy/data-core'

const planned = planCreate(snapshot, bindings, policy, context, body)
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
- **Membership is the database's.** A lookup token whose key carries the tenant
  is refused when the tenant is not the context's; one that does not — a
  surrogate id — cannot be judged without a query. Every selection comes back
  as a `MembershipCheck` for the caller to run against `rejects` before it
  writes, and every non-member, forged or foreign, gets the same
  `rejectedSelection`.
- **`toFormAnswers`** is the inverse, for the fields the actor may read: a
  lookup as its token, the three-state radio as `'true'`/`'false'`/`null`, and
  a whole number as a number, because the released engine reports canonical
  text in a number field as below its minimum.

See [0018](../../docs/decisions/0018-one-planner-turns-answers-into-requests.md).

## Licence

Source-available, not open source. See [`LICENSE.md`](./LICENSE.md): free to
read, fork, evaluate, develop and test; a paid licence for production use.
