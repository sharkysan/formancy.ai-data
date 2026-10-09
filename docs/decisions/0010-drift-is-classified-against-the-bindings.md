# 0010 — Drift is classified against one form's bindings, and what cannot be seen is never called gone

- **Status:** accepted; the retyped row narrowed by [0026](0026-name-every-column-fact-the-engines-disagree-on.md): a different length unit or fixed length is a retyping
- **Date:** 2026-10-08
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/drift/diff.test.ts` — identical
  snapshots, even from a patched server, give an empty report and keep exactly
  what the form offered; bindings from another snapshot, a snapshot of another
  engine, and bindings naming what the base lacks are refused; the root gone
  with no gap is "the table is gone", the root vanishing behind its own gap or a
  scope-wide one is an access problem, and the root outside a narrowed scope is
  a scope problem; a new gap blocks exactly what it puts in doubt, and one that
  went away stops nothing; a gap given as the reason something vanished still
  stops everything it puts in doubt; changes sort most severe first, by
  codepoint, and two runs are byte-identical. `columns.test.ts` — a new
  nullable or defaulted column is for review and a new NOT NULL one stops
  create and only create; a dropped or retyped bound column blocks the form, a
  dropped unbound one is a note; tightened precision, scale, length, range,
  nullability or default blocks writes of that field and loosened is
  information, unless the published control can no longer hold the column; the
  concurrency column gone or changed stops update; an apparent rename is two
  changes and a hint; a bound column behind a gap is access.
  `relationships.test.ts` — the foreign key, target key, target table and
  display columns behind a lookup; foreign keys and keys compared by what they
  are, never by how they read; the key behind the identity; constraints the
  form does not rest on are notes; tables it does not touch are left out.
  `compare.test.ts` — which way each kind of type moves. Watched failing with a
  vanished root's gap ignored, with the outgrown-field check removed, with
  severity ignoring what the form offers, with a cited gap's own doubt dropped,
  and with foreign keys compared as sentences.

## Context

Plan section 14 says what a rescan can find and what each finding should do,
and DATA-14's completion is "compatible changes preserve overrides;
incompatible writes stop". Three facts shaped how.

**A fingerprint says that something changed, not what, and not whether it
matters.** It covers every object in scope and every gap (0004), so a column
added to a table no form uses changes it as surely as a dropped primary key.

**The same change means different things to different forms.** A dropped column
stops the form that binds it and is nothing to the one that does not. A new
NOT NULL column stops create for a form that offers create and changes nothing
for a view's read-only form. The bindings (0009) are what says which: each
field's columns and whether it writes them, the identity, the concurrency
token, and the operations offered.

**A permission-filtered catalog looks like a smaller database.** A revoked grant
removes a table, a column or a foreign key from what discovery sees, exactly as
`DROP` would. 0004 made gaps for this case. Called a deletion, an administrator
retires a form whose table is fine; the remedy is a grant.

## Decision

`diffSnapshots(base, current, bindings)` returns every change to what the form
rests on, each with a stable `kind`, a `severity` for this form, a subject, the
fields it affects by key, and a sentence; and the report says whether anything
blocks and what the form may still write.

- **Severity is decided once, from what a change stops.** Each change records
  the writes it makes unsafe and whether the form can no longer read what it
  binds. It is `blocking` when it breaks a read or stops a write this form
  offers, and otherwise its own `review` or `info`. `writable` is what the form
  offered, less what any change stops.
- **The rules**, from plan section 14:

  | Change | For the form |
  |---|---|
  | New nullable, defaulted or generated column | `review`: an optional inclusion |
  | New NOT NULL column, no default, no generator | stops create |
  | Bound column dropped, retyped — including a different length unit or fixed length (0026) — or spelled differently with the same normalised type (`nvarchar` to `varchar`) | blocks the form: the published codec is wrong for it |
  | Bound, written column tightened: precision, scale, length, range, nullability, or a default create relied on | stops writes |
  | Column loosened | `info`, unless the published control cannot hold it — an integer past 2^53 in a number field, a now-nullable boolean in a checkbox — which stops writes |
  | Database starts generating a written column, or stops generating one nobody fills | stops writes, or create |
  | Concurrency column gone or changed | stops update |
  | No key covers the identity any more | stops update |
  | Anything about the foreign key behind a lookup, the key it points at, its target or a display column | blocks the lookup. Compared by value: schema `a.b`'s table `c` and schema `a`'s table `b.c` read alike and are different targets |
  | A column gone and one with the same definition added | the two changes, plus a `possible-rename` hint for review; names are never compared |
  | Something gone that a gap explains, or a foreign key with no visible target | `access-narrowed`, never a deletion; the gap is said there once if that change stops all the gap would, and is reported beside it otherwise |
  | A new gap | stops what it puts in doubt: the root's columns, every write; its keys, update; foreign keys and a lookup target's columns or keys, the lookup. Checks, comments and default expressions: `info` |
  | A gap gone | `info` |
  | The root missing | out of scope, `scope-narrowed`; behind a gap, `access-narrowed`; otherwise `root-dropped`. All block |
  | The root's other keys, foreign keys and checks | `info` |
  | Tables the form neither binds nor looks up, comments, catalog positions | left out |

- **Equal fingerprints are the fast path**: an empty report, nothing walked.
- **It refuses rather than guesses** when the bindings were not generated from
  `base`, the snapshots are of different engines, or the bindings name a
  column, foreign key, table or identity key the base does not have.
- **The generator's rules are reused, not restated.** Whether a field can hold
  a column is `controlFor`'s answer; whether create is possible is the
  generator's own test, applied to the database as it is now.

## Consequences

**What it buys.** The review screen's content for plan section 3's tenth step,
in the order a person should read it, with the field each change touches. A
revoked grant reads as access and a narrowed scope as scope, so neither retires
a working form. Drift and generation cannot disagree about what fits a field,
because one function decides it for both.

**What it costs.** Failing closed over-blocks, on purpose, and each of these is
a person's time. Any change to a lookup's foreign key stops the lookup,
including `ON DELETE`, which a form never exercises. A new gap on the root's
columns stops writes even when every bound column is still visible, because a
NOT NULL column nobody can see would make every create fail; that holds when
the gap also hides the concurrency token, so the token and the gap are two
changes quoting the same words. A server upgrade
that respells a type stops every form that binds it. `writable` is per
operation, so a tightened field stops all of update, even a patch that does not
touch it; `affects` names the field so that a runtime that refuses per field
could do better, and none exists yet. Changes outside the form are left out,
so an empty report beside two different fingerprints is normal, and a
schema-wide diff is a different tool that is not written. Rename hints compare
definitions only: two same-typed columns renamed at once give crossed hints, and
a rename that also changed the type gives none. Not compared at all: triggers,
check expressions as validation (the form does not translate checks), and the
database at write time — two snapshots cannot see DDL that lands after the
rescan, which plan section 14 leaves to translating the runtime error. Every
test here is pure: no adapter yet discovers, alters and rediscovers a real
server, and that end-to-end belongs to the adapter suites when discovery lands.
The sentences are English and not a contract; `kind` is.

**What it forecloses.** Inferring a rename. Reporting as deleted something a gap
explains.

## Alternatives considered

**Diff the snapshots without the form, then filter.** Rejected: the severity
depends on the form, so a context-free diff has to be classified again anyway,
and a list of everything that changed buries the one change that blocks.

**Report changes elsewhere in scope as information.** Rejected: the review is
for one form, and listing every table's changes makes each form's review the
size of the schema's history. Left out, and the function says that an empty
report means nothing this form rests on changed.

**A fixed severity per kind.** Rejected for the reason above: a dropped column
is blocking for one form and a note for another.

**Loosened is always information, as the plan's list reads.** Rejected for the
two cases where the published control cannot represent the column. A number
field rounds past 2^53 and a save writes the rounded value back (0009); a
checkbox has no "unknown", so a NULL is saved as false. Both are silent data
changes.

**Use catalog position as rename evidence.** A rename keeps PostgreSQL's
`attnum` and SQL Server's `column_id`, so a column gone and one added at the
same position is good evidence, though not proof. Not used yet, and no test
here shows what either engine does with a dropped column's position: the hint
stays a hint either way, and it can grow this evidence without changing the
rule that a person confirms.

**Block on any fingerprint change.** Simple and safe, and it would make every
unrelated `ALTER` anywhere in scope stop every form. The fingerprint stays the
fast path, not the verdict.
