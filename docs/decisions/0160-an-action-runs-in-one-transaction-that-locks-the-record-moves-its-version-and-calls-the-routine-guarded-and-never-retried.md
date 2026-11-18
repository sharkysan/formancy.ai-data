# 0160 — An action runs in one transaction that locks the record, moves its version and calls the routine, guarded and never retried

- **Status:** accepted; extended by [0161](0161-the-runtime-plane-runs-an-action-once-per-write-id-under-a-deadline-and-never-queues-it.md): the runtime plane runs it, under `FORMANCY_DATA_ACTION_DEADLINE_MS`, never queued on the actions' pool; extended by [0165](0165-an-action-runs-over-a-selection-of-up-to-a-page-of-records-in-one-transaction-locked-in-key-order-all-or-nothing.md): both adapters run a selection of up to a page of records in one transaction, each locked in key order, all or nothing
- **Date:** 2026-11-16
- **Deciders:** Daniel Bacher
- **Verified by:** the adapters' run, the part of this decision built so
  far; the route, its deadline setting, the client and the pages are later
  records', and nothing in the server runs an action yet. Every case was
  watched failing with its rule taken out, the file put back byte for
  byte, on 2026-11-16: PostgreSQL's on postgres:17-alpine, SQL Server's on
  mcr.microsoft.com/mssql/server:2022-latest. Each shared case is declared
  with `covers()` on both engines (`ACTION_PARITY`,
  `packages/data-fixtures/src/actions.ts`). A routine "not called" is one
  that drew nothing from the sequence every fixture routine draws from as
  it begins, which no rollback gives back: each case that says so was
  watched failing on that count, with an unguarded call sent before the
  lock on PostgreSQL and the EXEC moved before it on SQL Server ("expected
  1 to be +0").
  `packages/data-postgres/src/actions.integration.test.ts` and
  `packages/data-sqlserver/src/actions.integration.test.ts` -- a run
  commits, the version moved by one, and the routine was given the key, the
  answer, the actor's id, the amount read from the locked row and the
  tenant (watched failing on both with the version set to itself:
  "expected { status: 'closed', …(2) } to deeply equal { status: 'closed',
  …(2) }", the version 1); two runs from one read are done and `stale`,
  the routine called once (watched failing on both with the version left
  out of the lock's WHERE: "expected 'done' to be 'stale'", and on SQL
  Server's rowversion form the same); another tenant's minted token is
  `not-found` and nothing is called (watched failing on both with the
  throughs left out of the lock: "expected 'done' to be 'not-found'"); a
  parent moved to another tenant while a run holds its child waits for the
  run (watched failing with PostgreSQL's `for share of "p"` and SQL Server's
  `with (holdlock)` taken out of the through: "never seen waiting on the
  run's lock"); an ended version is `version-ended`, nothing called
  (watched failing on both with the open-version condition taken out:
  "expected 'done' to be 'version-ended'"); the prefixed refusal is
  `declined` with the routine's words and nothing kept (watched failing on
  both with an error inside the routine never read as worded for the
  person: "expected 'refused' to be 'declined'"); an error not worded for
  the person is `refused`, its message passed nowhere (watched failing on
  both with every error inside declined, its message the reason: "expected
  'declined' to be 'refused'"); a routine whose body references a missing
  column is `refused`, never `schema-changed` or thrown (watched failing on
  both with where it arose unasked: "expected 'schema-changed' to be
  'refused'"); a routine dropped and created again between the description
  and the run is `schema-changed` and nothing is called (watched failing on
  both with the routine's guard taken out: "expected 'done' to be
  'schema-changed'"); made SECURITY DEFINER on PostgreSQL it is
  `schema-changed` (watched failing with `prosecdef` left out of the
  routine's facts: "expected 'done' to be 'schema-changed'"), and made to
  EXECUTE AS OWNER on SQL Server so is it (watched failing with EXECUTE AS
  left out of the procedure's facts: "expected 'done' to be
  'schema-changed'"); EXECUTE revoked, the account's only permission on
  the routine, is `permission-denied` on PostgreSQL (watched failing with
  every error at the call read as one inside the routine: "expected
  'refused' to be 'permission-denied'") and `schema-changed` on SQL Server,
  from the run and from a description after it (watched failing with
  PostgreSQL's answer asserted: "expected { run: 'schema-changed', …(1) }
  to deeply equal { run: 'permission-denied', …(1) }"), and EXECUTE denied
  where the schema still grants it is `permission-denied` on SQL Server
  (watched failing with HAS_PERMS_BY_NAME unasked, the EXEC's own 229
  naming the procedure: "expected 'refused' to be 'permission-denied'"); a
  lock held
  by another transaction ends at the deadline on PostgreSQL,
  `action-timeout`, answered before the holder lets go (watched failing
  with no statement timeout set: "expected 2521.240500000001 to be less
  than 2000"), and at LOCK_TIMEOUT on SQL Server, `unavailable` (watched
  failing with no LOCK_TIMEOUT set: "expected 'unknown-outcome' to be
  'unavailable'"); a routine that runs past the deadline is `action-timeout`
  on PostgreSQL (watched failing with no statement timeout set: "expected
  'done' to be 'action-timeout'") and `unknown-outcome` on SQL Server, and
  rolled back there too (watched failing with mssql's own 15 s in place of
  the deadline: "expected 'done' to be 'unknown-outcome'"). PostgreSQL's
  alone: an overload created after publication is never called (watched
  failing with a bound value cast to text alone: "expected [
  'overload:overloaded' ] to deeply equal [ Array(1) ]"); a run whose two
  statements each fit the deadline and together do not is `action-timeout`
  (watched failing with the second SET left out: "expected 'done' to be
  'action-timeout'"); the server's own unknown outcome, 40003, raised
  inside the routine is `unknown-outcome` (watched failing with what passes
  asked first: "expected 'unavailable' to be 'unknown-outcome'"); a STRICT
  routine is refused by the description (watched failing with STRICT read
  as nothing there: "expected 'done' to be 'refused'"), and one made STRICT
  after it, given a NULL argument from the record's column, is
  `schema-changed` (watched failing with STRICT left out of the facts:
  "expected 'done' to be 'schema-changed'"); a routine made IMMUTABLE in
  its place and given every argument as a value is never evaluated while
  the call is planned (watched failing with the values bound where they
  stand: "expected 'declined' to be 'schema-changed'"); and on the locked
  path, a connection under REPEATABLE READ, a lock held, a routine past the
  deadline and two statements together past it are each `action-timeout`
  (watched failing with no statement timeout set on that path: "expected
  2512.0608999999986 to be less than 2000", then "expected 'done' to be
  'action-timeout'" twice), a wait for the table and then for the row
  stops at the deadline (watched failing with the SET after the table lock
  left out: "expected 3012.673600000002 to be less than 2700"), and a
  routine made SECURITY DEFINER while the lock waited for a row is
  `schema-changed` (watched failing with the guard by its whole definition
  left out: "expected 'done' to be 'schema-changed'"). SQL Server's alone: a
  status other than 0 is `refused` and rolled back (watched failing with the
  status unasked: "expected 'done' to be 'refused'"); a procedure that
  COMMITs, and one that ROLLs BACK and raises, is `unknown-outcome` (watched
  failing with CATCH not asking whether the transaction was still the
  batch's: "expected 'refused' to be 'unknown-outcome'"); a rowversion
  form's run moves the rowversion through its touch column; every argument
  of a varchar or char parameter -- a column under another code page, an
  answer, a context value -- reads back as given or the run is refused and
  nothing called (watched failing with the read-back checks taken out:
  "expected 'done' to be 'refused'").
  `packages/data-postgres/src/actions-lost-answer.integration.test.ts` and
  `packages/data-sqlserver/src/actions-lost-answer.integration.test.ts`,
  through 0031's TCP hop -- the marker crosses once, the outcome is
  `unknown-outcome`, and nothing sends it again (watched failing on both
  with a lost connection read as one before anything was sent: "expected
  'unavailable' to be 'unknown-outcome'"); PostgreSQL's never committed,
  SQL Server's did; and PostgreSQL's run costs 8 round trips, 10 on the
  locked path (watched failing with the locked path asserted at 11).
  `packages/data-sqlserver/src/actions/errors.test.ts` -- an EXEC that does
  not resolve is `schema-changed`, read by the step and the procedure
  ERROR_PROCEDURE() names ahead of where an error arose (watched failing
  with where it arose asked first: "expected [ 'refused', 'refused', …(2) ]
  to deeply equal [ 'schema-changed', …(3) ]"), and one the procedure
  raised calling another is its own (watched failing with every such number
  read as the EXEC's). `packages/data-sqlserver/src/actions/results.test.ts`
  -- every row of a procedure's result set is dropped as it streams, and
  the batch's own two kept (watched failing with every row kept: "expected
  20001 to be 1").
  `packages/data-server/src/drivers.integration.test.ts` -- a run's backend
  on PostgreSQL and its session on SQL Server are the actions' client's and
  pool's, each named `formancy-data actions` (watched failing with the
  actions' port made on the records' client and pool: "expected [
  'postgres.js' ] to deeply equal [ 'formancy-data actions' ]", "expected [
  'node-mssql' ] to deeply equal [ 'formancy-data actions' ]"), and SQL
  Server's runs `SQLSERVER_ACTION_POOL` at once while one more waits
  (watched failing with the pool opened at 5: "never seen 10 runs in their
  procedures").
  `packages/data-core/src/actions/failure.test.ts` -- a record failure is a
  run's by one mapping both adapters ask (watched failing with every code
  answered `refused`, with every code passed through, and with a declined
  reason left out, in turn).
  `packages/data-fixtures/src/load.test.ts` -- the two editions of the
  actions schema create the same tables, constraints, routines and
  sequence, and SQL Server its own ticket (watched failing with `reprice`
  renamed in the T-SQL file, and with the sequence renamed there).

## Context

0159 decided what data-core holds of an action -- the binding, the
dialog, the policy, the planned request, drift -- and left the run to a
later record: the transaction, the routine's guard, the outcomes, the
deadline and the connections. This is that record, for the open record
alone; a selection of records is a later one's. The design weighed the
run in its section 7, and left a list of engine facts "not checked",
each to be measured by the record that relies on it. The one question
asked of Daniel before it -- whether a run on a SQL Server rowversion form
moves the rowversion -- was answered for 0159: yes, by setting 0155's
confirmed touch column to itself.

## Decision

1. **A port of its own.** `ActionAdapter` (`packages/data-core/src/
   actions/types.ts`) has two operations, each implemented by both
   adapters: `describe(table, routine)`, the root and the routine in one
   statement, each with the adapter's own definition token (0041), and
   `run(request, deadlineMs)`, which answers `ActionOutcome`: each record
   by its key as the statement that moved it read it, or an
   `ActionFailure`. Its codes are a write's that a run can meet --
   `not-found`, `stale`, `version-ended`, `schema-changed`,
   `permission-denied`, `declined`, `refused`, `unavailable`,
   `unknown-outcome` -- and `action-timeout`. `runFailure` maps a record
   failure to a run's, a constraint's or a value's as `refused`, in
   data-core, so the two adapters cannot read one refusal two ways. The
   deadline is the run's argument, not the planned request's: the planner
   is pure and reads no configuration (0159), and the route will hand the
   server's.
2. **PostgreSQL: one transaction of two statements, each guarded.** In
   `sql.begin`: `SET LOCAL statement_timeout` to what remains of the
   deadline; on the locked path (0041) the root locked first and the
   timeout set again to what remains, since the table lock waits behind
   DDL as the record's lock waits behind a row; the lock -- a
   materialised CTE that selects the record by its key, under the person's
   filters and every through, at the version read, the open version alone
   (0113), under the root's definition guard, `order by` its key `for no
   key update`, and an UPDATE that moves the version by one, returning only
   the key and the version; then `SET LOCAL statement_timeout` to what
   remains by the process's monotonic clock, nothing remaining
   `action-timeout` with nothing called; then the call, `select
   "s"."f"("p" => …)` over the moved row, every argument named, quoted and
   cast to its bound type from the adapter's closed table (0158), every
   bound value read from a derived table the planner keeps (`offset 0`),
   under the routine's guard -- its definition's digest, read of the
   routine that `to_regprocedure` of the bound signature resolves to, as
   an uncorrelated condition. On the locked path the call's snapshot is
   the lock statement's, and an ALTER FUNCTION committed while that waited
   for a row is not in pg_proc read under it, where the call finds the
   routine through the catalog cache as it now is: there the call is
   guarded by the digest of the routine's whole definition too, as
   `pg_get_functiondef` prints it from that cache, which the description
   carries beside the facts' digest. Fewer rows than records at the lock,
   or fewer calls than rows moved, throws inside the transaction, so it
   rolls back. A STRICT routine is not run: the description refuses it,
   `refused`, and the digest covers STRICT, since PostgreSQL does not call
   one given a NULL argument, a field's included, and the run would answer
   done for a call that never ran. Bound values are kept from the planner
   because it evaluates an IMMUTABLE function whose arguments are all
   constants while it plans the statement, before any guard, and a custom
   plan makes a bound value one.
   A through's parent is locked `FOR SHARE` inside its EXISTS, not `FOR KEY
   SHARE`, which does not conflict with an UPDATE that leaves the parent's
   key alone: a move to another tenant is one. Two statements, not the
   call in a third CTE: a routine that writes the record must find it
   moved in its own transaction.
3. **SQL Server: one batch,** with `xact_abort`, TRY/CATCH and 0031's
   transaction check, `@step` numbering lock, guard, arguments, call and
   commit. `SET LOCK_TIMEOUT` to half the deadline; the record locked and
   moved in one UPDATE `WITH (UPDLOCK, HOLDLOCK)`, each through's parent
   read `WITH (HOLDLOCK)`, then the checks a write's step carries (0017,
   0041, 0155) and the adapter's own error where no record moved;
   LOCK_TIMEOUT back to -1. The routine's guard: its definition's digest
   by OBJECT_ID, compared just before the EXEC, and EXECUTE asked of
   HAS_PERMS_BY_NAME. The digest covers EXECUTE AS, sys.sql_modules'
   `execute_as_principal_id`, SQL Server's SECURITY DEFINER: ownership
   chaining reaches the owner's tables whatever a procedure says (0158),
   and stops at dynamic SQL, another owner's objects and another database,
   which EXECUTE AS reaches as its principal. Each argument read into a
   variable of its parameter's exact type, a column from the locked row in
   one SELECT, and every argument of a parameter that counts code-page bytes
   checked to read back as it was given, as nvarchar -- the duty 0159 left
   here. Then `EXEC @status = …`, the transaction checked to be still the
   batch's, and a status other than 0 THROWn. CATCH records the step, SQL
   Server's number, message and severity and ERROR_PROCEDURE() in a table
   variable the rollback does not empty, and the batch selects it, then the
   moved keys. The batch is sent once, with mssql's per-request timeout at
   the deadline, its result sets streamed, and every row of one that is not
   the batch's own two dropped as it arrives.
4. **The move.** A version column incremented; on a rowversion form the
   confirmed touch column set to itself, which moves the rowversion
   (0155, 0159). A run happens at most once per version read, on every
   replica, and a second press from the same read is `stale`.
5. **An error is classified by where it arose** (each adapter's
   `actions/errors.ts`). First what the transaction did, wherever it
   arose: what passes is `unavailable` -- a deadlock, a lock wait past
   its bound, a connection gone -- PostgreSQL's 57014 is `action-timeout`,
   and a connection lost once the run was sent, a transaction a procedure
   or a trigger ended, PostgreSQL's own 40003, asked before its class,
   which passes, and SQL Server's run past its deadline are
   `unknown-outcome`. Then the adapter's own errors, by number and exact
   message. Then, on SQL Server, an EXEC that does not resolve, which SQL
   Server raises in the called procedure's context: no such procedure
   (2812), with no procedure named, or parameters the EXEC does not fit
   (201, 8144, 8145, 8146), naming the bound procedure, is `schema-changed`.
   Then inside the routine or a trigger -- PostgreSQL's context field, SQL
   Server's ERROR_PROCEDURE(), the engine's own report and never a phrase
   -- everything else is the deployment's: `declined` under the prefix
   (0156), `refused` otherwise. At the adapter's own statement a code
   means what it means for a write: a call that does not resolve is
   `schema-changed`, a grant refused `permission-denied`.
6. **No retry, and no cancel.** A run takes no signal: it goes on after
   its client leaves, as a write does (0031). No cancel is sent of the
   adapter's own: PostgreSQL's statement timeout needs none and a late one
   stops the next statement on its backend (0061); SQL Server's request
   timeout sends an attention in-band, which stops only its own batch.
7. **A pool of its own.** `OpenConnection.actions` runs on a client of its
   own per connection (`packages/data-server/src/drivers.ts`): on
   PostgreSQL a third, named `formancy-data actions` in
   pg_stat_activity, at postgres.js's default, which it reports as
   `options.max`; on SQL Server a second pool, its sessions named
   `formancy-data actions` in sys.dm_exec_sessions, sized explicitly at
   mssql's default of 10, read in its source, since no public property of
   a pool reports its bound. A run holds a connection and row locks for up
   to its deadline, which on the records' pool would stall every read and
   write of the database.

What the PR measured, each "not checked" in the design, each held by a
case of the suites above and dated with its image:

- **Lock order** (postgres:17-alpine, 2026-11-16): an `order by key …
  for no key update` locks each row as its sort hands it on -- ascending,
  the first of two rows was held while the statement waited on the
  second; descending, it was not.
- **Where an error arose** (both, 2026-11-16): PostgreSQL fills the context
  field for an error in a PL/pgSQL function, "PL/pgSQL function
  actions.broken_order(bigint) line … at SQL statement", and in a SQL
  function, 'SQL function "fail_sql" statement 1', and sends none for an
  error in the statement sent. SQL
  Server's ERROR_PROCEDURE() in CATCH names a procedure schema-qualified
  for a 207 at its recompilation, "actions.broken_order", a trigger
  unqualified, "refuse_customer", and nothing for the batch's own
  statement -- and names the procedure for a 229 at an EXEC the account may
  not run too, "actions.reprice", which is why EXECUTE is asked first.
- **Where an EXEC failed to resolve** (mssql/server:2022-latest,
  2026-11-16): ERROR_PROCEDURE() names nothing for an EXEC of no such
  procedure (2812) in the batch, and the procedure it is in for one inside
  a procedure; it names the procedure called for an EXEC that lacks a
  parameter (201, a parameter renamed among them), passes too many by
  position or by name (8144), names one it does not have where none is
  lacking (8145), or passes any to one that takes none (8146) -- and the
  one called badly, not the caller, for such an EXEC inside a procedure.
- **Out of sight** (mssql/server:2022-latest, 2026-11-16): an account
  whose only permission on a procedure was EXECUTE no longer finds it by
  OBJECT_ID once that is revoked, and HAS_PERMS_BY_NAME answers 0 for it,
  as it does for a name nothing holds; NULL there, which the
  documentation's "not valid" suggests, was asserted, and 0 came back.
- **The planner's fold** (postgres:17-alpine, 2026-11-16): a routine made
  IMMUTABLE in its place, given every argument as a bound value, was
  evaluated while the call was planned, its RAISE the run's answer
  (`declined`), though its guard refused it; read from a derived table
  behind `offset 0`, it was not evaluated at all.
- **The locked path's snapshot** (postgres:17-alpine, 2026-11-16): under
  REPEATABLE READ, a routine made SECURITY DEFINER while the lock
  statement waited for a row another transaction held and did not change
  was called, and the run done, past a guard that read pg_proc alone.
- **A locking clause in EXISTS** (postgres:17-alpine, 2026-11-16):
  PostgreSQL takes `for share of "p"` inside an EXISTS and locks the parent
  row, so a third session cannot take it `FOR UPDATE NOWAIT`; and only for
  an account that may UPDATE the parent -- one with SELECT alone is refused,
  42501.
- **SET LOCK_TIMEOUT's scope** (mssql/server:2022-latest, 2026-11-16): set
  inside `sp_executesql` it ends with its request even when the request
  ends in an attention, ETIMEOUT: the next request on the same session
  read -1. 0155 measured it for a request that ended on its own.
- **A large result set** (mssql/server:2022-latest, 2026-11-16): read as a
  query, mssql holds every row of a result set until the batch ends --
  20,000 rows of 500 characters, all 20,000 there; the run streams, and a
  procedure that returns them runs and is answered as any other. That a
  row of a procedure's result set is dropped as it arrives is
  `results.test.ts`'s, without a server.
- **The pool's reported size** (2026-11-16): postgres.js 3.4.9 reports
  `options.max`, 10; mssql 12.7.4 reports no bound -- `size` was 0 after
  connect, and `config.pool` absent unless given.
- **Round trips** (postgres:17-alpine, 2026-11-16, through the fixtures'
  hop): a run is 8 turns from BEGIN to COMMIT, on a connection's first run
  and on the next alike, and 10 on the locked path, where the table lock
  and a third SET cost two more; 0061 measured one statement under one SET
  LOCAL at 5 or 6.
- **A lost answer on PostgreSQL** (postgres:17-alpine, 2026-11-16): a cut
  while the call's answer was on its way left the run rolled back, its
  COMMIT never sent. The adapter answers it `unknown-outcome` all the same
  (below).
- **What an attention does to a run** (mssql/server:2022-latest,
  2026-11-16): a procedure past the deadline was stopped by mssql's
  attention and its run rolled back by `xact_abort`, nothing kept -- which
  the answer, `unknown-outcome`, cannot claim (0031 P3).

## Consequences

**What it buys.** An action's run is one transaction on both engines that
acts only on the record the person's filters and throughs admit, at the
version they read, the open version alone, holds the record and its
parent to the end, calls exactly the routine it was decided over or
nothing, gives it nothing the person may not read, and answers once, in
a code a route can word, with a lost answer unknown and never replayed.

**What it costs.**

- **A run holds row locks for up to its deadline.** A save of the record
  waits for the run, then is `stale`; a move of a through's parent waits
  too. PostgreSQL writes have no deadline, so they wait it out.
- **Every run fires the root's UPDATE triggers**, and on a rowversion form
  sets its touch column, with `UPDATE()` true for it, a row of temporal
  history and a change to CDC and change tracking, whatever the routine
  does (0159).
- **On PostgreSQL a through needs UPDATE on its parent.** `FOR SHARE`
  asks it, measured: an account that may only read a through's target is
  refused every run, `permission-denied`, and the generator does not yet
  say so before publication.
- **PostgreSQL's deadline bounds each statement, not the round trips
  between them**: eight from BEGIN to COMMIT, ten on the locked path.
- **A STRICT routine is not run on PostgreSQL.** The description refuses
  it, `refused`: PostgreSQL would not call it for a NULL argument, and the
  run would answer done. Neither discovery nor the generator says so yet,
  so a form bound to one is found refused only when it is run; telling it
  before publication is a later record's.
- **On PostgreSQL's locked path, a routine changed in any way between the
  description and the call is not called**, its body included, which the
  whole definition's digest covers: the run is `schema-changed`, and the
  next one is described again.
- **A PostgreSQL routine with no parameter, made IMMUTABLE in its place
  between the description and the run, is evaluated while the call is
  planned**, before its guard refuses it. It cannot write, and the run is
  rolled back, but what its RAISE says can reach the person. A routine
  with a parameter is never so: each value it is given is read from a
  derived table the planner keeps, and each column from the record.
- **On SQL Server, EXECUTE revoked from an account whose only permission
  on the procedure it was is `schema-changed`, where PostgreSQL answers
  `permission-denied`.** SQL Server hides the procedure from the account as
  if it were dropped, and nothing the account can ask tells the two apart;
  drift review, discovering as the account, finds it gone too. A DENY
  where the schema still shows the procedure is `permission-denied`.
- **A lost answer on PostgreSQL is over-reported.** A cut before COMMIT
  was sent cannot have committed, measured, and the adapter still answers
  `unknown-outcome`, as a save's lost answer is (0155): narrowing it would
  answer one fact two ways in one adapter.
- **On SQL Server any run past its deadline reads "It may have run"**: the
  client's ETIMEOUT may follow a COMMIT (0031 P3). The lock waits half the
  deadline -- chosen, not measured -- and a wait past it is a known
  rollback, `unavailable`.
- **SQL Server's routine guard is not in the EXEC's statement.** The
  digest and EXECUTE are asked in the statements just before the EXEC, and
  nothing closes the window between them: a procedure dropped and created
  again in it is called as created.
- **A SQL Server procedure that ends the run's transaction is
  `unknown-outcome`**, over-reported for one that rolled back.
- **A varchar or char parameter on SQL Server refuses a character its code
  page lacks** -- in an answer, a context value, or a column under another
  collation -- so a routine with such a parameter cannot be run with such
  text: SQL Server would pass `?` without an error.
- **One more pool per allowlisted database**: three clients on PostgreSQL,
  two pools on SQL Server, each opened when the connection is, though
  nothing in the server runs an action yet; the actions' sessions are
  named `formancy-data actions` on both engines.
- **Every fixture container loads the actions schema**, beside the parity
  schema, so one harness serves every suite (0005).

**What it does not do.** Nothing serves or runs an action: there is no
route, no deadline setting, no count of the runs in flight against the
pool, no client and no page. A selection of records, a preview and a
check routine are later records'. The routine's body is not read, and what
it does is the deployment's (0159).

**Forecloses:** nothing.

## Alternatives considered

**The call in a third CTE of PostgreSQL's lock statement**, one statement
as 0015 has it. Lost: the routine would not see the moved row in its own
transaction, and a routine that writes it could make PostgreSQL refuse a
row changed twice in one command.

**`FOR KEY SHARE` on a through's parent**, which asks no UPDATE grant.
Lost: it does not conflict with an UPDATE that leaves the parent's key
alone, and a move to another tenant is exactly that.

**Joining the through's parent instead of locking it inside the EXISTS.**
Not needed: PostgreSQL takes the locking clause there, measured.

**Where an error arose read from its message**, a phrase such as
"PL/pgSQL function". Lost: the engine's own report, the context field and
ERROR_PROCEDURE(), says it in every language.

**A 229 at the EXEC read by where it arose.** Lost: ERROR_PROCEDURE()
names the procedure for it, as for an error inside it, measured; the batch
asks HAS_PERMS_BY_NAME first.

**PostgreSQL 17's `transaction_timeout`.** Lost: it is FATAL, so an unknown
outcome, and 15 and 16 lack it.

**A cancel at the deadline.** Lost: a PostgreSQL cancel can land after its
statement and stop the next one (0061); the statement timeout needs none.

**SQL Server's batch read as a query.** Lost: mssql holds every row of
every result set until the batch ends, a procedure's included.

**Runs on the records' pool.** Lost: a handful of slow runs would stall
every read and write of every form on the database.

**The deadline in `ActionRequest`, as a save's request carries its own.**
Lost: 0159's planner would take a value it does not decide, and the route
holds the configured one.

**The locked path's window recorded as a cost**, the routine's facts read
under the transaction's snapshot alone, as SQL Server's window is. Lost: a
routine made STRICT or SECURITY DEFINER while the lock waited would be
called past its guard, and a STRICT one answered done for a call that never
ran; `pg_get_functiondef` reads the catalog cache, as the call does.

**pg_proc's `xmax` read on the locked path**, to see that the row read
under the snapshot has a newer version. Lost: a row lock or an ALTER rolled
back leaves it set until the row is updated again, refusing every run of
the routine meanwhile.

**HAS_PERMS_BY_NAME asked before the digest on SQL Server**, to answer a
procedure out of the account's sight `permission-denied`. Lost: it answers
0 for one dropped too, measured, and would read a dropped procedure as a
refused grant.

**Every routine but a VOLATILE one refused**, against the planner's fold.
Not needed for a routine with a parameter, which the derived table keeps
from the fold, and it would not keep one made IMMUTABLE after the
description from being folded either.

**EXECUTE AS left out of SQL Server's digest**, every procedure taken to
reach its owner's tables already. Lost: ownership chaining stops at
dynamic SQL, another owner's objects and another database, which EXECUTE
AS reaches.

**PostgreSQL's lost answer told from where `begin` rejected**: a cut while
the body ran never sent COMMIT. Lost for now: a save answers the same fact
`unknown-outcome` (0155), and two answers to one fact in one adapter is
what the core exists to prevent.

## Older records

Extended, not edited away: 0015 (a run is one transaction of two guarded
statements on PostgreSQL and one batch on SQL Server, through a port of
its own, bounded to one record); 0016 and 0017 (each adapter's run, its
statements and batch); 0031 (a run's lost answer is `unknown-outcome`, sent
once, and so is a run a procedure's own COMMIT or ROLLBACK ended); 0041 (a
run is guarded by the routine's definition as well as the root's); 0043 (a
run holds a through's parent to its COMMIT); 0061 (a run's deadline is the
statement timeout set before each statement on PostgreSQL and LOCK_TIMEOUT
with the per-request timeout on SQL Server, no cancel sent, on a pool of
its own); 0156 (a routine's refusal under the prefix is `declined`); and
0159 (the run of what it plans, and the code-page duty it left).
