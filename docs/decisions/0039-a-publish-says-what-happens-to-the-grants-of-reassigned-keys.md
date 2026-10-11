# 0039 — The server refuses a publish whose keys now name other columns, unless it says what happens to their grants

- **Status:** accepted; extended by [0043](0043-a-child-forms-rows-are-reached-only-through-a-parent-its-policy-admits.md): a key a policy's `through` names is a grant on it, with or without a role on its field, and `grantsOnKey` counts it
- **Date:** 2026-10-10
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-server/src/routes/admin-keys-reassigned.integration.test.ts`
  — on PostgreSQL and SQL Server, through a plain HTTP client over a real
  socket, never the studio: a table whose two columns sanitise to one key is
  published with a clerk who writes `customer_note` and only reads
  `customer_note_2`; the owner drops the first column and adds a third, so
  both keys renumber; the regeneration published as it came is 422
  `keys-reassigned` naming both keys, and no version is written (watched
  failing on both engines against the publish route before this record:
  201, version 2); with `customer_note`'s grants removed and
  `customer_note_2` confirmed it publishes, and the clerk's write through
  `customer_note`, which now names the column `customer note`, is 403 while
  that column keeps its value. What the test fails on is the server
  accepting the grant unconfirmed; the write that acceptance allowed is
  this record's Context, not an assertion.
  `packages/data-server/src/routes/admin-evolution.test.ts` — the refusal's
  whole body; one key confirmed of two is still refused for the other; both
  confirmed publish (watched failing: 201 throughout); a confirmation of
  another column than the key stands for now, or than it stood for, is not
  one (watched failing with confirmations matched by key alone), and one for
  a key that was not reassigned is ignored (watched failing with it
  refused); a key left with no role needs none (watched failing with every
  key counted as granted); `keysConfirmed` that is not a list of
  `{ field, was, now }`, each a column or a lookup, is 400 (watched failing:
  201); a stale base is 409 `conflict`, not the keys (watched failing with
  the conflict check removed: 422), and so is a base below 1 (watched
  failing: 500); a version that no longer validates is not compared
  (watched failing with its stored bindings compared all the same), nor is
  one whose file does not parse (watched failing: 500, naming the store's
  path on disk), while a base the store fails to read for another reason
  refuses the publish and writes nothing (watched failing with every throw
  passed over: 201); a restore is not asked about keys (watched failing with
  the publish's check added to restore). It also holds two of the costs
  below as they stand: grants removed in one version and given back in the
  next are not asked about, and a form moved to another table is compared
  by column name.
  `packages/data-server/src/reassigned.test.ts` — on policies
  `validatePolicy` accepts: a role on a lookup re-pointed to another foreign
  key needs confirming, and its filter alone, which every lookup field has,
  does not (watched failing with every lookup entry counted as a grant); a
  column key that now names a lookup is reassigned, and a confirmation of a
  column sharing the foreign key's name does not confirm it (watched failing
  with anchors compared by name alone); an absent `keysConfirmed` confirms
  nothing.
  `packages/data-core/src/presentation/rebase.test.ts` — `grantsOnKey` is a
  read or write role on the key's field and nothing else (watched failing
  with lookup entries counted); `describeReassigned` says a column and a
  lookup apart.
  `apps/studio/src/regenerate.test.tsx`, through the real server: a key kept
  in the Policy step publishes (watched failing, 422 `keys-reassigned`, with
  the studio sending no confirmation); a key kept before "Generate again"
  is still confirmed when the draft publishes (watched failing with the
  confirmations left behind by "Generate again"); a key whose grants were
  removed publishes, and its publish confirms nothing (watched failing with
  removed keys sent as confirmed); a key removed and then given grants
  again, by one click on "Fill every field from the operations", is asked
  about again and publishes once kept (watched failing: nothing asked
  again).

## Context

[0030](0030-presentation-is-a-patch-over-the-generated-base.md) made keys
renumber in the open: two columns that sanitise to one key are `x` and `x_2`
in catalog order, and when the first goes the second becomes `x`. A
regeneration names each key that now stands for another column or lookup in
`keysReassigned`, and the studio holds Publish until a person keeps or
removes each one's grants. The server did not, and 0030 said so in its
costs.

Reproduced on 2026-10-10 against `postgres:17-alpine` (17.11) and
`mcr.microsoft.com/mssql/server:2022-latest` (16.0.4295.3, RTM-CU27), on the
shared fixture's servers. A table holds `customer_note` and `"customer
note"`, keys `customer_note` and `customer_note_2`. Version 1's policy lets a
clerk write `customer_note` and only read `customer_note_2`; under it the
clerk's write to `customer_note_2` is 403. The owner drops `customer_note`
and adds `"customer-note"`. The regeneration reports both keys reassigned
and no policy problem, because every key the policy names still exists —
which is all `validatePolicy` can ask. A plain HTTP client published it as
it came, the policy unchanged: 201, version 2; and the clerk's write through
`customer_note` was 200 and stored in `"customer note"`, the column version
1 had made read-only to the clerk. On both engines alike.

What the studio decides, per key (`apps/studio/src/policy.tsx`): **keep**,
which changes nothing, or **remove**, which takes the key's field roles and
its lookup filter out of the policy. A removal shows in the policy. A kept
key's policy is the same document as one nobody decided, so nothing in the
bundle can show it.

## Decision

`POST /v1/forms/:id/versions` takes an optional `keysConfirmed` beside
`expectedBase` and `bundle`: entries of a regeneration's `keysReassigned`,
`{ field, was, now }`, as it reported them.

- **Over a version**, the server reads the version named by `expectedBase`
  and takes `reassignedKeys` from its bindings to the bundle's. Each such key
  the bundle's policy grants on — a role, read or write, on its field:
  data-core's `grantsOnKey` — must be in `keysConfirmed` with the same
  field, the same `was` and the same `now`. Otherwise the publish is **422
  `keys-reassigned`**, with `keys` (those unconfirmed) and `problems` (one
  sentence each, data-core's `describeReassigned`, which the studio lists a
  regeneration's keys with), and nothing is written.
- **A key with no role needs nothing**: that is what removing its grants
  looks like, and a key nobody may read or write reaches nothing. A
  lookup's filter is not a grant by itself: every lookup field must have
  one, `[]` for every row, and nobody without a role on the field may
  search its options (`field-denied`). A confirmation for a key that was
  not reassigned grants nothing and is ignored.
- **A confirmation is of one reassignment**, never of a key alone: a draft
  generated again after its keys were decided can give a key yet another
  column, and a match by key would carry the decision to a column nobody was
  shown.
- **`keysConfirmed` that is not a list of `{ field, was, now }`, each a
  column or a lookup, is 400** `invalid-request`, before the bundle is
  read.
- **A stale base is the conflict first.** Against a version somebody has
  replaced, the keys may say something else; when keys would be refused and
  `expectedBase` is not the newest version, the answer is 409 `conflict`, as
  the store's compare-and-swap gives it.
- **Nothing is compared** for a first version, for a base that is not there
  — below 1, or past the newest — which the compare-and-swap refuses, or
  for a version the server no longer serves, because it does not validate
  or its file does not parse
  ([0019](0019-a-published-form-is-checked-every-time-it-is-read.md)): none
  of its grants is in effect, and publishing over it is how the studio
  replaces it. Any other failure to read the base refuses the publish; a
  check that cannot answer refuses (formancy.ai 0022).
- **A restore is not asked.** It republishes a version's policy with the
  bindings it was published — and, from this record on, confirmed — with,
  so each grant applies to the column it was written for.
- **The confirmation is the request's, not the bundle's**, and is not stored.
- **The studio** sends every key kept in the Policy step as
  `keysConfirmed`, and none it removed: a removal is about the grants the
  key had, so a removed key given a role again — by hand, or by filling
  every field from the operations — is asked about again, by `grantsOnKey`,
  the test the server refuses with. "Generate again" carries the decisions
  to the new draft. Its sentences are `describeReassigned`'s, and no longer
  say that the server would publish the grants.

## Consequences

It buys what 0030 promised only through the studio: when a key renumbers
within the form's table, a grant written for the column it stood for
reaches the one it stands for now only when somebody said so in the publish
over the version the grant was written in — whichever client published it,
over a version the server still serves — proved on both engines.

What it costs:

- **A client that publishes regenerations echoes `keysConfirmed`.** One
  written against 0030 that ignored `keysReassigned` is now refused whenever
  its policy gives a role on such a key. That is the point, and it is a
  break for that client.
- **The confirmation is kept nowhere.** The version file holds the policy as
  published, and the audit event
  ([0033](0033-the-administrator-plane-is-audited.md)) names who published
  over which version, not which keys they confirmed.
- **A publish over a version reads and validates that version once more.**
  Not measured.
- **A publish over a version the server no longer serves is not checked.**
  A version edited or damaged on the volume is in that state, and so is one
  a stricter validator after an upgrade refuses; none of their grants is in
  effect until they are replaced.
- **The check is against the version replaced, and no other.** Grants
  removed in one version and given back in the next are not asked about.
  That is how a key's grants are given again when no client can confirm
  them (below), and it is also how one policy file pushed twice, the first
  time with the reassigned keys taken out, carries the first version's
  grants to the columns those keys name now.
- **An anchor is a column's or a foreign key's name, not its table's.** A
  publish that moves a form to another root table or connection compares
  its keys by name, and every grant follows its key to the same-named
  column there, unasked. The studio starts such a draft from an empty
  policy; a plain client is not stopped. Whether a form id may move to
  another table at all — a host's record ids would then name another
  table's rows — is a decision of its own, not this record's.
- **Versions published before this record are not checked again**, and a
  restore of one brings back whatever its publish let through.
- **The studio offers Keep and Remove only for the keys its regeneration
  reported.** A draft proposed afresh over a published version from the
  Choose step, or generated again after the database renumbered a key once
  more, whose policy gives a role on such a key is refused with the
  server's sentences. A key still undecided keeps the Keep its regeneration
  offered, which confirms the column the regeneration reported, not the one
  the key names after the second renumbering, and the server refuses that
  too. The grants are removed and given again in a later version, or the
  form is regenerated from the Drift step.
- **Keep is about the key, not its roles.** A kept key whose roles are
  changed by hand afterwards is not asked about again; a removed one given
  roles again is.
- **A confirmation says what a key stands for, not that its grants are
  right**: the server takes the administrator's word for the new column.
- **Only a field's roles count as grants on a key.** A lookup's filter
  reaches nothing without one; operations and row filters name no key and
  are not considered; a row filter names a column, which does not renumber.
- **The sentence is one function, the screens are not.** The server's
  `problems` and the studio's two lists are `describeReassigned`, so they
  cannot say a key differently; the studio's buttons and headings around
  them are its own.

## Alternatives considered

- **Refusing every grant on a reassigned key, with no way to confirm one.**
  Keeping grants would take two versions — one without them, one giving them
  again — and in between nobody could use the field.
- **The confirmation in the bundle, stored with the version.** A restore
  copies a stored bundle to follow another version, so a stored confirmation
  would claim a decision against a version it never followed; and a bundle is
  validated on its own on every read (0019), which a fact about its
  neighbour would make depend on another file.
- **Reading a keep from the policy.** A kept key's policy is the one nobody
  decided; there is nothing to read.
- **Confirmations matched by key alone.** The "Generate again" case above:
  the decision would follow the key to a column the person never saw.
- **A decision for every reassigned key, granted or not.** A key with no
  grant reaches nothing, so its refusal would be ceremony; the studio still
  asks about each, which costs a click.
- **Counting a lookup's filter as a grant.** Every lookup field must have
  one, so a re-pointed lookup key could never be published without a
  confirmation, whatever its roles, and the "remove its grants" this record
  offers did not exist for it.
- **Comparing with every earlier version, or with the newest whose bindings
  differ.** It would close the two-publish gap above, and with it the one
  way grants are given again when no client can confirm them: the second
  publish would be asked about a reassignment the regeneration in front of
  it no longer reports.
- **Treating a change of root or connection as reassigning every key.** An
  anchor names no table, so the refusal would say a key "now stands for
  column name" as it did before, and a confirmation could not say which
  table it was for.
- **Sending a removed key as confirmed.** The removal leaves no grant to
  confirm, and a confirmation sent for it let any grant that came back
  after it — a bulk fill is enough — through without a question.
- **Refusing a publish over a version that no longer validates or
  parses.** It would close the one way the studio replaces such a version
  (`apps/studio/src/publish.test.tsx`), and the server could not say which
  keys to confirm.
- **Passing over every base the store fails to read.** A read the volume
  fails once may succeed a moment later, with the version served and its
  grants in effect; only a file that does not parse is known not to be.
- **Checking restores like publishes.** A restored version's grants come
  back with the bindings they were written for; asking for confirmations
  would ask about a decision already made, and a client could not make it,
  since a restore carries no draft to decide on.
- **Stopping writes through a reassigned key in the runtime.** The runtime
  serves one version and does not know what a key stood for in another; the
  grant is decided when it is published.

## Older records

Narrowed, not edited away:
[0030](0030-presentation-is-a-patch-over-the-generated-base.md)'s cost
"`keysReassigned` is held by the studio only" is answered here, and its
Status line says so. Like 0030's generator check, this one runs at publish
only: what a stored version is, and how it is read
([0019](0019-a-published-form-is-checked-every-time-it-is-read.md)), does not
change.
