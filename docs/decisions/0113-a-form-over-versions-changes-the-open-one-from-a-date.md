# 0113 — A form over a table of versions changes the open version from a date, ending it and starting the next in one write

- **Status:** accepted; extends [0015](0015-a-record-operation-is-one-guarded-statement.md): a change from a date is one statement on PostgreSQL, and on SQL Server two -- an UPDATE and an INSERT -- in the one batch every write already is, committed or rolled back together; narrows [0050](0050-a-record-is-deleted-one-at-a-time-by-its-token-and-the-version-its-person-read.md): a form over versions offers no delete; extends [0023](0023-the-audit-trail-is-operational-not-evidence.md): the runtime operation `supersede`, naming the version addressed; extends [0031](0031-an-answer-lost-after-a-write-is-unknown.md): a lost change is `unknown-outcome` with `operation: 'supersede'`, the version sent, and sent again is stored at most once; extended by [0114](0114-the-studio-names-a-chain-of-versions-in-the-choose-step.md): the studio's Choose step names a chain, and a regeneration keeps it
- **Date:** 2026-10-30
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/generate/validity.test.ts` -- the chain bound
  with its key, the end never written, the start and the key on create
  only (watched failing with the narrowing left out), no delete and a
  change offered, each said in a note; no `validity` and no `supersede` in
  a form that names none; no change where the account may not UPDATE the
  end or the form offers no create; every pair refused that no chain could
  be held to (watched failing with a key of the start alone let through).
  `packages/data-core/src/records/supersede.test.ts` -- the request planned
  in full; an ended version and a start not after the open one refused as
  read at the version named, and left to the guard when read at another
  (watched failing with the version left out of the condition); an echo
  of the chain's key and the empty end dropped and another refused (watched
  failing with the key left out); no change without the version as read,
  both operations, or a chain; the create's `fresh` and the update's `open`
  (watched failing with each left off).
  `packages/data-server/src/routes/runtime-supersede.test.ts`, over fake
  ports -- 201 with the next version, the trail `supersede` (watched failing
  with the route unregistered: 404); an ended version and an early start
  refused before the adapter; `version-ended` and a lost answer answered
  (watched failing with `version-ended` left out of the record failures:
  500); a reader refused; `versions` named to whoever may change one and
  `null` to a reader; `chain-exists` and an update's `open`.
  `packages/data-server/src/bundle.test.ts` -- a chain the bindings have
  and the request does not name, or the reverse, refused on read (watched
  failing with the chain left out of the comparison).
  `packages/data-postgres/src/versions.integration.test.ts` and
  `packages/data-sqlserver/src/versions.integration.test.ts`, each against
  its real server, every case of `VERSION_PARITY` declared with `covers()`:
  a change, stale, ended, another tenant's, an update of an ended version,
  a chain that exists, and a next version the database declines, undone.
  Each guard watched failing on both engines, in CI while Docker was down
  on the workstation: with the NULL end left out of the change, an ended
  version was changed; with `open` left out of the update, an ended version
  was updated; with the create's condition left out, a second chain was
  created; and with the self-check narrowed on PostgreSQL the end stood,
  answered as a change, and with the batch's check left out on SQL Server
  the end committed and nothing was inserted, answered `not-found`.
  `packages/data-client/src/transport.test.ts` -- `supersede` is one of the
  calls every request is held to.

## Context

Many tables a deployment keeps hold versions of one thing rather than the
thing: a product's price, a contract's terms, an employee's rate, each row
valid from one date until the next row of the same thing starts. The rows
are a chain: one thing's versions, ordered by their start, each ending
where the next begins, the last one open.

A form over such a table treats every row as a record of its own. A person
who changes a price either overwrites the current row -- and the price it
had is gone -- or creates a row and edits the old one's end in a second
save, which may never happen, or happen wrong: a gap, an overlap, two open
versions of one product.

The backlog asked for history and validity chains, a decision record
first. Decided with the user on 2026-10-30: business validity -- rows the
deployment already keeps with valid-from and valid-to columns, not SQL
Server's system-versioned history -- and append only: a person changes the
open version from a date; a version that has ended is not edited through
the form.

## Decision

**A generation request may name a chain:** `validity: { from, to }`, two
columns of the root (`generate/validity.ts`). The generator refuses it
unless:
- both are columns of the root it can read, neither computed nor pinned;
- they are of one kind, a date or an instant;
- `from` is NOT NULL and `to` is nullable: the open version holds NULL in
  `to`, the one spelling of "open" this release reads;
- the form has a version column or a rowversion, since a change names the
  version its person read (0015);
- a primary or unique key of the root holds `from` and not `to`, and
  another column: that key less `from` is the chain's key, what one
  thing's versions share. The primary key is asked first, then each unique
  key, as the identity is.

A version is valid from `from` up to, and not including, `to`. The
bindings keep the chain (`FormBindings.validity`: the two columns and the
key), and the bundle's check holds a stored request and its bindings to
the same chain on every read, as it holds their lookups.

**What the form writes follows from it.** `to` is never written by the
form: the server writes it, ending a version. `from` and the chain's key
are written on create only. Delete is not offered: removing a version
leaves a gap or opens the one before again. A change from a date
(`operations.supersede`) is offered where the form offers create and
update and the account may UPDATE `to`. Each is a note.

**A change from a date is its own operation:** `POST
/v1/forms/:id/records/supersede` with `{ record, version, answers }`, the
open version its person read and the next version's answers, its start in
`from`'s field. It needs update and create from the policy. The route
reads the version first, as an update reads its record, and
`planSupersede` (`records/supersede.ts`) decides over that read:
- a renderer submits every field, so the copy echoes the chain's key and
  the empty end: equal to the version as read, they are dropped, and
  anything else there is over-posting -- another chain, or a version that
  starts ended;
- read at the version named, an ended version is 409 `version-ended`, and
  a start not after the open one's start is a field error; read at
  another version, neither is decided from a row the person never saw,
  and the write is answered stale;
- the next version's other answers are a create's, its pinned columns
  outside the chain's key from the context.

**The adapter ends the open version and inserts the next in one write**
(`RecordAdapter.supersede`), under everything an update is guarded by and
only while `to` is NULL; the chain's key is copied from the row ended, so
the next version is of the same thing whatever was sent.
- **PostgreSQL** (`records/versions.ts`): one statement, a data-modifying
  CTE whose INSERT selects from the row its UPDATE ended. Its own check,
  as the delete's (0050): a scalar subquery with a row for each version
  ended and one more where a version was ended and none inserted -- a
  trigger or a rule that declined the next one -- fails it with 21000,
  undoing the end, and that is `refused`.
- **SQL Server** (`records/versions.ts`): no data-modifying CTE, and a
  MERGE would hold its guard only in a locked read of its source, so the
  UPDATE and the INSERT run in the one transaction every write's batch
  already is (`writeBatch`). The INSERT finds the row it copies from by its
  key; where it finds none, the batch throws and rolls both back.

Nothing ended is read once more, as an update's nothing is: the table
moved, `version-ended`, `stale` or `not-found`. The answer is the next
version, 201, with its own token and version. A lost answer is
`unknown-outcome` naming the version sent (0031); sent again with it, a
change stored the first time finds the version moved on.

**A create starts a chain only where there is none.** Its insert holds
only while no row has the chain's key it writes -- a condition on the
insert itself on PostgreSQL, under UPDLOCK and HOLDLOCK on SQL Server --
and is otherwise 409 `chain-exists`. **An update holds only the open
version:** `to` IS NULL in its WHERE, and an ended version is 409
`version-ended`; the open one updates as any record does.

**The runtime plane says where a page may offer it.** `GET
/v1/forms/:id` names `versions: { from, to }` -- the fields a version
starts and ends at -- where the form offers a change and the person may
create and update, and `null` otherwise. `@formancy/data-client` has
`supersede`, and reads a form without `versions` as unexpected.

## Consequences

**What it buys.** A chain kept through the runtime plane: a price changed
from the first of next month ends the current one there, in the same
write, with no gap, no overlap and no second open version made by the
module.

**What it costs.**
- One spelling of a chain: two columns of one kind, half-open, the open
  version NULL in `to`. A chain whose end is inclusive, or open at
  9999-12-31, is not read as one.
- Append only. An ended version is read-only through the form; a version
  in the middle is corrected, inserted or removed in the database, and
  delete is not offered at all.
- On PostgreSQL two creates of one chain at once may both find no version
  and both insert, two open versions, unless the table holds one open
  version per chain itself -- a unique index over the chain's key where
  `to` IS NULL. SQL Server's range lock makes the second wait and find the
  first.
- A create whose chain's key the database fills in part is not checked
  against the chain: a part of the key alone would match other chains.
- On SQL Server the change is two statements, not one; inside one
  transaction, rolled back together, and the batch's guards are its
  INSERT's.
- A row written outside the runtime plane can break a chain; the form
  reads what is there.
- A change takes create and update from the policy, and a state field's
  moves (0112) are asked of the next version as of a create.
- The list shows every version; which are open is a filter, a person's or
  a list view's (0105). There is no "as of a date".
- The studio has no control to name a chain, and the host page offers no
  change yet: both are the next record's. Until then a chain is named in a
  proposal's request through the administrator's plane, and changed
  through `@formancy/data-client`.
- `@formancy/data-client` reads a form without `versions` as unexpected,
  so a host and its server are upgraded together.

**What it forecloses.** Nothing: a later record may add correction of a
past version, or read SQL Server's system-versioned history beside it.

## Alternatives considered

**Two saves from the page: the end of the old version, then the new one.**
Either can fail alone, and a chain with a gap or two open versions is the
result.

**SQL Server's system-versioned temporal tables.** They keep when a row
changed in the database, not when a price is valid, and PostgreSQL has
none. The user chose business validity.

**Correcting any version, the neighbours' dates moved to keep the chain
whole.** More statements to prove on both engines, for an edit people make
rarely; the user chose append only.

**An inclusive end, or an open end spelled 9999-12-31.** Both are common.
Reading one spelling first keeps the guard a predicate on NULL; another is
a later record's.

**A MERGE on SQL Server.** A source of the open row, twice, can end it and
insert the next in one statement. But the version guard then sits in the
source's read, which holds only under locking hints until the update, and
MERGE's own caveats come with it. The batch every write already is says
the same thing plainly.

**Refusing an ended version in the planner alone.** A person who may
update and not read has no version as read to decide it from; the
statement's own condition decides it for everybody.

## Older records

Extended, not edited away: 0015 (two statements in one batch on SQL
Server), 0050 (no delete over versions), 0023 (`supersede` audited), 0031
(a lost change).
