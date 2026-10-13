# 0051 — A delete reaches other tables only through foreign keys the policy names, each with what it does

- **Status:** accepted; extended by [0052](0052-the-studio-says-before-publication-who-may-delete-and-what-a-delete-also-does.md): the studio writes `cascades`, a box per key a delete acts through, from `deleteReview`, the walk `deleteProblems` takes, which data-core now exports; extended by [0053](0053-a-host-deletes-a-record-from-its-detail-or-its-row-after-a-confirmation-in-place.md): the host page's confirmation says from `deleting` whether a delete also deletes or clears other records, never which or how many
- **Date:** 2026-10-12
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/policy/validate.test.ts` — `cascades` that is not
  a list of keys each named by its table, its name and an action that acts
  on delete, an entry with a property this release does not read, a key
  named twice, and `cascades` on a form nobody may delete with, are each
  refused (watched failing with the property unread).
  `policy/cascades.test.ts` — a grant is accepted once `cascades` names
  every key that acts on a delete with its action, and refused for any it
  does not; a cascade two levels down needs both keys named; an acceptance
  with another action than the key's, of a key the delete does not
  reach, or of a key onto a table the delete only clears, whose ON DELETE
  never runs, is refused -- the last watched failing with that table's keys
  matched as a removed table's are; a key that only refuses a delete, NO
  ACTION or RESTRICT, needs no naming -- watched failing with every grant
  over a RESTRICT key refused; a cascade or a SET NULL into a table outside the
  scope is refused named or not; a SET NULL whose columns another key
  follows ON UPDATE is refused; a table past the root the account may not
  DELETE from is refused; a `referenced-by` gap on any table of the reach is
  refused; the reach lists the root first and the rest in codepoint order,
  with each accepted key and the table it refers to, and says whether a key
  past the root may refuse the delete; `deleting` says cascades and clears
  from the accepted keys' actions (watched failing with the reach of the
  root alone, and with names accepted without their action).
  `records/plan-delete.test.ts` and `records/delete-terms.test.ts` — the
  request carries the reach the policy accepts, and a reach whose tables
  and keys do not account for each other is thrown before a statement is
  built (watched failing with the root's reach planned, and with every
  reach past the root read as it came). `drift/referrers.test.ts` — a new
  key that acts on a delete of a table past the root, or an accepted key
  whose action changed, stops delete; an accepted key unchanged is no
  change; DELETE revoked on a table past the root, a `referenced-by` gap
  on one, and a new key that follows a cleared column ON UPDATE each stop
  delete (watched failing with the root's keys, grant and gap alone
  compared). Both adapters' `cascade.integration.test.ts`, against
  `postgres:17-alpine` (17.11) and
  `mcr.microsoft.com/mssql/server:2022-latest` (16.0.4295.3) loaded with the
  shared fixture's parity schema, every case declared with `covers()` under
  `cascadeCase` -- cascade, clears (where writing the old reference back
  is refused by the key, 23503 and 547, and on SQL Server a rowversion
  added for the case moves), grandchild, reach-moved,
  reach-moved-waiting (on PostgreSQL under READ COMMITTED and REPEATABLE
  READ), action-changed, clears-moved, reach-privilege (in each of
  `REACH_PRIVILEGE_LOSSES`' ways: DELETE revoked on the grandchildren with
  no grant to write them kept, or with INSERT kept, and on the cleared
  table with UPDATE kept) and
  cascade-security (watched failing against 0050's guards, which accept no
  key: each delete that should cascade, clear or be refused for the
  account's grant was schema-changed; then on PostgreSQL with the guard
  over the root alone, with the locks left out and with the reach locked
  ACCESS SHARE -- under READ COMMITTED a delete that waited for a key added
  onto the reach was answered done -- with the action left out of the
  match, with the cleared columns unguarded, with the root alone
  locked, where an account that lost DELETE on the grandchildren was
  answered done, and with DELETE left to the lock, where one that kept
  INSERT on the grandchildren or UPDATE on the cleared table was answered
  done; and on SQL Server with the guard over the root alone, the
  action left out of the match, the cleared columns unguarded and the
  DELETE check removed: each answered done). The PostgreSQL suite also
  characterises as whom a cascaded table's own triggers and rules run: its
  BEFORE DELETE trigger and a rule on it as the table's owner, its AFTER
  DELETE trigger as the deleting account. Both
  `records-lost-answer.integration.test.ts`, under `cascadeCase('lost-answer')`
  -- a cascading delete whose answer is lost is unknown-outcome and sent once;
  on PostgreSQL's locked path, cut after the statement's row came back and
  before the commit was sent, its row and its line are still there; on SQL
  Server, cut once the batch had committed, both are gone. No case cuts a
  PostgreSQL delete after its COMMIT was sent, or a SQL Server batch before
  it committed. `packages/data-server/src/routes/runtime-deletes.test.ts`
  -- `GET`'s `deleting` says cascades where the policy names the key, and the
  route hands the port the planner's reach; the bundle is refused for a key
  the policy does not name and accepted once it does (watched failing with
  `deleting` worked out without the policy). `e2e.integration.test.ts` --
  through the order form's own account on both engines, a policy that names
  the lines' and the deliveries' keys and not the parcels' is refused naming
  it, one that names all three publishes, and a clerk deletes her order with
  its lines, deliveries and parcels while another tenant's clerk is told 404
  (watched failing against 0050's adapters: the other tenant's clerk was
  answered 409 `schema-changed`, where 404 was due).
  `scripts/getting-started/journey.test.mjs` -- `deleteOrder`, the clerks'
  half of the getting-started gate's delete, against a stand-in server:
  tenant 2 is told 404, tenant 1 deletes the order, and it is then not
  found (watched failing with tenant 2's token sent for tenant 1's delete);
  the gate itself, which publishes the second form and deletes the
  fixture's order through the composed stack, runs in CI's
  `getting-started` job. Both `uuid.integration.test.ts`, under
  `uuidCase('delete')`, as the order form's own account -- a grant on the
  delivery form that names no key is refused for its parcels and for
  nothing else, and one on the order form for its deliveries, its lines and
  their parcels; with those keys named, tenant 2's clerk deletes a delivery
  by its uuid token with its two parcels -- on PostgreSQL over the version
  column 0057 lets prove a record -- and then its order with its line, its
  other delivery and that one's parcel (watched failing on PostgreSQL with
  the guard accepting no key, as 0050's did: the delivery's delete was
  answered schema-changed). `scripts/install-fixture/consume.ts` --
  `CascadeRule` and `reachesPast` through the published entry points.
  **Not mechanically enforced:** a key onto an inheritance child of a table
  the delete reaches, and a partition attached to one while the delete
  waits (0050's edge, on every table of the reach now); the round trips and
  the time of a delete, which the performance catalogue does not measure.

## Context

0050 deleted a record and nothing past it: a policy that granted delete was
refused while any key that refers to the form's table cascades, sets NULL or
sets a default, and the statements refused any such key they found. The
fixture's orders could therefore never be deleted. `fk_order_line_order`
cascades from an order to its lines, and since 0056 `fk_delivery_order` from
an order to its deliveries and `fk_parcel_delivery` from a delivery to its
parcels: deleting an order reaches four tables. The person decided (the
delete design's addendum, decision 3) that each key that deletes or clears
rows is named in the policy with its action, that the account must be able
to delete from every table reached, and that anything new refuses.

Four facts decided the shape:

- **The rows a cascade reaches are asked of no form's policy.** The
  database deletes them. A child form's filters and throughs are not
  consulted; an administrator who names the key is saying they know it.
- **A PostgreSQL statement locks only the tables it names before its
  snapshot.** A cascade opens each table it reaches only after the
  statement's snapshot, from the referential trigger at the end of the
  statement, so a key added onto order_line between the two is followed by a
  guard that cannot have read it.
- **Neither engine asks the deleting account anything of the tables a
  cascade reaches** (P5, below), so "the account may delete from every
  table reached" holds only where the module asks it.
- **0049 records, on every table, whether the account may DELETE from it
  and every key that refers to it**, or a `referenced-by` gap -- a key onto
  a partition, an inheritance child or an edge constraint among them. So the
  whole reach can be walked from a snapshot, and held to it at runtime.

Measured on 2026-10-12 against `postgres:17-alpine` (17.11) and
`mcr.microsoft.com/mssql/server:2022-latest` (16.0.4295.3, RTM-CU27), in
scratch containers started for the probes on a Linux host with 20 CPUs and
16 GB under Docker 29.8.1, each removed afterwards; and held since by the
suites named above.

| Probe | What the server answered |
|---|---|
| P5, PostgreSQL | An account with SELECT and DELETE on a parent and nothing on its child deleted the parent, and the ON DELETE CASCADE deleted the child's rows; an ON DELETE SET NULL set its reference NULL, the row's version column unmoved. Row level security on the child that showed the account none of its rows did not stop either, FORCE ROW LEVEL SECURITY included. `delete ... returning` returned the parent's row alone, and the command tag said `DELETE 1` for a parent whose two children went with it. The child's AFTER DELETE trigger fired, as the deleting account (`current_user`), and an insert it made into a table the account may not write refused the whole delete, 42501; its BEFORE DELETE trigger, and a DO ALSO rule on it, ran as the child's owner -- the referential action's delete runs as that owner. `lock table parent, child in row exclusive mode` was refused, 42501 "permission denied for table child", without a grant on the child, and taken with DELETE on it -- and, in the suite, taken with INSERT on a cascaded table, or UPDATE on a cleared one, after DELETE there was revoked, after which the cascade or the SET NULL ran. |
| P5, SQL Server | An account with SELECT and DELETE on a parent and no permission on its child deleted the parent and the cascade deleted the child's rows; so it did with an explicit DENY DELETE on the child. A security policy on the child with a filter predicate that hid every row from the account stopped neither for the account, and a block predicate BEFORE DELETE that refused every row stopped neither for the account or for dbo. `OUTPUT ... INTO` and `@@ROWCOUNT` counted the parent's row alone. The child's AFTER DELETE trigger fired, as the deleting account (`user_name()`). `HAS_PERMS_BY_NAME(..., 'OBJECT', 'DELETE')` answered 0 for the account on the child. |

## Decision

**A delete reaches another table's rows only through a foreign key the
policy's `cascades` names, with the table it is on and what it does on
delete; the account must be able to DELETE from every table the delete
reaches; and each engine holds the database to exactly that, so anything
new refuses.**

- **The policy.** `cascades` is an optional list of `{ table: { schema,
  name }, foreignKey, onDelete }`, `onDelete` one of `cascade`, `set-null`,
  `set-default`; absent is none. `validatePolicy` refuses an entry of any
  other shape, a property it does not read, a key named twice, and
  `cascades` on a form nobody may delete with. A server older than this
  record refuses a policy that names one, as it refuses every property it
  does not read.
- **The reach** (`policy/cascades.ts`), walked from the snapshot: from the
  form's table, every key in each reached table's `referencedBy` --
  CASCADE adds its table to the tables removed and is walked on from there;
  SET NULL and SET DEFAULT add its table and columns to the tables cleared;
  NO ACTION and RESTRICT add nothing and make `restricted` true. On a
  cleared table, a key whose referenced columns include a cleared one is
  read for its ON UPDATE: an acting one carries the change on, and a NO
  ACTION one may refuse it.
- **What the policy may grant** (`deleteProblems`, asked at publish, on
  every read of the bundle, by the planner and by drift through
  `unaccepted`): refused for every key in the reach that acts on delete and
  is not named with its action, whether its triggers are enabled or not;
  for a table of the reach outside the approved schemas, named or not,
  because what refers to it cannot be seen; for a `referenced-by` gap on any
  table of the reach; for a cleared column another key follows by an ON
  UPDATE that acts; for a table past the root the snapshot says the account
  may not DELETE from; and for an entry that names a key the delete does not
  act through -- one it does not reach, or one onto a table it only clears,
  whose ON DELETE never runs -- or names it with another action than the key
  has. The rows a
  cascade reaches, and the cleared rows, are asked of no form's policy.
- **The request** carries the reach: the tables removed, the root first and
  the rest in codepoint order; the tables cleared with their columns; and
  each accepted key with the table it is on, its name, the table it refers to
  and its action. `deleteTerms` throws on a reach whose parts do not account
  for each other -- a table past the root no accepted key reaches, an
  accepted key onto a table not removed -- before a statement is built.
- **PostgreSQL.** A delete that reaches past its root takes the locked path
  whatever the isolation: `begin`; one `lock table` of every table of the
  reach, in codepoint order, ROW EXCLUSIVE, each with every relation below
  it; the statement; `commit`. LOCK takes no snapshot, so the statement's
  snapshot follows every lock, and ADD FOREIGN KEY onto any table of the
  reach, which needs SHARE ROW EXCLUSIVE there, either committed before and
  is read by the guard or waits until the delete ends. The lock is refused,
  42501, `permission-denied`, to an account with no grant to write a table
  of the reach, but any grant to write takes it -- INSERT or UPDATE as well
  as DELETE -- so the statement asks DELETE itself: `has_table_privilege`
  for every table past the root, found by bound names, under the lock, and
  no row deleted where one answers false or is not found; the follow-up
  after no row asks the same and answers `permission-denied`, nothing
  deleted. The statement's guard, 0050's, now reads every declared key onto
  every removed table and every relation below one, and refuses any that
  acts and is not accepted -- matched by the oids of the table it is on and
  the one it refers to, found by bound names, its name and its action -- and
  any key that follows a cleared column by an acting ON UPDATE. The
  follow-up after no row asks the same.
- **SQL Server.** The write batch's reach guard (51707), after the
  statement and under its locks, reads every key and edge constraint onto
  every removed table and refuses one that acts and is not accepted --
  matched by the objects of the table it is on and the one it refers to, its
  name under `Latin1_General_100_BIN2`, and its action -- and any key onto a
  cleared column that acts on update; then a new check (51708,
  `permission-denied`) refuses the delete unless `HAS_PERMS_BY_NAME`
  answers 1 for DELETE on every table past the root. Either rolls back what
  the cascade did.
- **`GET /v1/forms/:id`'s `deleting`** says `cascades` and `clears` from the
  accepted keys' actions, and `restricted` from every key in the reach that
  only refuses.
- **Drift** compares what refers to every table of the reach -- the
  published snapshot's and the current one's -- by `unaccepted`, and stops
  delete for a new or changed key that acts and is not accepted, for an
  acting ON UPDATE key that now follows a cleared column, for DELETE revoked
  on a table past the root, and for a `referenced-by` gap on one.
- **The getting-started gate** publishes a second order form on each engine
  whose policy grants clerks delete and names the three keys, and deletes
  the fixture's order with its line, deliveries and parcels, after tenant
  2's clerk is told 404 for it. The guide's own form stays as the studio
  publishes it: the studio has no delete roles to offer until 0052.

## Consequences

**What it buys.** The fixture's orders can be deleted, with their lines,
deliveries and parcels, by a policy that names each key that takes them,
and its deliveries, with their parcels, by one that names
`fk_parcel_delivery` -- on PostgreSQL since 0057 lets their version column
prove a record, on SQL Server by their rowversion. A
delete never acts through a key nobody named: one added after publication,
or one whose action changed, refuses every delete of the form until it is
reviewed and republished.

**What it costs.**

- The rows a cascade or a SET NULL reaches are the database's, not any
  form's: a child form's filters and throughs are not asked, and on both
  engines the deleting account's row security does not stop a cascade --
  FORCE included on PostgreSQL, a filter or a block predicate on SQL Server
  (P5).
- The account must be able to DELETE from every table a delete reaches, on
  both engines, though neither engine asks it for a cascade: the order form's
  account in the composed stack holds DELETE on orders, lines, deliveries
  and parcels (0049, 0056).
- On PostgreSQL every delete that reaches past its record takes the locked
  path -- BEGIN, the lock, the statement, COMMIT -- where a delete under
  READ COMMITTED that reaches nothing past its record sends one statement,
  and holds a ROW EXCLUSIVE lock on every table of the reach, partitions
  included, for the length of the delete. How many round trips that costs is
  not measured.
- A cascade into a table outside the approved schemas, a SET NULL into one,
  and a SET NULL whose cleared column another key follows ON UPDATE are
  refused, even where the person names the key.
- A reference a delete clears does not move the referring row's version
  column on PostgreSQL, nor a version column on SQL Server: a person editing
  that row is not told it changed, and an update that writes the old
  reference back is refused by the key, its target gone (23503, 547). A
  rowversion moves, so a save guarded by one is stale.
- A new key that acts on a delete of any table the delete reaches refuses
  every delete of the form until the form is reviewed and republished, and so
  does a DELETE revoked on one.
- A cascading delete whose answer is lost is answered unknown on both
  engines, and what it left depends on where the answer was lost. On
  PostgreSQL's locked path, lost after the statement's row came back and
  before the commit was sent, nothing of it was committed; lost after the
  commit was sent, it may have been, and no test cuts there. On SQL Server,
  lost once the batch had committed -- it commits before it answers --
  everything is deleted; no test cuts before the commit. Reconciling reads
  the record either way.
- Each delete reads the catalog for every table it reaches -- on PostgreSQL
  pg_constraint, which has no index for the lookup (0050, P8) -- so its
  cost grows with the database's constraints and with the reach; not
  measured past the fixture's.
- Triggers and rules on the tables a cascade reaches run as the database
  runs them, and are not seen or governed here (0050). On PostgreSQL the
  referential action runs as the referring table's owner, so that table's
  BEFORE DELETE triggers and its rules run as the owner, with the owner's
  grants, and may do what the deleting account could not; its AFTER DELETE
  triggers run as the deleting account, and one that the account may not do
  the work of refuses the whole delete (P5, and the PostgreSQL suite). On
  SQL Server a cascaded table's triggers run as the deleting account (P5).
- The performance catalogue measures no delete, and its figures say nothing
  about one.
- A server older than this record refuses a policy that names `cascades`.

**What it does not do.** Accept every key at once, or a key without its
action. Follow a SET NULL through ON UPDATE. Walk into a table outside the
scope. Count or name to a person what a cascade deleted. Offer the studio
any way to write `cascades` (0052) or the host page a delete (0053).

**Forecloses:** accepting all keys at once, and accepting a key without its
action.

## Alternatives considered

**Refuse every delete that cascades or clears, as 0050 did.** Lost (the
person's decision 3): the fixture's orders, and most order and line
schemas, could never be deleted.

**Accept silently, and warn in the studio.** Lost: a warning is not a rule,
and a key added after publication would act from the next request on.

**One flag, "cascades allowed".** Lost: a new cascade would be covered
without anybody naming it.

**On PostgreSQL, check the reach after the statement inside a transaction,
as SQL Server does.** Lost: complete only under READ COMMITTED; under 0041's
other isolations the second statement reads the catalog with the
transaction's older snapshot.

**Lock the tables of the reach in a mode that needs only SELECT.** Lost:
ACCESS SHARE does not conflict with ADD FOREIGN KEY's SHARE ROW EXCLUSIVE,
so it guards nothing -- measured: under READ COMMITTED a delete that waited
for a key added onto the reach was answered done.

**Leave the account's DELETE on the tables reached to the database.** Lost:
neither engine asks it for a cascade (P5), so a form would delete what its
account could not.

**On PostgreSQL, let the reach lock hold the delete to DELETE.** Lost: ROW
EXCLUSIVE is taken with any grant to write, INSERT and UPDATE included --
measured: an account that kept INSERT on a cascaded table, or UPDATE on a
cleared one, after DELETE there was revoked, deleted through it. The
fixture's own writer holds INSERT on the deliveries and parcels an order's
delete reaches. So the statement asks DELETE, for one more catalog read per
table of the reach.

**A recursive guard over the catalog.** Lost: not needed under the locks,
and a recursive walk of pg_constraint in every delete.

**Follow SET NULL through ON UPDATE.** Lost: rare, and refusing it saves a
second walk.

**A delete scenario in the performance catalogue now** (the design's PR 3).
Lost for now: each sample deletes an order that must be created outside the
timed window, and the harness has no untimed step per sample -- a create
inside the window would be counted in the server's and the database's CPU
for the block. It needs a change to the harness of its own.

## Older records

Extended, not edited away: 0050 (the reach past the root, `cascades`, the
locked path for it, the guards over the whole reach, and DELETE asked on
every table of it); 0010 (the referrer family over every table of the
reach, and DELETE and gaps there); 0016 and 0017 (each engine's delete that
reaches past its record); 0032 (the getting-started gate deletes the
fixture's order); 0041 (a delete past its root takes the locked path
whatever the isolation).
