# 0012 — A lookup token is a reference, not a permission

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/lookup/token.test.ts` — every awkward
  key (separators, the escape, quotes, empty strings, non-ASCII text, a value
  that is itself a token) decodes to exactly what was encoded; no two keys
  share a token; every token is printable ASCII; the 200-character bound is
  held against the released `@formancy/spec`'s own `acceptRemoteOptions`,
  which accepts a 200-character token and refuses 201; every spelling the
  encoder would not produce is refused; and an enumeration over near-miss
  spellings shows every accepted token re-encodes to itself.
  `packages/data-core/src/lookup/rows.test.ts` — a token whose row exists but
  was not found under the actor's filters is rejected (applying the filters
  in the query is the adapter's half, and is not tested here); a token the
  database matched under another spelling (case, a trailing space) is
  rejected while the exact spelling is not; a page reads one extra row for
  `hasMore` and counts a row it cannot offer; every page passes
  `acceptRemoteOptions`. `packages/data-core/src/lookup/query.test.ts` — an
  empty or whitespace search is no filter exactly where formancy's
  `narrowOptionsByLabel` says so; limits, offsets, lengths and control
  characters are bounded. `packages/data-core/src/lookup/config.test.ts` — a
  config derived from bindings the real generator made has a total order; the
  default page size accepts the page formancy's control asks for; search is
  limited to displayed text and integer columns; float and binary keys and
  bindings from another snapshot are refused. Every test file was first run
  against a deliberately naive implementation — a comma join, a pass-through
  query, a comma-joined label, membership that rejects everything, a default
  page of 20 — and every case failed on its assertion before the real code
  was written. One case did not at first: the different-spelling case passed
  against membership that rejects everything, and was given the exact
  spelling as a positive control until it failed. One branch, the refusal of
  a binary key, was found unreached by the coverage report and its test was
  written after the code. **Not mechanically
  enforced:** that an adapter builds its answers with these helpers rather
  than comparing values itself, and that a deployment wires `rejects` into
  formancy's `members` for every database-backed source. The first is held by
  the adapters' conformance suite when they implement the port; the second
  belongs to the server that composes them.

## Context

A generated form offers a foreign key as one `select` naming an option source
([0009](0009-generation-is-deterministic-and-says-what-it-chose.md)). formancy
resolves that name through the deployment, and on submission asks the
deployment's `members(values)` port which values it does **not** offer, failing
the submission closed when a source cannot answer
([formancy.ai 0077](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0077-options-may-come-from-a-named-source.md),
[formancy.ai 0022](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0022-fail-open-fail-closed.md)).
The select stores one string of 1 to 200 characters, and a stored submission
is immutable
([formancy.ai 0025](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0025-immutability-in-the-database.md)).

Four facts shape what that string can be:

- **A key can be composite**, and a select stores one string. Joining
  `['a,b']` and `['a', 'b']` with a comma gives the same string.
- **The string comes back from a browser.** Anyone can submit any string,
  including a well-formed reference to a row that exists and belongs to
  another tenant. The plan says it plainly: reject invented or cross-tenant
  keys even when the referenced record exists.
- **A database's equality is not string equality.** Under a case-insensitive
  collation `IN ('acme')` finds the row stored as `ACME`, and SQL Server's `=`
  ignores trailing spaces. A database can say yes to a string the lookup never
  offered.
- **formancy narrows a list by its label and nothing else**, trimmed, with an
  empty query meaning no filter (`narrowOptionsByLabel`), because matching
  data the person cannot see makes a filter behave inexplicably.

## Decision

**A token carries the key and nothing else.** No tenant, no signature, no
expiry. It says which row was meant; every use of it — a page, a label, a
submission — is decided again on the server under the actor's trusted row
filters, applied in the same query. A token that passed yesterday is checked
again today.

**One spelling per key, versioned.** `k1:` then each key value, separated by
commas; `A–Z a–z 0–9 - . _` are written as themselves and every other UTF-16
unit as `~` and four upper-case hex digits. The token is printable ASCII.
`decodeKeyToken` refuses anything the encoder would not have written, so two
tokens that differ never name the same key, and tokens can be compared as
strings. A key with an unpaired surrogate is refused: PostgreSQL cannot store
it and SQL Server can, so a reference to it would mean different things on the
two engines. A key whose token would exceed 200 characters is refused, never
truncated.

**A token is a member only when a row found under the actor's filters
re-encodes to it exactly** (`rejectedTokens`). The database's own match is
not trusted for this, because of collations.

**The configuration an adapter answers with is derived, not written**
(`buildLookupConfig`), from the form's bindings and the snapshot they were
generated from, checked by fingerprint, so every identifier an adapter quotes
is approved metadata. Search is limited to displayed text and integer columns,
the two kinds both engines spell alike as text. The order always ends with the
key, so it is total. The default page is fifty rows, which is what formancy's
control asks for by default. Row filters are not part of it: they are the
actor's, and arrive with each call, as `ReadonlyArray<{ column, value }>`, so
this port depends on the shape of a policy and not on its type.

**One port, three questions**: `search`, `resolve` and `rejects`, each taking
the config and the filters. The pieces that are the same on both engines —
which tokens to ask about, `hasMore` from one extra row, the label, membership
— are functions here, made once.

## Consequences

**What it buys.** A forged, replayed or cross-tenant token is refused for the
same reason an invented one is: no row found under this actor's filters
encodes to it. There is no secret to leak, rotate or revoke, because the token
grants nothing. A composite key travels as one string without ambiguity, reads
as itself in a log when it is an integer, a decimal, a UUID or a plain code,
and cannot hide an invisible character or a bidi control in an archive view.
The two adapters cannot disagree about a token's spelling, a page boundary or
what counts as a member, because neither of them decides it.

**What it costs.** Escaping is expensive outside ASCII: a UTF-16 unit costs
five characters, so a text key of forty non-ASCII characters, or twenty emoji,
cannot be offered at all. Such a row is counted in a page's `omitted` and
cannot be chosen; a raw-Unicode encoding would fit it, at the price of the
invisible characters above. `k1` has to be readable for as long as any stored
answer holds one, which with immutable submissions is forever: a `k2` adds a
branch and never replaces this one. Membership compares strings, so an adapter
must select the key columns rather than count, and a value the database calls
equal but spells differently is refused — a person whose saved answer names a
key that has since been re-cased by a cascade is refused on the next save,
which is 0077's "membership now, never membership then" with one more way to
happen. A person who sees a date in a label cannot search for it. Offset
paging costs a scan up to the offset on both engines; keyset paging would not,
and is not offered while formancy's control asks only for a first page. The
order of text, and of UUIDs on SQL Server, is each engine's collation, so a
cross-engine conformance case cannot compare the order of non-ASCII text.
Labels are not unique: two customers called "Acme AG" look alike, and only the
token tells them apart. Nothing caps the page size an administrator configures,
because no measurement yet says where a cap belongs. And until both adapters
implement `LookupAdapter`, it is an interface with no implementation; the
adapter half of DATA-07 is what makes it a port.

**What it forecloses.** A token that carries authority: a signed token, a
tenant inside it, a "pre-authorised" fast path that skips the check. And
changing the `k1` spelling in place.

## Alternatives considered

**A signed or encrypted token carrying the tenant.** Rejected: it makes the
token a permission. A leaked or replayed one grants what it encoded, revoking
it needs state, and formancy keeps the stored answer forever, so the
permission would outlive the policy that granted it. Checking on every use is
cheaper than all of that, and it is what the plan asked for.

**A JSON array.** Rejected: JSON spells one string many ways (`"A"` and
`"A"`), so it is not canonical without a canonicaliser on every reader,
and its quotes and backslashes cost length.

**Length-prefixed raw values** (`k1:1:7,4:1001`). Unambiguous, but it carries
raw Unicode — invisible characters, and a length that means UTF-16 units in
one implementation and code points in another.

**Percent-encoded UTF-8.** Rejected: longer for the same text (six characters
for `ü`, twelve for an emoji), RFC 3986 allows either hex case so a library's
output is not canonical by default, and a `%` invites a URL layer to decode it
once more.

**Trust the database's match for membership.** Rejected for the collation
cases in *Context*: it accepts a token the lookup never offered.

**Hash or truncate a long key.** A truncated token names a different key or
none; a hash is a reference the database cannot query without a table of
hashes, which is state this module does not keep.

**Clamp an oversized limit instead of refusing it.** formancy calls its
`limit` a hint, and the HTTP layer may turn a hint into a request by clamping
it. The core refuses, so the bound is enforced in one place and a lookup
configured smaller than the control asks for fails on its first request, not
as a page that is quietly shorter.
