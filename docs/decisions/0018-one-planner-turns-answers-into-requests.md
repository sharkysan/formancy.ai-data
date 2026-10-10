# 0018 — One planner turns answers into requests, and leaves membership to the database

- **Status:** accepted; narrowed by [0028](0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md): a lookup's filter is scoped as a request's is, by `scopeRowFilters`; extended by [0040](0040-instants-and-times-are-read-to-the-shape-and-an-unedited-one-is-never-written.md): `planUpdate` takes the record as read, removes an unedited instant or time the actor may write and read, and refuses `record-not-read` an update carrying one without that read; narrowed by [0041](0041-the-runtime-refuses-what-drift-blocks.md): the write planners take the root as the request described it and refuse `drift` what it stops, after the policy and before the codecs; a read is decided after its statement
- **Date:** 2026-10-09
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/records/token.test.ts` — a record
  token is the key token of the identity values in key order; a NULL, missing
  or numeric identity value is refused rather than spelled; a token with a
  value too few or too many, or a value its key column cannot hold in that
  spelling (`007`, `1e3`, past the range), is refused; a key of a kind with no
  settled spelling cannot be addressed. `plan-read.test.ts` — a read asks for
  the key and the columns the actor may read and nothing else, under the
  tenant filter; a malformed token, a trusted tenant not spelled as its column
  holds it (`042`), a policy that does not fit the form, a filter on a boolean,
  drift, a form with no addressable key, and each way a bindings file can
  contradict its own snapshot — a version column that is the key, a column a
  field is bound to or a generated one among them — are refused, each pinned
  to its own reason.
  `plan-create.test.ts` — the whole insert for every kind of answer, the same
  on both engines but for the version; an over-posted tenant, key or version;
  a decimal sent as a number; forged tokens and another tenant's customer get
  the answer an invented token gets; another tenant's employee, whose surrogate
  key says nothing, is decoded and handed to the membership check under the
  actor's filters; the three-state radio; a checkbox answered with text; an
  omitted required field and an omitted defaulted one; a create-only actor gets
  back only the key; a token the codec would respell; a lookup over the pinned
  tenant alone; a keyless table with a confirmed version column.
  `plan-update.test.ts` — a patch sets exactly what was submitted
  and never the tenant or the key; clearing a NOT NULL column, a changed key,
  an unconfirmed or withheld update, a version the target could never have
  returned, a row filter that pins the version column and an empty patch are
  refused. `generate.test.ts` — the generator refuses to confirm a version
  column that is the key or a lookup's column, and does not suggest a key
  column named like one. `answers.test.ts` — each answer in
  its control's shape; a reference with a NULL column is null, one no token can
  carry is left out; a record with no address has no token; a non-canonical
  record throws; and answers → `planCreate` → the stored row →
  `toFormAnswers` returns what went in on both engines, with answers the
  released `@formancy/core` engine accepts. Every test file was first run
  against a deliberately naive implementation and failed on its assertions;
  the cases that passed were the positive controls, the two that delegate to
  the key-token codec, and a cross-engine equality and a decimal's scale,
  which a naive version that passes values through also satisfies. Once the
  code worked, each guard was reverted on its
  own and its test watched fail. One survived at first — the check that a
  token's value comes back from its codec unchanged — because every lookup
  in the tests was keyed by integers, whose codec refuses a non-canonical
  spelling outright; the UUID case was written for it. **Not mechanically
  enforced:** that a server plans every request through these functions, runs
  every membership check before it writes, and builds the context from a
  verified identity. Nothing calls the planner yet, and no adapter implements
  `RecordAdapter`, so nothing shows yet that both engines do the same with
  these requests.

## Context

The pieces a record operation needs exist and nothing composes them: the
policy decides who may do what (0011), a token names a lookup's row (0012),
a codec checks one value (0008), and the record port says what an adapter is
asked (0015). Plan section 11 lists what every write does — resolve the
trusted context, apply operation, field and row permissions, decode and
validate values, recheck foreign-key membership under the same actor — and
all but the last are decisions with nothing engine-specific in them. Composed
in each adapter, or in each HTTP route, they would be two implementations of
the same decisions, and the first difference would be a tenant leak on one
engine.

Section 8 asks for omitted, null, empty, zero and false to stay apart: on
create an omitted field lets a default apply, on update it means unchanged,
and a hidden field must never erase a column. Section 9 asks for invented and
cross-tenant keys to be refused even when the row exists. Section 12 keeps a
form without a proven concurrency token read-only.

Measured against the released `@formancy/core` 0.3.0 in server mode, the mode
formancy's submission endpoint replays in:

- **A whole number as canonical text fails its own form.** The codec returns
  every integer as a canonical string, which is right for the database, and
  the generated control for an integer JavaScript holds is a `number` field.
  The engine reports the text `'2'` in a bounded number field as `min`, not as
  a type error. A record read back as the codec spells it is a record its own
  form refuses.
- **A checkbox is not type-checked.** `'true'`, `'abc'` and `1` all pass. The
  server's codec is the only gate between a string and a bit column.
- **A pinned column can be a required field.** The generator does not know the
  policy, so the customer form marks `tenant_id` required — NOT NULL, no
  default — while the policy pins it and refuses it as over-posting. No
  submission satisfies both.

And the port has one gap the planner has to close: a `RowFilterTerm` is a
column and text, with no type. An adapter binds it untyped and each engine
converts, so a tenant attribute of `'042'` matches tenant 42 on both and
`'acme'` is an error on both — neither what the host meant.

## Decision

`planRead`, `planCreate` and `planUpdate` turn an HTTP-shaped request and a
trusted context into exactly the `ReadRequest`, `InsertRequest` or
`UpdateRequest` an adapter receives, or a refusal with a stable code, or
field errors. `toFormAnswers` turns the record an adapter returns back into a
form's answers. All of it is pure: no I/O, no clock. What only the database
can answer is returned for the caller to ask.

- **A record is addressed by a record token**, `encodeKeyToken` of its
  identity values: one string per key, versioned, the encoding a lookup
  already uses, so the two cannot drift. `decodeRecordKey` holds each value to
  its key column's spelling, as `lookupKeys` does. A key of a kind with no
  settled spelling has no token, and its records cannot be read or updated.
- **The bindings are read against their snapshot.** A different fingerprint is
  `drift`. Then every column a binding names must exist and, for a column
  field, have the snapshot's type and nullability; no column may be bound
  twice; the identity must be the primary key or a unique key; a concurrency
  column must be a rowversion, or a non-nullable integer that the database
  does not generate, that is not part of the identity and that no field is
  bound to. The adapter increments a version column in every update (0015):
  as the key it would move the record's address — with the tenant in the key,
  into the next tenant — and as a field's column the statement could set it
  twice. The generator confirms and suggests a version column by the same
  function, so a form it makes is never refused for it here. Every type in a
  request is the snapshot's.
- **Trusted values are spelled as their columns hold them.** A filter value or
  a pinned value its column cannot hold in that spelling is `invalid-context`;
  a filter on a column with no settled spelling is `invalid-policy`.
- **The policy first, then the values.** The root's filter is asked first,
  which authorises the operation and scopes it, then the fields, which fits
  the policy to the form and refuses over-posting. Each policy function
  authorises on its own (0011), so in the other order the second could never
  refuse; the coverage report showed it.
- **Every answer goes through its column's codec.** The three-state radio's
  `'true'` and `'false'` become booleans and nothing else is an answer. A
  lookup's token is decoded into its foreign-key columns, and each value must
  come back from its codec unchanged. A value for a pinned column must be the
  context's; on update, a value for a key column must be the token's. Neither
  is written again. Every field error is reported, in the form's order.
- **One answer for every selection that is not this actor's to make.** A
  malformed token, another spelling, a token whose tenant contradicts the
  context: `rejectedSelection`, the same field error a caller returns when
  `rejects` refuses a token. A probe cannot tell them apart.
- **Membership is the database's.** A well-formed token for another tenant's
  row is indistinguishable from this tenant's unless the key carries the
  tenant. The planner decodes it, writes it, and returns a `MembershipCheck` —
  the lookup's derived config, the token and the actor's filters on its target
  — for every selection. The caller asks `rejects` before it writes.
- **Create:** the pinned columns from the context, through their codecs; an
  omitted field left out, so a default applies, unless its column is NOT NULL
  with no default, which is a field error before the database says so.
- **Update:** needs the form to offer it, a confirmed concurrency token and an
  addressable key. A patch: an omitted field is unchanged, an explicit null
  clears where the column allows it. The key and the pinned columns are never
  set; a key field equal to the token's is accepted and dropped, a different
  one refused. A row filter that pins the version column is `invalid-policy`:
  the increment would move the record out of the rows the filter admits. The
  version must be one the target could have returned. A patch that sets
  nothing is refused here, once.
- **What is read back is what the actor may see**: the key, when a token can
  carry it, and the columns of the readable fields. An actor who may create
  and not read gets the key and nothing else.
- **`toFormAnswers` is the inverse**, for the readable fields only: a lookup
  as the token of its columns, `null` when any is NULL and left out when no
  token can carry it; the radio's strings; a whole number as a number. A
  record that is not canonical — a missing column, a number where text was
  due — is a programming error and throws.

## Consequences

**What it buys.** One translation, in pure code that runs in every test
without a database, and both adapters handed the same request for the same
answers: neither decides how a token is decoded, what an omitted field means,
which columns a tenant may see or whether a version is well formed. A forged
token and another tenant's are refused the same way. A form drifted from its
database is refused rather than written through. And what a person enters
comes back as they entered it, in the shape their own form accepts.

**What it costs.** The membership check is the caller's to run, and a caller
that skips it writes another tenant's employee into this tenant's order — a
foreign key does not know tenants. The result type puts the checks in front
of every caller; it cannot make one call `rejects`, and until a server exists
nothing does. A record token tells anyone who may read the record its key,
whatever the policy says about the key's field, and a create-only actor gets
the key of what it made; the token is an address, and addresses are not
secret (0012). A key no token can carry — forty non-ASCII characters, a
timestamp, a float — leaves its records readable by nobody through this
module, and such a reference is left out of a form's answers rather than
shown. The planner is strict where a client might expect leniency: a JSON
boolean for the three-state radio, `'true'` for a checkbox, an empty patch, a
changed key and a tenant attribute of `'042'` are all refused, and a
`PATCH {}` is an error rather than a no-op. `toFormAnswers` returns read-only
fields such as the key, and a form that submits them back is over-posting;
the client has to leave out what the form never writes. The generated
customer form requires the tenant the policy forbids, and nothing here
resolves that: the host has to supply the tenant to formancy's own check and
leave it out of what it plans, or a presentation override has to drop
`required`. A server must keep the snapshot each published form was generated
from, because every plan reads it. The planner settles the spelling of a
filter value, and an adapter still binds it without a type, because the port
carries none. A table whose only version column is part of its key cannot be
updated through this module, and a column a lookup writes can be confirmed
only by leaving that lookup out of the form. `validatePolicy` still
accepts a row filter on the version column, because a read and a create are
sound under it, so that mistake shows at the first save and not at
publication. Every request is checked against its snapshot from scratch,
which costs a pass over the bindings per request and has not been measured.

**What it forecloses.** An adapter that reads a request body, a planner that
queries, a tenant taken from the request even when it agrees, and a key
changed by an update.

## Alternatives considered

**Each adapter decodes the answers itself.** Rejected: the same decisions
written twice, which is what the core exists to prevent (0015), and the
difference would show up as a write that one engine accepts.

**The planner calls `rejects` itself**, taking a `LookupAdapter`. It would
make the membership check impossible to skip. Rejected for now: the planner
would become asynchronous and stateful, the core would stop being pure, and
the check is one of several the server runs between planning and writing —
the audit record, the transaction — which belong to the composition root.
Worth revisiting when the server exists and shows whether callers forget.

**A signed or opaque record id.** Rejected for the reasons 0012 rejected a
signed lookup token: it would grant what it encoded, need state to revoke,
and give one record two spellings.

**Treat a submitted key field on update as over-posting.** Rejected: a form
submits every field, so every save of a customer would fail. Equal is
accepted and dropped; different is refused.

**Canonicalise a token's values instead of refusing.** Rejected: a token has
one spelling (0012), `rejects` compares exactly, and a respelled token would
pass here and fail there — or, worse, be written as a value nobody offered.

**Leave integers as the codec's text and let the client convert.** Rejected:
the released engine reports it as `min`, so a person who opens a record and
saves it unchanged would be told it is wrong.

**Answer an unrepresentable reference with `null`.** Rejected: a form that
submitted the answers back would clear a reference the person never touched,
which is what section 8 forbids.

**Leave a missing NOT NULL value to the database.** Rejected as the only
check: the error arrives after the person has moved on, from one engine in
its own words. The database still decides; this is the provable subset.
