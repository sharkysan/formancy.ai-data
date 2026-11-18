# 0165 — An action runs over a selection of up to a page of records in one transaction, locked in key order, all or nothing

- **Status:** accepted
- **Date:** 2026-11-17
- **Deciders:** Daniel Bacher
- **Verified by:** the server's half of a selection -- data-core, both
  adapters, the route, the audit and the client; the studio offering the
  scope and the host page's choice of rows are a later record's. Written
  on a machine without Docker on 2026-11-17: the cases that need no
  database ran there, each watched failing with its rule taken out and
  the file put back byte for byte; the container suites have never run,
  and CI is their first run. Each shared case is declared with `covers()`
  on both engines (`ACTION_PARITY`, `packages/data-fixtures/src/actions.ts`).
  Ran and watched failing:
  `packages/data-core/src/actions/plan.test.ts` -- a selection is every
  record chosen, in the order sent, each at the version read (watched
  failing with a selection held to one record as the open record is:
  "expected { ok: false, …(2) } to match object { ok: true }"); a page of
  records is planned, one more and none refused, by `readRunBody` alone,
  which the planner reads every body through (watched failing with the
  bound taken out of it: "expected { ok: true,
  request: { …(8) } } to match object { ok: false, code:
  'invalid-request' }"); two tokens of one key are `duplicate-record`
  naming both (watched failing with the check taken out); the open
  record's action takes one record, whatever the body says (watched
  failing with every action read as a selection); and its one token sent
  twice is `duplicate-record` in words that name the request, not a
  selection (watched failing with the selection's words: "expected { ok:
  false, …(3) } to deeply equal { ok: false, …(3) }").
  `packages/data-core/src/actions/failure.test.ts` -- `unmovedFailure`
  answers a refusal about the run first, then `not-found`, `version-ended`
  and `stale`, each naming its records, and `refused` where nothing was
  told (each watched failing with its rule changed in turn).
  `packages/data-core/src/generate/actions.test.ts` -- a selection is
  bound with its scope, by the same rules, and its note says what it
  costs (watched failing with the scope written `record` whatever the
  request said: "expected 'record' to be 'selection'"); a scope of no
  shape is thrown.
  `packages/data-server/src/routes/runtime-actions-selection.test.ts`,
  over fake ports -- the form offers a selection as one and a page of
  records is described once, sent once with every record in the order
  sent and answered with every token (watched failing with the server's
  reading of a request taking `record` alone: the stored form was
  `corrupt-bundle`); a body past a page, and one of none, is 400 before
  the connection is opened and before any statement (watched failing
  with the bound taken out of `readRunBody`: "expected { described: 1,
  runs: +0, opened: 1 } to deeply equal { described: +0, runs: +0,
  opened: +0 }"); the open record's action over two records is refused,
  nothing sent; one record named twice is 400 naming both by the tokens
  sent, and a refusal the adapter names records for -- `stale`,
  `duplicate-record` -- names them so (each watched failing with the
  positions unread: its records []), the open record's action's `stale`
  and `not-found` naming its one token too (watched failing with the
  records left out of the answer: "expected [ 409, { code: 'stale', …(1)
  } ] to deeply equal [ 409, { code: 'stale', …(2) } ]"); the trail is one event naming every
  record by its keyed hash in the order sent and their count, `record`
  null, the open record's action unchanged (watched failing with the
  selection's trail left as the open record's), and without an audit key
  no record and still the count.
  `packages/data-sqlserver/src/actions/statements.test.ts` -- the lock
  order is the keys', a whole number by its value, and the batch runs one
  UPDATE per record in it, whatever order they were sent in (watched
  failing with a whole number ordered by its text, and with the UPDATEs
  written in the order sent: "expected [ +0, 1, 2 ] to deeply equal [ 1,
  2, +0 ]"); and every record's arguments are read before the first
  EXEC, each read found exactly once, and each EXEC given its own record's
  (watched failing with the arguments read just before each EXEC:
  "expected [ 'exec', 'exec' ] to deeply equal [ 'read 0', 'found', 'read
  1', …(5) ]"). `packages/data-sqlserver/src/actions/errors.test.ts` -- the
  batch's own duplicate is `duplicate-record` naming its positions by its
  number and its message both (watched failing with the number read by
  itself: "expected 'duplicate-record' to be 'refused'"); a record locked
  and then not found to read its arguments from is `refused` in the
  adapter's words (watched failing with the number unread: the message
  was "The database refused the statement with an error of its own
  (51737)…").
  `packages/data-sqlserver/src/records/batch-steps.test.ts` holds the two
  new numbers among the adapter's own (watched failing with both left out
  of `OWN_NUMBERS`: "expected [ 51701, 51702, 51703, 51704, …(14) ] to
  deeply equal [ 51701, 51702, 51703, 51704, …(16) ]").
  `packages/data-client/src/transport.test.ts`, run with a configuration
  of its own without the databases its package's suites start, which it
  does not use -- a selection posts every record and is done only on a
  token for each (watched failing with any token taken as done: "expected
  false to be true"); a refusal about some records names those the call
  addressed (watched failing with the body's `records` unread); a form
  with a selection action is a form this client knows (watched failing
  with the record scope alone read).
  `packages/data-fixtures/src/load.test.ts` holds SQL Server's tag table
  and routine to the one place the editions differ (watched failing with
  touch_tag left out of what SQL Server alone has: "expected [
  'broken_order', 'close_order', …(2) ] to deeply equal [ 'broken_order',
  'close_order', …(1) ]", and with pk_tag: "expected [
  'fk_order_customer', …(7) ] to deeply equal [ 'fk_order_customer', …(6)
  ]").
  First run in CI, never run:
  `packages/data-postgres/src/actions-selection.integration.test.ts` and
  `packages/data-sqlserver/src/actions-selection.integration.test.ts` --
  three orders sent out of key order commit, each moved and called once,
  answered in the order sent (`selection-done`); two runs over the same
  two orders sent in opposite orders while a third transaction holds the
  lower one's row are one `done` and one `stale` naming both, never a
  deadlock (`selection-crossed`); one order changed since it was read is
  `stale` naming it, nothing called (`selection-stale`); the routine
  refusing one order of three is `declined` and nothing is kept of any
  (`selection-declined`); a page commits and one more is refused by the
  planner and by the adapter before any statement (`selection-page`);
  each call raising the other order's amount, each is given the amount
  its own order held once locked (`selection-as-locked`).
  SQL Server's alone: `alpha` and `ALPHA` under a case-insensitive key
  collation are `duplicate-record` naming both, nothing called, and one
  spelling alone runs and is answered by the row's own; a call that
  deletes a later record of its selection leaves that record called once,
  with its own key, never the first twice; and a record a trigger of the
  lock deleted is `refused`, nothing called.
  `packages/data-client/src/actions.integration.test.ts`, on both engines
  across real HTTP -- a form offers close-all as a selection, one run
  over two orders commits both, and the same run again is 409 `stale`
  naming both; another tenant's order chosen beside the clerk's own is
  404 `not-found` naming it alone, and the clerk's order is kept as it
  was. `apps/host/src/actions.test.tsx`, on both engines -- the open
  record's header offers close and stamp, and not close-all, close_order
  bound over a selection on the same form.

## Context

0159 to 0161 bind, run and serve an action over the open record, and
the design they came from reserved `scope: 'selection'` for a later
record: an administrator's routine run once for each of the records a
person chose of the page a grid shows -- "close these invoices", one
request. 0160 already built PostgreSQL's lock for more than one record:
the records under one `order by` key `for no key update`, which it
measured to lock in its sort's order. SQL Server's batch moved one record
in one UPDATE, and SQL Server does not promise the order one UPDATE
locks several rows in. data-core's types said a selection was a later
record's, the generator threw for it, the server's reading of a request
refused it as no shape it reads, and data-client refused a form that
offered one. The host page's choice of rows is the next record's: this
one is the server's half.

## Decision

1. **A scope.** `ActionChoice.scope`, `ActionBinding.scope` and
   `FormAction.scope` are `record` -- the open record, exactly one -- or
   `selection` -- one to `LIST_PAGE_SIZE` records of the page a list
   shows, one transaction for all (`ActionScope`). The generator binds a
   selection by the rules a record action is bound by, its note saying
   that every record is held until the last call returns and that one
   refusal undoes them all; a bundle from before keeps `record`. The
   server's reading of a generation request and data-client read both.
2. **A page at most, each record once.** `readRunBody` refuses a body of
   no record or of more than `LIST_PAGE_SIZE`, so the route answers 400
   before it reads a write id or sends any statement; the planner holds
   the records to the binding's scope -- one for the open record's -- and
   refuses two tokens of one key 400 `duplicate-record`, "The request
   names one record twice. Nothing was done.", naming both, nothing sent
   -- the open record's action's words since 0159, which name no
   selection, since it has none.
3. **PostgreSQL, unchanged in shape.** 0160's lock statement takes every
   record of the selection, each under the person's filters and throughs
   at the version read, sorted by key before it locks, and moves each
   version; the call statement calls the routine once for each row moved,
   in an order PostgreSQL does not promise. Which records each row the
   lock returned answers to is the lock's own answer: the positions of
   the records whose key the row equals by the key's own equality, never
   how either is spelled. A row two records name -- two spellings a
   nondeterministic collation makes one -- is `duplicate-record` naming
   them, rolled back before any call, as on SQL Server; the answer lists
   the records in the order sent. The call statement reads every
   argument under its one snapshot, taken before any call.
4. **SQL Server, one UPDATE per record in key order.** The batch moves
   each record in an UPDATE of its own `WITH (UPDLOCK, HOLDLOCK)`, in the
   adapter's key order (`lockOrder`: column by column, a whole number by
   its value, any other kind by its canonical text, code unit by code
   unit), each OUTPUT with its position in the request. Then the checks a
   write's step carries; then two keys the database's equality makes one
   row -- two records whose UPDATEs both moved it, at two versions sent,
   by the row's own spelling OUTPUT twice, or a record that moved nothing
   whose key finds a row another record moved, read `WITH (NOLOCK)` since
   it is this transaction's own -- THROWn as 51736 with their positions,
   `duplicate-record`, rolled back before any call; then every record
   moved. Then every record's arguments, read from its locked row by its
   key into a table variable before the first EXEC -- each read finding
   exactly one row, or the run is refused as 51737, nothing called -- and
   checked. Then, for each record in the order sent, the routine's guard,
   its arguments set from that read, and its EXEC. So every call is given
   what its row held once locked, never what an earlier call wrote to it,
   which is what PostgreSQL's one call statement passes; read just before
   each EXEC, a call that deleted a later record would leave that
   record's variables at the call before's, a SELECT that finds no row
   assigning nothing, and the procedure would run twice over one row.
5. **All or nothing.** Any record's refusal rolls back every record: a
   record not moved -- `not-found`, `stale`, `version-ended` -- is told
   by the read an update alone would ask, one read for each record the
   lock did not move, and answered by data-core's `unmovedFailure`, the
   one reading both adapters ask: a refusal about the run first, then
   `not-found`, `version-ended` and `stale` in that order, naming every
   record with that code by its position. The routine's own refusal of
   one record is `declined` or `refused` about the run.
6. **The route names the records.** A 404, 409 or 400 about records
   carries `records`, the tokens sent at the positions named
   (`ActionRecordsRefusal`) -- for the open record's action too, its one
   record. Done is every token in the order sent; a lost answer names
   every record with its version, as before.
7. **The trail names every record.** An `action` event over a selection
   carries `records`, each record's keyed hash in the order sent, `null`
   without an audit key, and `rows` their count; its `record` is `null`.
   The open record's event is what it was.
8. **The client.** `runAction` sends every record it is given and is
   done only on a token for each; a refusal naming records carries those
   the call addressed (`ActionRefusal`), and a name it did not send is
   dropped.
9. **The host page offers a selection nowhere yet.** The open record's
   header offers the actions over the open record alone; an action over a
   selection belongs above the grid, which the next record draws.
   `apps/host/src/actions.test.tsx` publishes one on the action order's
   form and finds it in no control of the header.

Nothing here was measured: it was written without a database, and the
suites that would measure it run first in CI. PostgreSQL's locking after
its sort is 0160's measurement, of two rows.

## Consequences

**What it buys.** A routine run once for each of up to a page of
records, in one transaction on both engines, each record locked under
the person's policy at the version they read, each version moved, each
call given what its record held once locked, and nothing kept unless
every record and every call went through; two people running over
overlapping selections wait for each other rather than deadlock on the
records they share, but for the through below; and a refusal says which
records it is about.

**What it costs.**

- **A selection holds every lock until the last routine returns.** A
  person saving one of its records waits for the whole run, up to its
  deadline, and one slow call holds every record of the selection for as
  long as it takes.
- **No set-level call.** The routine is called once per record, up to a
  page of calls in one transaction; a routine that would rather see the
  set at once cannot, and what it does per call it does a page of times.
- **At most one page**, `LIST_PAGE_SIZE`, 50: a person closes a hundred
  invoices in two runs, each all or nothing by itself.
- **SQL Server's key order is the adapter's**, not the index's: a whole
  number by its value, any other key by its canonical text. Every token a
  read returns spells a row one way, so two runs over the same rows lock
  them in one order; two spellings a case-insensitive collation makes one
  row sort apart, and two runs that each name one row by another spelling
  can deadlock, answered `unavailable`, rolled back.
- **On SQL Server each record's lock waits at most half the deadline**,
  and the whole batch the deadline, past which a run reads "it may have
  run", as 0160's does -- a selection still in its lock step, nothing
  called, included; the routine's guard sits before each EXEC, so its
  window is one per record.
- **A through onto the form's own table can still deadlock.** The
  through's parent is locked as each record is located -- on PostgreSQL
  by an EXISTS the scan evaluates before the rows are sorted and locked,
  on SQL Server at each record's UPDATE -- not in the parents' own key
  order, so where a parent row is itself a record of another overlapping
  selection, two runs can each hold what the other waits for: a deadlock,
  answered `unavailable` and rolled back. Reasoned from the engines'
  executors, not run: no form of the fixtures has such a through.
- **On SQL Server a procedure that ends the transaction commits a
  selection in part**: a COMMIT inside record k's EXEC commits every
  record's version, moved by the lock step, and the calls so far; the
  batch stops there, the later records never called, and the answer is
  `unknown-outcome`, as 0160's is for one record. Run again from the same
  read, every record is `stale`, the uncalled ones included.
- **A call never sees what another wrote to its record's arguments.**
  Every call is given what its record held once locked, on both engines:
  a call that changes another record of the selection does not change
  what that record's call is given, and a call whose record an earlier
  call deleted is still made, with what its row held.
- **The calls' order differs.** SQL Server calls in the order sent, so
  one record refused leaves the later ones uncalled; PostgreSQL promises
  no order, and any of a selection's calls may have begun before the one
  that refused. Nothing is kept either way.
- **A refused selection costs a read per record it did not move**, up to
  a page of statements after the rollback, to say which records it is
  about.
- **On PostgreSQL two spellings a nondeterministic collation makes one
  key are `duplicate-record` by reasoning alone**: the lock's positions
  are compared by the key's own equality, as SQL Server's are, but no
  PostgreSQL form of the fixtures is keyed so, and no case reaches it.
- **A record a trigger of the lock removes is answered two ways.** SQL
  Server's read of the arguments finds no row and refuses the run,
  `refused` (51737); PostgreSQL's call statement finds fewer rows than
  were locked, and answers `schema-changed`, as 0160's does for one
  record, after calling the routine over the others. Nothing is kept on
  either. SQL Server's is a case of its suite; PostgreSQL's is reasoned
  from its code.
- **A refusal about records carries `records`** for the open record's
  action too, and an action's audit event over a selection a key no other
  event has, which a client or a collector that holds every body or event
  to one shape meets.
- **Only a client that writes its own generation request publishes a
  selection**, and only `@formancy/data-client` or a page an integrator
  writes runs one: the studio binds the open record's scope and the host
  page offers no selection, until the next record.
- **A server older than 0165 refuses every version whose generation
  request names a selection**, as it refuses every scope it does not run.
- **The fixtures grew**: SQL Server's actions schema a tag table keyed by
  text under a case-insensitive collation and a procedure over it;
  close_order on both engines refuses an order of amount 66.60 and,
  noted 'raise others', raises the amount of its customer's other orders,
  and on SQL Server, noted 'drop others', deletes them.

**What it does not do.** No choice of rows on the host page, no scope in
the studio, no preview and no check routine. A selection is never split
or retried, and never run in part but where a SQL Server procedure ends
the transaction, above.

**Forecloses:** nothing.

## Alternatives considered

**The open record's scope alone**, a page looping one run per record.
Lost: each record a transaction of its own and a write id of its own, so
a selection could end half done, with half its answers unknown, which
0079's "made whole or not at all" refuses for a file and this refuses for
a run.

**A set-level call**, every key passed to the routine at once -- an array
on PostgreSQL, a table-valued parameter on SQL Server. Lost: the engines
spell it two ways, SQL Server's needs a user type the deployment creates,
the routine's contract changes from one record to a set, and a field
passed from each record's own locked row, read under the person's
grants, has no place in it.

**One transaction per record, partial success.** Lost: a person would
read which records ran and which did not, and run the rest again, where
one answer about the selection is what they asked for; and an unknown
outcome would be one per record.

**SQL Server ordered by the index**, an ordering read of the rows before
the UPDATEs and a loop over a table variable in the column's collation.
Lost: a read before any lock, waiting under the lock timeout on rows it
does not lock, a WHILE loop and a dispatch of one UPDATE per record, and
a collation no snapshot records to declare the table variable in; the
adapter's own order is one for every run over rows spelled as reads
spell them, which is the order that matters.

**One UPDATE for every record on SQL Server**, as PostgreSQL's one
statement. Lost: SQL Server does not promise the order one UPDATE locks
the rows it finds, and two such runs over overlapping selections could
deadlock on them.

**The collation's duplicates found before the lock**, by a read of each
key's row. Lost: it would read rows not yet locked, wait on another's
lock, and tell a person that two of their keys name one row outside
their filters, which a read inside them would not say.

## Older records

Extended, not edited away: 0015 (a run bounded to one page of records,
not one); 0023 (a selection's event names every record by its keyed
hash); 0031 (a lost selection names every record with its version);
0079 (made whole or not at all, applied to a run); 0159 (the scope `selection`,
bound by the generator); 0160 (both adapters run a selection, locked in
key order, all or nothing); and 0161 (the route takes a page of records
for a selection, names a refusal's records and trails every record).
