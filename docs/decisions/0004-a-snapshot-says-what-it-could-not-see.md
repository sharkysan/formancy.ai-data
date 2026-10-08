# 0004 — A metadata snapshot says what it could not see, and is made in one place

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/snapshot.test.ts` — the fingerprint
  is independent of catalog order and of the server version, a new gap changes
  it, sorting is by codepoint rather than locale, and a key over a missing
  column, a foreign key whose sides differ in length, a duplicate object and a
  duplicate column are each refused. `packages/data-fixtures/src/conformance.test.ts`
  — a foreign key missing from a restricted reader's snapshot with no gap is a
  disagreement, and the same key with a gap is not. That every adapter builds
  its snapshot through `createSnapshot` is held by review: nothing stops an
  adapter constructing the object literal itself.

## Context

The plan's first-release promise is a form generated from what the catalog
says. Two facts about catalogs make that harder than it sounds.

**Catalogs are permission-filtered, silently.** PostgreSQL's
`information_schema.referential_constraints` shows only constraints on tables
the account has privileges on. SQL Server's catalog views show only securables
the account has some permission on, and return `NULL` for a default's
definition without `VIEW DEFINITION`. An account that cannot see a foreign key
gets a catalog with one fewer foreign key in it, and that looks exactly like a
database where the relationship does not exist.

**The engines do not share a vocabulary.** `integer` and `int`, `text` and
`nvarchar(max)`, `bytea` and `varbinary(max)` are each one thing. SQL Server's
`sys.columns.max_length` for `nvarchar(200)` is 400, in bytes. PostgreSQL has
no `rowversion`. A core that compared type names would need a table of
synonyms; one that compared nothing would let each adapter decide alone.

## Decision

**A snapshot carries its gaps.** `MetadataSnapshot.gaps` lists what the
connection could not establish, per object and per aspect — objects, columns,
keys, foreign keys, checks, defaults, comments. A foreign key whose existence is
visible and whose target is not is reported with `references: null` and a gap,
not dropped. The silent answer is the one that is never acceptable.

**Types are normalised to what can be compared**: integer ranges as decimal
strings, text lengths in characters with a fixed-length flag, decimal precision
and scale, timestamps with or without a zone. The database's own spelling is
kept beside it in `databaseType`. A type with no tested codec is
`unsupported`: a value, reported, never omitted.

**`createSnapshot` is the only way a snapshot is made.** It sorts by codepoint,
refuses structures no catalog could produce, and fingerprints the kind, the
objects and the gaps with `@formancy/spec`'s canonical SHA-256. Two adapters
cannot disagree about order or hash, because neither of them decides it.

## Consequences

**What it buys.** "No relationship" and "this connection cannot tell" are
different answers everywhere downstream: the generator can refuse to offer a
lookup it is unsure of, and drift review can say "access changed" when a
permission is revoked, because the gaps are inside the fingerprint. The server
version is outside it, so a patch upgrade is not drift.

**What it costs.** Every adapter has to know, per aspect, how its engine hides
things, and say so. That is real work on SQL Server, where whether a definition
is hidden has to be inferred from a `NULL`. A gap is also a coarse instrument —
an aspect of an object, with a sentence — and a consumer that wants to act on
one has to read the sentence. Normalising types loses nothing, because the
database's spelling travels with it, but it does mean `NormalizedType` grows a
variant whenever a codec is written for a new kind.

**What it forecloses.** An adapter that "does its best" quietly. A catalog
query that fails for lack of permission produces a gap, not an exception and
not an omission.

## Alternatives considered

**Read `information_schema` on both engines.** Rejected: it is the
permission-filtered view on PostgreSQL, and it does not carry SQL Server's
trust and disable flags, rowversion or extended-property comments. The plan
already said one `INFORMATION_SCHEMA` query would not be enough for both.

**A boolean `complete` flag.** Rejected: it says that something is missing and
not what, so the generator could not tell an unreadable check expression —
harmless for a form — from an invisible foreign key, which is not.

**Throw when the catalog is incomplete.** Rejected: an account with
deliberately narrow permissions is the configuration the plan recommends, and
it should get a usable, honest snapshot rather than an error.
