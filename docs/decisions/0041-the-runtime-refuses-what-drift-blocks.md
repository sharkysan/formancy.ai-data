# 0041 — The runtime refuses what drift blocks in the form's own table, decided over a description read in each request, and every write holds the table to it

- **Status:** accepted
- **Date:** 2026-10-10
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-server/src/routes/runtime-drift.integration.test.ts`, the
  reproduction of 2026-10-10 inverted, against `postgres:17-alpine` and
  `mcr.microsoft.com/mssql/server:2022-latest` through the real server, the
  real drivers and a pass-through that counts what the record port is asked:
  for every case of `DRIFTING` (`@formancy/data-fixtures`) review gives a
  verdict for, the drift route's report says review's `readable` and
  `writable` and the runtime's `runtime`; opening the form offers exactly
  what `runtime` allows, or is 409 `drift`; a read is answered exactly when
  `runtime` allows it; an update or a create it stops is 409 `drift`,
  reaches neither insert nor update, and leaves the row as the ALTER left
  it; one it allows is answered and committed. Watched failing on the
  runtime before this record (`012850a`), on both engines: every case the
  runtime must refuse as the reproduction observed -- updates answered 200
  and committed, 422 `too-long` and `out-of-range`, 409 `schema-changed`
  from the database, creates answered 201, every write reaching the
  adapter, and the form offering create and update -- and every case it
  must allow only for the report's `readable` and `runtime`, which it did
  not have yet, its requests answered as they are now. Those cases are
  held against a runtime that refuses too much: watched failing with the
  update planner's check removed, the opening's filter removed, the runtime
  decided as review, and a runtime that refuses whenever its report holds
  any change -- each case allowed despite a change failing then, on both
  engines.
  `packages/data-core/src/drift/diff.test.ts` and every drift suite through
  `drift/fixture.ts`, which holds each report any of them builds to two
  properties: the report's `runtime` never refuses what review allows, and
  where only the root's definition changed `diffRootDefinition` gives
  review's very report; and `readable` is false exactly when a change breaks
  reads, a lookup target's retyped display column blocks review and not the
  runtime, a described column the base lacks is assumed nothing (watched
  failing with `readable` as `!blocking`, with `after` built from the base's
  columns, with the root's relationship rules left out of
  `ROOT_DEFINITION`, with a new column given a default or assumed NOT NULL,
  and with the gap branch of a dropped token reverted -- the property's own
  first finding). `records/drift.test.ts` -- each planner refuses `drift`
  when the description stops its operation, after the policy and before the
  token, the version and the codecs, plans after a widening, and carries the
  description's definition (watched failing with each check removed and
  with a constant definition). Both adapters'
  `records-definition.integration.test.ts`, over every `DRIFTING` case on
  its engine, each shared case declared with `covers()`: the definition
  moves for every change a description reads, and not for a comment, a
  non-unique index or a grant to another account; an insert and an update
  decided over the old one are `schema-changed` and the row and its count
  are as the ALTER left them, a value only the moved column refuses
  included; decided over the new one, they are what the column now does; an
  ALTER that commits while a create, an update and a read wait for its lock
  is seen -- on PostgreSQL under READ COMMITTED and under REPEATABLE READ,
  with a rewriting ALTER and one that rewrites nothing; on SQL Server a
  write holding its lock while the ALTER queues is committed before the
  ALTER or rolled back, never written after it; the definition moves for an
  account that is not the owner exactly as for the owner -- on SQL Server
  one without VIEW DEFINITION, whose catalog hides a default's definition
  and which reads a sequence default as an ordinary one, the limitation
  held -- and a write of its own decided before the change is refused; a
  table dropped and created again under the same definition moves it on
  both engines; on SQL Server a column masked after publication moves
  nothing, and reads as its mask to that account, whose write of what it
  read stores the mask, the limitation below held; on SQL Server a trigger that ended the transaction of a
  write decided before a change is `unknown-outcome`, never
  `schema-changed`, and what it committed is stored; describe reads every
  table of the fixture and the parity schema, and a materialized view, a
  partitioned table and its partition, as discovery does, as owner, reader
  and writer, and its digest is the SHA-256 of the facts it parsed,
  recomputed in Node; on PostgreSQL describe and a read walk the catalog
  for the facts once, the digest reading the same walk; the digest is the
  same under every setting 0016's suites vary, a connection whose isolation
  is not the one described writes nothing, and the restricted accounts take
  the lock where they hold a table privilege and are refused where they
  hold columns; on SQL Server a TEXTSIZE that cuts the description is
  `unavailable` (watched failing with each guard removed, with SQL Server's
  check in CATCH and PostgreSQL's follow-up removed, with the isolation
  requirement, the lock taken first and the read asked again each removed,
  with typmod, precision and scale, and keys left out of the facts, with a
  comment, a privilege and a spelled default put into them, with a digest of
  other text, with the text unit a constant, with the definition asked in
  CATCH before a transaction a trigger ended, with the relation's oid left
  out of PostgreSQL's facts, with a default's object left out of SQL
  Server's -- which only the account without VIEW DEFINITION noticed --
  with a materialized view described as a table, and with the facts' derived
  table left for the planner to pull up: eleven scans of pg_attribute where
  six). Every older suite of both adapters, unchanged but for its writes
  taking their definition from `describe` (`defined` in
  `@formancy/data-fixtures`), and for the tests whose subject is the write
  itself on a table or a pool that cannot be described -- a renamed table,
  one that is not there, a closed pool or port, a pool with no connection
  to hand out -- or that throw before anything is sent, which carry a
  definition of their own so that the write is what is sent and answered;
  run with every failed description before a write thrown, no other test
  stopped at one. Through `defined`, the renamed table was refused when it
  was described, so its batch was never sent and nothing held xact_abort,
  and the INSTEAD OF check's branch for an account that cannot see the
  table could no longer be reached, the definition's check refusing first;
  that branch is gone. Carrying their own definitions, the renamed-table
  test fails without xact_abort, and the test of SQL Server's account
  denied VIEW DEFINITION -- now refused when its table is described, a read
  included -- fails without the definition's NULL check, its write `ok`
  with nothing stored.
  `packages/data-postgres/src/records-lost-answer.integration.test.ts` -- on
  the lock-first path, a write whose answer is lost is `unknown-outcome`, one
  whose backend is terminated while it waits for the lock is `unavailable`
  with nothing written, and the same driver answers afterwards (watched
  failing with a transaction's step left to settle when its connection is
  lost: the driver never answered again, and postgres.js threw outside any
  promise); and what a write lost while it waits for the lock held is
  collected while its driver lives on (watched failing with one promise
  that never settles shared by every lost step: 64 MB still held after four
  lost writes of 16 MB each).
  `packages/data-server/src/routes/runtime.test.ts` -- an actor the policy
  refuses reaches no statement; a read is one statement, decided over its
  own description, and refused it shows no value; the description is read
  once per request, from the read where there is one and inside the sending
  for a write; its definition is on every write the port receives; and a
  drift refusal is said once in the log by kind (watched failing with
  create's description outside the sending, with the description before the
  policy, with a constant definition, with the opening's filter removed, and
  with the read not decided).
  `packages/data-server/src/e2e.integration.test.ts` -- a compatible change
  keeps the published form saving, and the incompatible one refuses opening
  and saving through it, the order as the drop left it (watched failing
  with an equality verdict and with none). `apps/studio/src/drift.test.tsx`
  -- the Read line, and the line that says which blocked operations the
  server still allows, exactly when it does (watched failing with each line
  removed and with the server's line always shown).
  **Not mechanically enforced:** that a pool's connections share one
  `search_path` and one default isolation, which PostgreSQL's spelling of a
  type and the answer to a write that wrote nothing depend on; the round
  trips and the time below, counted and measured by scripts outside the
  suites. When 0034's harness merges it pins the round trips of the
  requests it has scenarios for, PostgreSQL under READ COMMITTED and SQL
  Server, and measures their time; nothing pins the PostgreSQL figures
  under another isolation, which are no 0034 scenario.

## Context

0030 left "the runtime still does not stop writes on drift"; 0010 said the
database at write time is not compared, and that plan section 14 leaves DDL
after the rescan to translating the runtime error. Reproduced on 2026-10-10
on PostgreSQL 17 and SQL Server 2022: after a shorter varchar, a narrower
numeric, a retype to integer and a retype to `real`, each of which drift
review calls blocking with update stopped, every runtime update still
reached the database. A narrower scale stored `1234.5678` as `1234.57`, and
a `real` as `1234.5677490234375`, each answered 200; a column no ALTER
touched committed; reads answered 200 though a retyped bound column cannot
be read faithfully. The silent cases raise no error, so there is nothing to
translate. The only drift refusal the runtime had compared two fields of
the stored bundle, and the bundle's own check refuses that mismatch first.
Neither concurrency token moves on DDL. The adapter is handed a value and a
normalised type, nothing it could compare a column with. Drift also blocks
on the root's keys and foreign keys -- a dropped identity key stops update,
and on PostgreSQL an update whose identity matches two rows commits before
it is refused.

## Decision

Every read, create and update, and opening a form, is decided over a
description of the form's root read from the catalog in that request: its
kind, its columns, keys and foreign keys normalised as discovery normalises
them -- by discovery's own conditions and row functions on each engine --
and a definition the adapter makes from the catalog facts it parsed. The
read statement carries the description beside the record, and so does the
read an update already makes (0040); creating, opening a form and updating
without that read describe the table in one statement. data-core decides
with drift's own rules -- `diffRootDefinition` runs the root-kind, column and
root-relationship families `diffSnapshots` runs first (`ROOT_DEFINITION`),
ending in the same `finish` -- and refuses with 409 `drift` what that report
stops: a write `writable` stops, a read when `readable` is false. Per
operation, as 0010 decides. A record read is decided after its statement
and its values never leave the server when refused; a read the database
refused because a column it names is gone is decided over a description
asked once more. The policy is asked before any statement. Every insert and
update carries the definition and runs only while the table still has it:
on PostgreSQL inside the statement, with the connection's isolation
required to be READ COMMITTED there, one more statement telling a moved
definition from a refusal after zero rows or a failure, and, for a
definition read under another isolation, in a transaction that locks the
table first; on SQL Server after the statement, under its locks, and in
CATCH, as 51706. A moved definition is `schema-changed`, and the record was
not written. The drift report says beside review's verdict what the
runtime will refuse, and the studio says which blocked operations the
server still allows. `GET /v1/forms/:id` lists only what the runtime
allows, and answers 409 `drift` when nothing is left or the form cannot be
read. Lookups are not refused. The description is read inside the sending
for a write (0031), with create's plan and membership checks.

Review changes in one place, found by the property this record adds: a
confirmed concurrency token behind a new gap on the root's columns now
breaks reads, as the same token dropped does. Before, the gap's branch said
readable, and a runtime that described the root without the gap saw the
token gone and refused reads review allowed.

## Consequences

**What it buys.** On both engines, a write the published form can no longer
make safely is refused before an insert or an update is sent, a record it
can no longer show faithfully is not shown, and a change landing between
the decision and the statement leaves the record unwritten. The decision is
drift review's, by construction and by a test: what the runtime refuses is
what review's root families stop, and a widening drift calls information
keeps the form saving.

**What it costs.**
- Round trips, counted on 2026-10-10 by a TCP hop between the real server
  and fresh fixture databases, a turn being the client speaking again after
  it last heard the server, as 0034 counts them, on main at `012850a` and on
  this record's branch, over a table with a lookup and a unique column,
  each figure the same over five requests after a first. Main's are the
  same on both engines and under both isolations. "Another isolation" is
  the PostgreSQL account's `default_transaction_isolation` set to
  REPEATABLE READ:

  | Request | Before | After: PostgreSQL under READ COMMITTED, and SQL Server | After: PostgreSQL under another isolation |
  |---|---|---|---|
  | open a form | 0 | 2 | 2 |
  | read | 2 | 2 | 7 |
  | create | 4 | 6 | 9 |
  | update by an actor who may read | 4 | 4 | 12 |
  | update by an actor who may not read | 2 | 4 | 7 |
  | update with a stale version | 6 | 6 | 14 |
  | create the database refuses (a duplicate) | 4 | 8 on PostgreSQL, 6 on SQL Server | 11 |
  | create refused as drift | -- | 2 | 2 |
  | update refused as drift | -- | 2 | 7 |

- Time, measured on 2026-10-10 by a script outside the suites, so nothing
  holds it: fresh `postgres:17-alpine` (17.11) and
  `mcr.microsoft.com/mssql/server:2022-latest` (CU27) containers on one
  shared machine (an i9-10900K, 20 threads, load average between 2 and 7
  while it ran), the order form's root as the fixture's owner, 400 calls of
  each after 50, three runs on PostgreSQL and two on SQL Server (one for its
  describe), given as the range of their medians. On PostgreSQL the catalog
  walk is planned and run inside every describe, read and write: a describe
  or a read takes 4.3 to 6.2 ms of the server's planning and execution
  (EXPLAIN ANALYZE) where
  main's read took 0.14 to 0.17 ms, and a write 3.3 to 5 ms where it took
  0.14 to 0.25 ms; per call at the client, on loopback, a describe or a
  read is 7.4 to 11 ms where main's read was 1.4 to 2.4 ms, and a write 6.8
  to 12.5 ms where it was 1.7 to 2.5 ms. More than half of the server's
  time is planning, which 0016's unnamed statements do again for every
  statement. On SQL Server a describe takes 1.4 ms of CPU
  (sys.dm_exec_query_stats), a read 1.7 to 2.2 ms where main's took 0.1
  ms, and a write 2.1 to 2.6 ms where it took 0.66 to 0.77 ms; per call at
  the client a read is 5.4 to 9.6 ms where it was 3 to 3.3 ms, and a write
  8.6 to 11.4 ms where it was 6.2 to 7.1 ms. 0034's figures are stale until
  its harness measures them.
- Opening a form now asks the database: an unreachable one is 503 where the
  form used to open.
- A change to the root that lands between the description and the
  statement refuses that request with `schema-changed` even when drift
  review would call it harmless; sent again, it is answered.
- Per operation, as 0010: a tightened field stops every update of the form,
  including one that does not touch it, until it is republished.
- On PostgreSQL an insert is `INSERT … SELECT … WHERE`, and a write that
  changed nothing or failed costs one statement more. That statement runs
  on any connection of the pool, never on the write's own: postgres.js
  3.4.9's reserved connection, measured, never answers once its backend is
  gone and then throws outside any promise, ending the process. The digest
  depends on no session, so any connection answers it as the write's would;
  the isolation it reports is its own, so in a pool whose connections
  differ in isolation a write that wrote nothing can be answered with
  another cause than the one that refused it. Nothing is written either
  way.
- The lock-first transaction runs in postgres.js's `sql.begin`, and every
  step of it is kept from settling once its connection is lost: measured,
  postgres.js 3.4.9 rejects `begin` when the connection closes and then
  writes the transaction's ROLLBACK or COMMIT to the closed connection, a
  TypeError outside any promise that ends the process, and the pool's next
  query never answers. Kept from settling, it sends neither, and `begin`'s
  rejection is the answer. Each step a lost connection stops waits on a
  promise of its own that never settles and that nothing holds, so the
  abandoned transaction, with the values a person wrote, is collected with
  it (measured: one such promise shared by every lost step kept 64 MB after
  four lost writes of 16 MB each).
- On PostgreSQL under a default isolation other than READ COMMITTED, every
  read and write takes the table's lock first in a transaction of its own
  -- a describe, which has no guard, does not -- so a write statement is
  five round trips where it is two, and a read, whose first answer is set
  aside and asked again after the lock, seven, which the table above adds
  up for each request; and an account granted columns of the table and nothing
  on the table cannot take that lock and is refused `permission-denied`
  (measured: the fixture's writer, which holds columns of `sales.customer`,
  is refused a read of it; it and the reader, which hold the table
  `sales.order`, are not). So the default isolation now changes an answer,
  which 0016 promised it would not. A connection whose isolation differs
  from the one a request was described on writes nothing and is answered
  `unavailable`.
- On PostgreSQL a refused write still fires the table's statement-level
  triggers, and what they did is kept; SQL Server rolls it back.
- On SQL Server, a failed write reads the catalog once more, after its
  rollback, unless a trigger ended its transaction, which is answered as
  ended before the catalog is asked. An account the catalog hides the table
  from -- denied VIEW DEFINITION -- cannot be described, so a form running
  as it is refused `schema-changed`, reads included; a write decided over
  another account's description finds the table's facts NULL and is
  refused as a moved definition. 0017's INSTEAD OF check refused such a
  write by `object_id` being NULL; the definition's check refuses it first,
  that branch could no longer be reached, and it is gone. A connection
  whose TEXTSIZE is shorter than the description is refused
  `unavailable`.
- Review is stricter in one place: a form whose confirmed token is out of
  sight behind a gap is no longer readable.

**What it does not do.** Only the root's kind, columns, keys and foreign keys
are compared at runtime. A lookup's target, privileges, row security and the
account are drift review's alone; the database still enforces privileges and
row security itself, and the studio says which blocked operations the server
still allows. Lookups answer whatever drift says. A collation change that
keeps the length unit is as invisible here as it is to drift (0026). A
column dropped and added again under the same name and definition -- a
version column included, which then starts again at its default -- or the
table dropped and created again so, is seen neither by drift review nor by
the runtime; a write in flight across it is refused, and the next is not.
SQL Server's dynamic data masking is compared by nothing -- discovery,
review, the definition and the runtime alike: a column given a mask after
the form was published reads as its mask to an account without UNMASK, and
a save that sends every field, as a renderer does (0022), writes the mask
over the stored value (held by a case of `DRIFTING`: the definition does not
move, and that account's write of what it read stores the mask). The guard
holds against DDL whose lock conflicts with the write's own, which is every
change a description reads that the tests make. By
PostgreSQL's documented lock levels, and not tested, some changes a
description reads take no lock that conflicts with a write to the root, and
can commit while one runs: `VALIDATE CONSTRAINT`, `CREATE INDEX
CONCURRENTLY` and `DROP INDEX CONCURRENTLY` -- the last even of the unique
index an identity rests on -- and DDL on a lookup's target that moves the
root's foreign-key facts, a rename of the target or its triggers disabled,
which locks the target alone. None of them changes what a write in flight
stores, and the next request's description reads it. SQL Server's SNAPSHOT
isolation is not tested. On PostgreSQL the runtime spells a type as
discovery does, under its connection's `search_path`: a pool whose
connections differ in it can see a changed type review did not, and refuses
with `drift`. The person is told that an administrator must review the
form, never which column changed; the log names the kinds.

**What it forecloses.** A record write without the definition it was decided
over, and serving a form whose database cannot be asked.

## Alternatives considered

**Describe before every request.** Two more round trips on read and update,
for a description their own read carries.

**Compare inside the statement only.** Equality with the published snapshot
refuses every widening 0010 calls information -- the e2e step that widens a
bound column would stop the served version's writes, which the e2e suite
shows -- and restates the snapshot in each engine's catalog terms; direction
rules in SQL restate `compareTypes` and the typmod decoding twice, and cannot
express `controlFor`. Either is a second implementation of the decision.

**Describe before the statement, without the definition.** A change
committing in between writes under the old verdict.

**A verdict cached for an interval, or refreshed on a schedule.** Fails open
for the interval; the silent cases never produce a refusal that clears it.

**Translate the database's refusal.** The silent cases raise none.

**Full discovery and `diffSnapshots` per request.** The whole scope on every
request, and still a window.

**Cache the description by its definition, dropping the entry when a guard
refuses.** Exact, and nothing is sent again; the first request after any
change, harmless or not, is refused once per process. It would save the
describe of opening a form, creating and a non-reader's update -- measured
above, 4.3 to 6.2 ms of PostgreSQL's time and 7.6 to 10.5 ms per call, 1.4
ms of SQL Server's CPU -- and nothing of a read or a write, which carry the
facts in their own statement. Not done: a cache shared by every request of
a process, refused once after every change, to save one statement of three
kinds of request, whose writes still walk the catalog in their own
statement.

**Compute PostgreSQL's digest in Node, from the facts the statement
returns.** It too would have read the facts once; it is a second
implementation of the digest in a second language, which agrees with the
writes' only while the client's encoding is UTF-8. Keeping the planner from
pulling the facts' derived table up (`offset 0`) reads them once in SQL.

**Prepare PostgreSQL's record statements.** The walk would be planned once
per connection instead of in every statement. It would change what 0016's
unnamed statements are, and what PostgreSQL folds while planning, which the
follow-up after a failed write is tested against: a decision of its own,
not taken here.

**Remember, per adapter, the isolation the last statement reported, and
lock first when it was not READ COMMITTED.** Two round trips fewer for a
read under another isolation, 7 to 5, and exact either way, since the locked
statement reports its own isolation too. Not done: state carried between
requests in an adapter that has none, for a setting no deployment of the
fixture has and no harness counts.

**Compare the account at runtime.** The account moves only by an
operator's edit of the connection; the database applies row security for
the account it runs as; and review's rule reads every lookup target's row
security, which the runtime does not describe. A partial copy would be a
second rule; the report's `runtime` says the difference instead.

**Weaken the property to fit the gap branch.** The one fixture on which the
runtime was stricter than review was a confirmed token behind a gap, where
review said readable and every read names the token. The rule was wrong in
review, not in the property.

**PostgreSQL's follow-up on the write's own reserved connection.** It is
what would tell the write's isolation exactly; measured, a reserved
connection whose backend is gone turns a lost answer into a crashed process
and a dead connection back in the pool.

**PostgreSQL's diagnostics in the write statement, as a data-modifying
CTE.** One statement, the write's own connection; but by PostgreSQL's
documentation a table with a DO ALSO or a conditional rule refuses every
write inside one, and the version check, read from the statement's
snapshot, would call a write that lost a race to a concurrent update
declined rather than stale, because the update rechecks the newer row and
the snapshot does not see it. Not measured.

**Digest PostgreSQL's spellings.** A default's constants follow DateStyle,
TimeZone, IntervalStyle and `extra_float_digits`, a type's name
`search_path`: a guard over them would depend on settings 0016 promises
change no answer, which the settings test shows they do.

**Refuse PostgreSQL record statements under any isolation but READ
COMMITTED.** Every write of such a deployment refused, where 0016's suites
show them working.

**Run them in an explicit READ COMMITTED transaction instead of locking
first.** Needs no table-level privilege; overrides a SERIALIZABLE default
for the forms' writes, which then take no part in its conflict detection,
without anything showing it.

**Ask a read again only when it found no row.** Cheaper under another
isolation, and correct only for the ALTERs PostgreSQL rewrites, which it
decides per release.

**Lock the table first under every isolation.** Exact everywhere; three
more round trips on every write where READ COMMITTED needs none.

**SQL Server's `NUMERIC_ROUNDABORT ON` in the write batch.** Probed
2026-10-10 with the reproduction: a narrowing became 8115, a decimal into a
`real` was still stored; it would refuse every write to a table with an
indexed view or a computed-column index, and does nothing for writes the
form should not make.

**Bind with the published typmod.** The assignment into the narrower column
still rounds.

**Refuse per field.** Renderers submit every field (0022), and it would be a
second rule beside `writable`.

**A new refusal code.** `drift` already says an administrator must review
the form; `schema-changed` stays the database's own refusal of a statement.

## Older records

Narrowed, not edited away: 0010 (the report says `readable` and `runtime`;
the root's definition is compared at request time; a confirmed token out of
sight breaks reads, and is one change that speaks for the gap), 0015 (a read
carries the description and a write the definition it was decided over),
0016 (the guarded shapes, the isolation requirement, the follow-up on any
connection and the lock-first path, and what they cost its promise that no
setting changes an answer; its rejected per-statement catalog lookup still
holds for binding), 0017 (51706, which refuses an account that cannot see
the table before the INSTEAD OF check, whose own branch for it is gone;
"querying the catalog for column types on every write" still holds for
binding -- the catalog is asked whether the table moved, never what to bind
as), 0018 (the write planners take the description; a read is decided after
its statement), 0030 (its "Not done here" on runtime drift, for the root's
definition), 0040 (a create's plan and membership checks run inside its
sending, so its resend gets the first sending's answer). Extended: 0019
(checked against the database too, at every record request and when a form
is opened), 0022 (drift asked on every record request and when a form is
opened, which asks the database), 0031 (the description is inside the
sending, with create's plan), 0040 (the echo read carries the description
the update is decided over).
