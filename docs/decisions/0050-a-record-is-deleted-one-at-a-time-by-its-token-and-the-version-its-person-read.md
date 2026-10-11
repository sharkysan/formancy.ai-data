# 0050 — A record is deleted one at a time, by its token and the version its person read, under the form's policy, in one guarded statement

- **Status:** accepted
- **Date:** 2026-10-11
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/policy/validate.test.ts` and `evaluate.test.ts`
  — `operations.delete` absent grants nobody and an empty one fits any
  form; a grant on a form whose bindings do not offer delete, a grant to a
  role that may not read, and a grant on a form whose rows nothing scopes
  while a lookup is filtered are each refused; a delete is scoped by the
  row filter and every through as an update is, and a lookup is never
  searched for one; `archive` is now the property this release does not
  read (watched failing with every delete grant accepted, and with an
  absent list read as the roles that read).
  `generate/generate.test.ts` — the order offers delete on both engines,
  though order_line cascades from it; a line offers it on SQL Server and
  not on PostgreSQL, whose note gives the version rule, and a `serial` key
  counts as numbered; a key a default fills (0056) does not, so a delivery
  offers it on SQL Server, by its rowversion, and not on PostgreSQL; the
  reader, a snapshot taken before 0049, a table without a key or a
  confirmed token and a view offer none, each with its note (watched
  failing with delete offered only where update is and nothing refers to
  the table, with the version rule removed, and with a filled key counted
  as numbered).
  `policy/cascades.test.ts` — a grant is refused while a key from another
  table cascades, sets NULL or sets a default on delete, enabled or not,
  over a snapshot that does not record what refers to the root, and behind
  a `referenced-by` gap on it; a NO ACTION or RESTRICT key is the
  database's, and `restricted` says so (watched failing with every grant
  accepted). `records/plan-delete.test.ts` — the exact request, the
  through of a line, the policy before the form, bindings that offer what
  their snapshot refuses, a key no token carries, an unscoped child, a
  cascade, drift, a stray token and a stray version, each refused with
  its own code (watched failing with the filters dropped, the throughs
  dropped and `versionFits` removed). `records/delete-terms.test.ts` — a
  key that is not the identity, a missing version, filter or through, and
  a reach that does not begin with the root or goes past it are thrown
  before a statement (watched failing with any key accepted and with a
  reach past the root accepted). `records/drift.test.ts` and
  `drift/delete.test.ts`, `drift/referrers.test.ts`, `drift/diff.test.ts`
  — a key, a token, an identity column retyped, a view and whatever stops
  reading stop delete, a narrowed written column does not; DELETE revoked,
  a numbered key column numbered no more on a version-column form, a new or
  changed key that acts on delete, a `referenced-by` gap and a current
  snapshot without the facts its base had stop it; a change that stops
  only delete is blocking where the policy grants delete and for review
  where it does not; against a base taken before 0049 the facts recorded
  since report nothing; a key gone is a note and one out of sight the
  gap's (watched failing with delete stopped by no change, by every change,
  with the facts compared against a base without them, with changed keys
  not compared, with a hidden key reported gone, and with disabled keys
  not counted). `drift/fixture.ts` holds every report the drift suites make
  to three properties: the runtime never refuses what review allows,
  delete included; review and the runtime agree on a change to the root's
  definition alone; and against a base taken before 0049 the new facts
  change nothing. `records/menu.test.ts` — delete is listed only where the
  bindings offer it (watched failing with `!== false` kept).
  Both adapters' `delete.integration.test.ts`, against
  `postgres:17-alpine` (17.11) and
  `mcr.microsoft.com/mssql/server:2022-latest` (16.0.4295.3) loaded with
  the shared fixture's parity schema, every case declared with `covers()`
  under `deleteCase` and `UPDATE_RECREATED_CASE` — deleted, stale,
  not-found, other-tenant, through, moved-parent, recreated, referenced,
  restrict, self-reference, declined, trigger-refuses, restoring,
  after-trigger-elsewhere, permission, row-security, definition-moved,
  reach-moved, visibility-narrowed, not-a-key and `update: recreated`, and
  on PostgreSQL a DO ALSO rule, a DO INSTEAD rule that returns a row, a
  cascading key onto a partition of the table, added before the delete
  and while it waits under READ COMMITTED and REPEATABLE READ, and a
  delete that lost a race under REPEATABLE READ, stale, and on SQL
  Server a cascading edge constraint added onto a node table and a VIEW
  DEFINITION deny on the table a cascading key is on, or on its schema
  (watched failing with the version left out of the WHERE, the filters
  left out, the follow-up's existence and its version left out, 23503
  unmapped, the reach guard removed, the visibility conditions removed,
  SQL Server's SAME TABLE spelling lost, the CTE's scalar subquery and
  `@rows > 1` removed, SQL Server's guard reading foreign keys alone: the
  node and its edge were deleted; PostgreSQL's statement without its rule
  guard: the rule's update was answered as the deletion; PostgreSQL's
  locked path locking the table alone: under REPEATABLE READ the delete was
  answered done and the cascade deleted the copy; PostgreSQL's 40001 in a
  delete left to the error's class: unavailable; and SQL Server's two deny
  conditions removed: each delete cascaded). Both
  `records-definition.integration.test.ts` — a delete decided over the old
  definition is schema-changed and leaves the row, and so is one waiting
  for an ALTER's lock (watched failing with the definition guard removed
  from the delete). Both `records-lost-answer.integration.test.ts` — a
  delete whose answer is lost is unknown-outcome, its marker crossed once,
  the row gone (watched failing with the cut answered as unavailable).
  `packages/data-server/src/routes/runtime-deletes.test.ts` — 401, 403
  with no statement, the planned request, every answer in a delete's
  words with no field error, the key of a `referenced` refusal in the log
  and no value (watched failing with nothing logged), drift, the 502, a
  write id answered once and refused with another body, the trail's
  `delete` and `repeated`, a lookup asked for delete, `GET`'s `delete` and `deleting`, a form published
  before this record, and the bundle refused over a cascade and to a role
  that may not read (watched failing with the update's sentences and
  without `sendOnce`). `e2e.integration.test.ts` — on both engines a clerk
  deletes her record, another tenant is told 404, a stale delete is 409
  and a second one 404; on SQL Server a line is deleted through its order
  (watched failing with the route planning without the row filter).
  `e2e-lost-answer.integration.test.ts` — a lost delete is 502 with its
  record and version, sent once, the row gone, a resend 404, and the trail
  names both (watched failing with the route asking the adapter again).
  `routes/runtime-drift.integration.test.ts` — for every drifting case, a
  delete is answered exactly when the runtime allows one (watched failing
  with delete left undecided). `packages/data-client/src/transport.test.ts`,
  `reconcile.test.ts`, `deletes.integration.test.ts` and
  `lost-answer.integration.test.ts` — a deletion is done only on the
  server's `{ record, deleted: true }`, any other 2xx is unknown, a 502 an
  unknown deletion, a 404 a refusal; `deleting` is the server's exactly
  when `operations` holds delete, and a form reply from a server older
  than this record, which has none, is unexpected; reconciling a deletion
  is absent on 404, unchanged at the version sent and changed at another;
  a lost deletion is sent once (watched failing with `writeOutcome` requiring a `FormRecord`,
  with `deleting` unchecked, and with a deletion's 404 left to the read).
  Both `uuid.integration.test.ts`, under `uuidCase('generated')` and
  `uuidCase('delete')`, over what the order form's own account discovers
  of the shared fixture -- the delivery form offers delete on SQL Server
  and not on PostgreSQL; a grant of delete is refused on the delivery form
  for the parcels its key cascades to, and on PostgreSQL as not offered,
  and on the order form for its deliveries and its lines, and without the
  grant neither is refused anything; a parcel, which has no version
  column, offers neither update nor delete (watched failing with the operations
  one answer for both engines, and with a cascading key accepted).
  `apps/host/src/operations.test.ts` — the workspace's tags of what a
  person may do leave delete out before the page has a control for it
  (watched failing with the operations tagged as they came), and
  `plane.test.tsx` holds the journey to every runtime route but delete's,
  which the page must not send until 0053.
  `scripts/install-fixture/consume.ts` — `delete()`
  and `DeleteOutcome` through the published entry points. **Not
  mechanically enforced:** a unique index dropped `CONCURRENTLY` during a
  delete (0041's edge, now with nothing deleted), a sequence restarted or
  cycling, and on PostgreSQL, while the delete waits, a key added onto a
  table that inherits from the root rather than onto a partition of it,
  and a partition attached.

## Context

The person asked for delete after the workspace ("Delete dann
anschliessend"). Nothing in the module could delete, on purpose: the
policy's `OPERATIONS` were read, create and update, and `operations.delete`
was the example of a property this release refuses (0011). Five facts
decided what deleting has to be:

- **`GET /v1/forms/:id` offered an operation whose flag was not `false`.**
  Every form published before this record has no `delete` flag, and the
  menu (0045) copied the test. Read that way, every old form would offer
  delete the moment a policy granted it.
- **A PostgreSQL version column starts at its default on every insert.**
  The fixture's `row_version bigint not null default 1` is left out of an
  insert, and an update adds one. Under delete, the module could reuse a
  key itself: a line `(1003, 2)` deleted at version 1 and created again is
  at version 1 too, and a stale update, a stale delete or a delete sent
  again after a lost answer would land on the second line. SQL Server's
  rowversion never repeats in a database.
- **A delete reaches every table whose key acts on delete.** The fixture's
  `fk_order_line_order` and `fk_delivery_order` cascade from an order, and
  `fk_parcel_delivery` on from a delivery to its parcels (0056). Rows a
  cascade deletes are asked of no
  form's policy. 0049 records, on every table, whether its account may
  delete and every key that refers to it, or a `referenced-by` gap.
- **A PostgreSQL statement locks only the tables it names before its
  snapshot**, and SQL Server lists a key only to an account that may see
  the table it is on (0049, P2).
- **The update path's answers were written for saves**: "Nothing was
  saved", a foreign-key error placed on a field by its column -- which, for
  a delete, is another table's.

Measured on 2026-10-11 against `postgres:17-alpine` (17.11) and
`mcr.microsoft.com/mssql/server:2022-latest` (16.0.4295.3, RTM-CU27), in
scratch containers started for the probes on a Linux host with 20 CPUs and
16 GB under Docker 29.8.1, each removed afterwards; and held since by the
suites named above.

| Probe | What the server answered |
|---|---|
| P3, PostgreSQL | A delete of a row a NO ACTION key's row refers to is 23503, and so is one under ON DELETE RESTRICT -- not 23001; a DEFERRABLE INITIALLY DEFERRED key refuses at the end of an autocommitted statement, 23503. `with "d" as (delete ... returning ...) select "d".*, (select true from "d") from "d"` over two matching rows fails 21000, "more than one row returned by a subquery used as an expression", and both rows are still there; over one it deletes and returns it; over none it returns nothing. |
| P3, SQL Server | 547, "The DELETE statement conflicted with the REFERENCE constraint", and "... with the SAME TABLE REFERENCE constraint" for a key onto its own table; in German "Die DELETE-Anweisung steht in Konflikt mit der REFERENCE-Einschränkung", which keeps the keyword the adapter reads. |
| P4, PostgreSQL | A BEFORE DELETE trigger returning NULL: no row returned, the row there at the version sent. An AFTER DELETE trigger that inserts the row again, or writes another table: the row returned, and what the trigger did is there. A DO ALSO rule: the CTE is refused, 0A000 "DO ALSO rules are not supported for data-modifying statements in WITH" -- a plain `delete ... returning` runs the rule; a DO INSTEAD NOTHING rule, conditional or not: 0A000 "cannot perform DELETE RETURNING". A row security policy for DELETE stricter than the one for SELECT: no row returned, the row read at the version sent. A DO INSTEAD rule without RETURNING, or with several actions: 0A000 "cannot perform DELETE RETURNING"; a conditional rule cannot have RETURNING. An unconditional DO INSTEAD rule with RETURNING runs inside the CTE: a soft delete's update, and an insert that names no column of the row, each returned a row and the row was still there; a condition in the delete's WHERE is added to the rule's action, which then changes nothing. |
| P4, SQL Server | An INSTEAD OF DELETE trigger that does nothing: `@@ROWCOUNT` 1, OUTPUT wrote the row, and the row is still there. An AFTER DELETE trigger that inserts the row again under IDENTITY_INSERT and writes a log: OUTPUT INTO captured the row, and both are there. |
| P8 | PostgreSQL's pg_constraint has no index on `confrelid` (its indexes: oid; conname, connamespace; conparentid; conrelid, contypid, conname; contypid): the guard's lookup is a sequential scan, of 124 rows in that database. The rule guard is one InitPlan per statement: an index scan of pg_class by name and of pg_rewrite by the table's oid, with the names as literals. SQL Server's sys.foreign_keys by `referenced_object_id` is an index seek on sys.syssingleobjrefs; the read of sys.edge_constraints is not measured. |
| Locks, PostgreSQL | `ALTER TABLE ... ADD FOREIGN KEY ... REFERENCES` a partition locks the partition, not the partitioned table. Under REPEATABLE READ a statement takes its snapshot before it locks the partitions it plans: with `lock table only` on the root first, a delete that waited for an ALTER onto its partition read pg_constraint from before the key, and the key's cascade deleted the referring row. `lock table` without `only` takes ROW EXCLUSIVE on every partition and inheritance child, and an account granted DELETE on a partitioned table, or on an inheritance parent, and nothing below them, takes it. |

## Decision

**A record is deleted one at a time, by its token and the version its
person read, under the form's policy, in one guarded statement on each
engine, and reaches nothing past itself through a foreign key.**

- **The policy.** `operations.delete` is optional under `version: 1`;
  absent is nobody. A delete is scoped by the root's row filters and every
  through, as an update is, and grants no field. `validatePolicy` refuses a
  grant on a form that does not offer delete, a grant to a role that may
  not read -- a delete names the version its person read, and a role that
  cannot read has only a guess -- and a grant on a form whose rows nothing
  scopes while a lookup's options are filtered (`unscopedLookups`), which a
  child form published before 0043 is.
- **What a form offers.** The generator writes `operations.delete` on
  every form. It offers delete on a table with an identity and a confirmed
  token, whose snapshot says its account may DELETE, where the version
  proves the record for good: a rowversion, or a version column on a table
  whose identity includes a column the database numbers, which no form
  writes (0026). A key a default fills is not one: no form writes it
  either (0056), but a default may hand out one value twice -- a constant
  does -- and this record does not decide which defaults never repeat. It
  never reads what refers to the table. Each refusal is
  a note; the key and token notes say "Update and delete are not offered".
  One function, `offers()`, decides "offered" for every reader, and reads
  an absent flag as `false`: the planners, the policy's fit, drift, `GET`
  and the menu.
- **What a delete may also do: nothing, in this record.**
  `deleteProblems` (`policy/cascades.ts`) refuses a grant while a key
  that refers to the root cascades, sets NULL or sets a default, enabled
  or not, while the snapshot does not record what refers to the root, or
  says by a `referenced-by` gap that it cannot see all of it. It is asked
  by the bundle's check on publish and every read, by the planner, and by
  drift through `unaccepted`. A NO ACTION or RESTRICT key is the
  database's: the delete is refused while a row refers to the record.
- **The planner** (`planDelete`): the bindings against their snapshot;
  the filters and throughs, which authorise the delete and fit the policy;
  that the form offers delete with a confirmed token, as its own snapshot
  says it can; a key a token can carry; `deleteProblems`; the root as the
  request described it (0041), by drift's own root families; the token;
  the version. The request carries the key, the version, the filters, the
  throughs, the reach -- the root alone -- and the definition, and
  `deleteTerms` throws on anything else before a statement is built.
- **PostgreSQL.** One statement on 0041's two paths: a CTE that deletes
  the row located by the key, the filters and every through, at the
  version sent, while the definition holds, no declared key that acts on
  delete refers to the table or a relation below it, and no rule acts on a
  delete from the table, returning the key as canonical text and the
  version; selected with a scalar subquery over its own rows, so a second
  row fails the statement and deletes nothing. The locked path locks the
  table with every relation below it before the statement, which under
  another isolation than READ COMMITTED takes its snapshot before it locks
  the partitions it plans. After no row, one more statement tells a moved
  definition, a moved reach, a rule, another isolation, not found, stale
  and declined apart. 21000 in a delete is thrown: an identity that is not
  a key.
- **SQL Server.** The write batch every write runs in: `delete ...
  output deleted.... into @written`, then the transaction check, the
  definition guard, an INSTEAD OF DELETE guard, the reach guard -- which
  refuses (51707) an account that no longer holds VIEW DEFINITION on the
  database or is bound by a VIEW DEFINITION or CONTROL deny, by discovery's
  own conditions, and any key or edge constraint that acts on a delete of
  the table, disabled or not -- and `@rows > 1`; a refusal rolls back
  whatever a cascade did.
- **The route.** `POST /v1/forms/:id/records/delete` with `{ record,
  version }` and a write id, audited as `delete` by the record's keyed
  hash. 200 `{ record, deleted: true }`, the token of the row deleted;
  404 not found, outside the filters or the throughs; 409 stale, drift
  (in a delete's own words) or schema-changed; 422 `referenced` while
  another row refers to it -- naming nothing, where the log names the key
  -- or `refused`; 403; 503
  "Nothing was deleted."; 502 `unknown-outcome` with `operation: 'delete'`,
  the record and the version. `GET /v1/forms/:id` lists `delete` where the
  bindings offer it, the policy grants it and the database as it is now
  allows it, with `deleting: { cascades, clears, restricted }`, `null`
  otherwise.
- **The client.** `delete(formId, { record, version })` with a write id of
  its own; done only on `{ record, deleted: true }`; a lost answer is an
  unknown deletion, and `reconcile` reads the record: absent on 404,
  unchanged at the version sent, changed at another. The host page's
  workspace (0047) leaves `delete` out of the open form's tags of what a
  person may do, and sends no delete, until it has a control (0053).
- **Drift.** A delete is stopped by what stops reading, by a change to
  the key, the token or an identity column, by the root becoming a view,
  and by what the generator would no longer offer it over: DELETE revoked,
  a key column the database numbers no more on a version-column form, a
  new or changed key that acts on delete (`referrer-added`,
  `referrer-changed`), a `referenced-by` gap on the root, or a current
  snapshot without the facts its base had -- these last compared only
  between two snapshots that both record them. A change that stops delete
  is blocking only where the policy lets somebody delete. The runtime
  decides over the root's description, which holds no key onto it; the
  statement's guard does.

## Consequences

**What it buys.** A person deletes exactly the record they saw, scoped as
their reads are, on both engines, and a deletion whose answer was lost is
safe to send again with the same version: it deletes nothing else. What a
delete also does to other tables is decided in one place, before
publication, and refused at runtime where the database has changed since.

**What it costs.**

- No undo. The audit trail keeps a keyed hash of the token, or nothing
  without an audit key, and a crash between the commit and the event loses
  even that (0023).
- A form offers delete only once regenerated and republished from a
  snapshot this release took; every form before it offers none.
- A role that may delete must be granted read.
- **No delete on a version-column table whose key people type, or whose
  key a default fills:** the fixture's order lines and its deliveries on
  PostgreSQL -- a delivery's uuid comes from `gen_random_uuid()`, which in
  practice never repeats, but the rule tells no default from another -- and
  a SQL Server table with a version column and such a key alike. A rowversion proves a record whatever its key: SQL Server's
  deliveries offer delete.
- **A form whose root another table's key cascades onto, clears or sets a
  default in may not grant delete** -- the fixture's orders, whose lines
  and deliveries cascade from them, and its deliveries, whose parcels do --
  until a policy can name such a key (0051).
- Each delete reads the catalog for what refers to the table: on
  PostgreSQL a sequential scan of pg_constraint, a walk of pg_inherits and
  an index read of pg_rewrite, in every statement, growing with the
  database's constraints and not measured past the fixture's; on SQL
  Server an index seek on the foreign keys, a read of the edge constraints
  whose plan is not measured, and the account's view of the catalog.
- On PostgreSQL under another isolation than READ COMMITTED, a delete
  locks every partition and inheritance child of its table, ROW
  EXCLUSIVE, before its statement, where a write before this record locks
  the table alone.
- **What the database runs on a delete is its own.** A trigger that
  writes elsewhere runs unseen; one that inserts the row again is reported
  deleted. On PostgreSQL a table a rule acts on a delete of refuses every
  delete, `refused`, a soft delete written as a rule included: PostgreSQL
  refuses the CTE under most rules itself (0A000), and the statement's own
  guard refuses the one it would run, an unconditional DO INSTEAD rule
  that returns a row. Only an INSTEAD OF trigger on SQL Server, a rule on
  PostgreSQL and a delete PostgreSQL declined -- by a trigger, or by a row
  security policy for DELETE stricter than the one for SELECT -- are
  refused for what they are.
- A row the account may read but not delete under row security is
  `refused` on PostgreSQL and `permission-denied` on SQL Server, 0016's
  existing difference.
- `referenced` tells a person that something refers to the record, which
  any refusal of that delete would.
- On PostgreSQL a version column moves only through this module's writes:
  another application's delete and insert of the same typed key restarts
  it, which `update: recreated` characterises.
- On PostgreSQL a delete that waited for its row lands after its parent
  left the tenant, where SQL Server answers not found (0043's `moved-parent`).
- `RecordAdapter` gains a method, the audit trail an operation, drift two
  kinds and a third member of every verdict's `writable`, `PublishedForm`
  a field, and the client's `UnknownWrite` an operation.
- A server older than this record refuses a policy that grants delete,
  and this release's client answers `unexpected` to a form reply from a
  server older than this record, which carries no `deleting`, as 0044's
  client does to one without `list`: a host upgrades its server first.

**What it does not do.** A delete never reaches past its record through a
foreign key the policy did not name, and in this record the policy can name
none. No bulk delete, no soft delete, no trash. The host page offers no
delete yet (0053), and the studio no delete roles (0052). A parcel, which
has no version column, offers neither update nor delete. Triggers and rules
are not listed, accepted or refused beyond what is said above.

**Forecloses:** a delete without a version, a bulk delete, and a delete
answered without its key.

## Alternatives considered

**HTTP DELETE.** Lost: a token in the URL lands in every proxy log (0044),
RFC 9110 gives a DELETE body no meaning, and every runtime write is a POST.

**No version.** Lost: a delete would destroy edits its person never saw, and
a form with no token could not fail closed.

**Offer delete on every version-column table.** Lost: a key reused after a
delete makes one version name two records, and a stale delete or a resend
lands on the wrong one.

**Count a key a default fills as numbered** (0056), which would let
PostgreSQL's deliveries offer delete. Lost for now: a default may hand out
one value twice -- a constant does, and 0056 says such a key fills one
record -- and the snapshot holds a default only as the expression the
engine spells. Naming the defaults that never repeat, `gen_random_uuid()`
and `newsequentialid()` among them, is a rule of its own.

**Versions that never repeat first** -- a PostgreSQL write taking its
transaction's id. Lost for now (the person's decision 2): it changes every
write's version, overflows `int` version columns, leaves SQL Server version
columns as they are, and is not measured.

**Delete without read.** Lost: a delete-only role has no version but a guess.

**Return the deleted record's values.** Lost: a resend's kept answer would
hold them for ten minutes, for nothing a host needs.

**The update's foreign-key answer.** Lost: "refers to a record that does not
exist" never means a delete, and it puts the error on another table's column.

**Let a multi-row delete commit, as 0041 lets an update.** Lost: a delete
cannot be taken back, and refusing a second row costs one scalar subquery.

**A plain `delete ... returning` on PostgreSQL**, which a DO ALSO rule would
not refuse. Lost: it cannot refuse a second row inside the statement, and the
statement's own guard refuses every rule either way.

**Answer what a DO INSTEAD rule returns as the deletion**, which would let a
soft delete written as a rule through. Lost: what the rule's action returns
is not the row deleted -- a soft delete's row still there, or another
table's -- and the person would be told the record is gone.

**Lock the table alone first on PostgreSQL's locked path, as every other
write does.** Lost: under REPEATABLE READ a key added onto a partition while
the delete waited was not seen by the guard, and its cascade ran.

**Record triggers and rules, and accept them by name, as keys are.** Lost: a
trigger is code, whose effect the catalog does not say; refusing tables with
DELETE triggers would refuse the audit triggers a deployment that must prove
deletions keeps; inserts and updates have run triggers unseen since 0016.

**Decide delete in drift like a list, beside review's verdict.** Lost: one
more rule beside review's, where one decision serves both.

## Older records

Extended, not edited away: 0011 (a fourth operation, read required for it);
0015 (`RecordAdapter.delete`, one guarded statement, never retried); 0016 and
0017 (each engine's delete, and a version column proves a record only where
the database numbers its key); 0018 (`planDelete`); 0022 (asked on every
request; `GET` offers delete by `offers()`, no longer by `!== false`); 0023
(the audit operation `delete`); 0031 (a lost delete, its 502 and its
reconciliation); 0041 (a delete decided over the description, `writable`'s
`delete`, and the statement's own reach guard); 0043 (throughs scope a
delete); 0045 (the menu lists delete by `offers()`); 0047 (the workspace's
tags leave delete out, and its route test names the delete route as the
one the page does not send, until 0053). Narrowed: 0010 (drift
stops delete, and a change that stops only delete is blocking only where the
policy grants it; two kinds, `referrer-added` and `referrer-changed`); 0049
(a `referenced-by` gap between two snapshots that record the facts now stops
delete, where 0049 left it a note, and a current snapshot without the facts
its base had stops it too).
