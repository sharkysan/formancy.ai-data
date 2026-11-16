# 0155 — A record's rows may be saved with it, in one transaction guarded by its version and checked as a whole

- **Status:** accepted
- **Date:** 2026-11-15
- **Deciders:** Daniel Bacher
- **Verified by:** what data-core plans and what both adapters run, the
  parts of this decision built so far; each later part extends this line
  when it lands.
  `packages/data-core/src/records/save.test.ts` -- the record's step is
  planned under the order's policy and each line's under the line's, and a
  person one of them refuses is refused at that part (watched failing with
  every part planned under the order's policy: the save was refused
  `invalid-policy`); the record's and every row's field errors come at
  once, each at its part (watched failing with the record's answered
  alone); every child carries the order's key as its pin -- what each
  located statement and its explaining read do with it is the adapters'
  save's to show -- and a line the order's list does not hold is
  `not-found` at its part (watched failing with the pin left empty, and
  with the list unasked); a row's answers that are not an object are
  refused as an update alone refuses them, and the row's own listed
  spelling of the order's field is an echo (watched failing with the field
  looked up before the answers were read -- a TypeError -- and with the
  listed spelling not compared); the field that names the order is
  supplied on create, never required, and over-posting when sent there,
  dropped on an update when it is the order's own token and over-posting
  otherwise (watched failing with its columns not supplied -- "order: A
  value is required." -- and with the field passed on to the update as
  sent); `within` is the line lookup's filter for a create, once per child
  that creates rows, and holds a note's customer to the clerk's tenant
  through the note lookup's filter, a policy without that filter refused
  (watched failing with it planned for every child, and with no filter);
  the key is bound where it is known -- a saved order's token, a
  customer's pinned tenant and typed number -- and taken from the record's
  step only where the database numbers it, and a key a default fills that
  may repeat is refused (watched failing with every key taken from the
  step, and with every key the insert does not write taken from it); an
  empty record patch with rows changed is a touch on the confirmed touch
  column, a version column's `touch: null`, unavailable on a rowversion
  without one, and with no row changed `nothing-to-update` (watched
  failing with the patch planned as alone, and with the touch column not
  required), and refused where a row filter pins the touch column (watched
  failing with the row filters unasked); a touch stamps nothing, where an
  update of the record stamps who and when (watched failing with the touch
  stamped as an update); only changed children are counted or refused for
  their bound, a list above `max` refuses a change, and a new record is
  held to its bounds and to every child that requires rows of it before
  any statement, a create naming the children that require its rows, `[]`
  for none, as its type requires (watched failing with unchanged children
  kept, with a new record's creates not counted, and with the required
  children unasked); the steps run record, then each child in codepoint
  order with its `within`, deletes, updates and creates, then the counts
  (watched failing with the body's order kept, and with creates before
  deletes); a child saved through any field but its together one, a child
  named twice, a record whose own rows are saved with another, one no
  token addresses and one of a form over versions are refused (watched
  failing with each check taken out); a deadline that is not a whole
  number of milliseconds throws (watched failing with it unchecked); and a
  record's rows are listed with `max + 1`, at the largest `max` a list
  `listTerms` takes and at no larger (watched failing with `max`, and with
  `max` unbounded).
  `packages/data-core/src/records/together.test.ts` -- `offeredFor`
  refuses a together child's create, delete and change from a date alone
  and keeps its update, offers only through its together field in a save,
  and the planners and the menu's operations ask it (watched failing with
  `offers()` asked alone, and with the save's field not compared);
  bindings no save can hold -- two together lookups, bounds that are not
  whole or ordered, a field written on update, a foreign key that can be
  NULL, onto the form's own table, a section, a form over versions, row
  security, a `max` past `TOGETHER_MAX_ROWS` -- and a touch column no
  touch can set are refused before anything is planned (watched failing
  with `togetherProblem` unasked, with its NULL check taken out, with the
  cap taken out, and with the touch column unchecked); `rowsRequired`
  finds a requiring child from the bundles alone, a min of 0, another
  connection or a plain lookup requiring nothing (watched failing with a
  min of 0 counted); `TogetherChild`'s flags follow the child's create,
  update and delete and the parent's create, update and touch column, a
  touch column a row filter pins turning `saved` off and a key a repeating
  default fills turning `created` off, and all are off for a parent that
  cannot carry a save, one no token addresses and one over versions
  included (watched failing with the parent's update, then its touch
  column, left out, and with each of the rest unasked); a SQL Server save
  of several together children holds the lines whose parameters, 10 a line
  change, 9 a child and 17 for the order's step, fit 2,100 and not one
  line more, where PostgreSQL has no such limit (watched failing with the
  batch's sum unasked, with each child's count and `within` left out of
  it, and with the pin left out of a row's parameters); and a row's delete
  reach and its stamps of who add to what it binds (watched failing with
  each left out).
  `packages/data-core/src/records/menu.test.ts` -- the menu leaves out the
  create of an order whose lines are required exactly where the person
  could not make the save: the line form is not their child of the order,
  or they may not create its rows in one; a min of 0 or another connection
  leaves it in, and the line form lists no create alone (watched failing
  with no narrowing, with the child's being shown unasked, with an unread
  child's together lookup not read, and with the operations asked of
  `offers()`); and a customer whose number a repeating default fills is
  offered no create while its notes are required (watched failing with the
  key unasked).
  The engine facts the decision rests on are held by
  `packages/data-postgres/src/save-facts.integration.test.ts` and
  `packages/data-sqlserver/src/save-facts.integration.test.ts`, each case
  watched failing with its opposite asserted, on the default images.
  What both adapters run is held by the shared cases of `SAVE_PARITY`
  (`packages/data-fixtures/src/saves.ts`), asserted on each engine through
  `covers()` by `packages/data-postgres/src/save.integration.test.ts`
  and `packages/data-sqlserver/src/save.integration.test.ts`, each case
  watched failing with its rule taken out, on postgres:17-alpine and
  mcr.microsoft.com/mssql/server:2022-latest, its comment quoting the run:
  every change committed, on a new order whose key the database numbers
  (watched failing with that key read wrong, a NULL on SQL Server), on an
  account whose code is typed (with a known key bound as NULL) and on a
  saved order (with the deletes not run); a save of rows alone moving the
  order's version (with the touch taken out); the order read back as a
  line's trigger left it (with it answered from its own step, or read back
  before its rows); a delete and a create of one number (with the creates
  first); a refusal at the order, at `within` and at the first, middle and
  last line rolling everything back (with the refusal dropped, `within`
  unasked, and every step its own transaction); a stale order and a stale
  row (with each version guard out); another order's line `not-found`, by
  its update or delete and by the read that explains it (with the pin out
  of each, one at a time); a duplicate line refused at its step with its
  constraint (with a step's refusal answered at the save); a moved
  definition of the lines' table (with the guard out); the bounds at and
  past them, bound and never written into a statement (with `max + 1`,
  with `min` unasked, with the limit spliced and with bounds that are not
  whole let through); a lock not waited for past the deadline (with no
  lock timeout) and a save stopped between statements past it (with the
  deadline's checks out); and two saves of one order at once, one stored
  and one `stale` (with the touch out: both stored on PostgreSQL and on
  SQL Server under READ_COMMITTED_SNAPSHOT, and under SQL Server's locking
  READ COMMITTED the two counts deadlocked, one chosen to lose). On
  PostgreSQL alone, REPEATABLE READ's snapshot taken after the save's LOCK
  (with the timeouts set by a SELECT). On SQL Server alone, a text not
  stored as sent rolling the save back (with the text checks out), a
  trigger that commits in a step `unknown-outcome`, the save stored in
  part (with 3609 answered as a refusal), every batch within
  `saveParameters`' prediction (with two values more bound for every
  step), a batch past 2,100 parameters refused unsent (with the guard out,
  which SQL Server then refused itself), and a rowversion order's touch
  (with its version guard out). Each adapter's
  `save-lost-answer.integration.test.ts` -- a save whose answer the TCP hop
  dropped `unknown-outcome`, sent once (with the adapter sending it again),
  a save sent again `stale` (with the version guard out), and on
  PostgreSQL a COMMIT a deferred key refused answered as that refusal with
  nothing stored (with it answered as a lost connection). Each adapter's
  `save-sized.integration.test.ts` -- a save's round trips (with a
  statement more per line on PostgreSQL, one more before the batch on SQL
  Server) and a save of `SAVE_MAX_ROWS` lines stored within the default
  deadline (with a deadline of 1 ms). `together.test.ts` -- the cap the
  fewer of a page less one and `SAVE_MAX_ROWS` (with `SAVE_MAX_ROWS` at 10
  and the cap the page's alone).

## Context

A record operation is one guarded statement, and 0015 forecloses
"Automatic retries of writes, and bulk writes, in this port"; the two
exceptions are a change from a date (0113) and a file of records (0079).
The plan this repository started from answers "Scope expands to an entire
low-code platform" with "One root record per form; defer nested writes and
workflows" (section 20). That is a working default, not a record, so this
one says it reverses it, for together children alone.

So an order cannot be held to at least one line, and an order and its
lines cannot be stored together: a failed third line leaves the order and
two lines stored. A child is derived from two bundles and declared in
neither (0045); each child row opens in its own form with its own Save.

The engine facts a save would rest on were measured before anything was
decided, by `packages/data-postgres/src/save-facts.integration.test.ts`
and `packages/data-sqlserver/src/save-facts.integration.test.ts`, and held
on the default images (PostgreSQL 17.11, SQL Server 2022 CU27): a
rowversion table's `set c = c` moves the rowversion, fires AFTER UPDATE
triggers with `UPDATE(c)` true; `SET LOCK_TIMEOUT` inside `sp_executesql`
ends with the request; under REPEATABLE READ, `SET LOCAL` and `LOCK TABLE`
take no snapshot; a `FOR NO KEY UPDATE` that waited on a holder that only
locked is not rolled back, and its count misses the holder's rows; and two
transactions that each move a parent's version and then count are
serialised, the second finding no row to move, or, on PostgreSQL under
REPEATABLE READ, refused 40001. One fact cost more than
assumed: on PostgreSQL's locked path, `LOCK … IN ROW EXCLUSIVE MODE` on
the record's table is refused, 42501, to an account granted UPDATE on the
version column alone; it needs a grant to write the table, as 0041
already records for that path.

## Decision

**A child form's lookup onto its parent may be saved with its parent**,
by an administrator's choice, for the rows' creates and their edits
alike. The generation request's lookup choice carries
`together: { min, max }`, and the binding carries it, as 0109's `section`
is; the field is written on create only. The bounds are whole numbers,
`0 <= min <= max`, and `max` is at least 1 and at most
`TOGETHER_MAX_ROWS`, one row less than a list's page: a save over a saved
record is planned from one page of its rows (`planSaveList`), which no
adapter reads past `LIST_PAGE_SIZE`. The cap is derived, not measured;
the adapters' save is to measure how many rows one save can hold, which
may lower it. For a rowversion parent the request confirms a
`touchColumn`, kept as `ConcurrencyBinding.touch`. Neither is ever
inferred. A record and its together children's rows are then created and
changed in one save: the record, a create or an update that may change
nothing, and each child's creates, updates and deletes.

**The record's version moves on every save.** A save over a saved record
updates it, or, where its own answers change nothing, touches it: a
version column incremented, a rowversion's touch column set to itself. The
version the person read guards it, so that one row lock serialises every
save of the record's rows, a resend of the same save is `stale`, and one
read of the record reconciles a lost answer.

**A together child's rows are updated alone, and never created or deleted
alone.** `offeredFor(bindings, operation, scope)` is what a form offers
alone (`null`) and in a save (`{ save: field }`); the menu, the form
route and the planners ask it. A record whose rows a together child
requires -- `min` of 1 or more -- is to have no plain create:
`rowsRequired` finds such a child from the bundles alone, the menu leaves
the create out now (`formMenu`), and the create route will refuse one.

**data-core plans the save, and both adapters run it.** `planSave`
(`packages/data-core/src/records/save.ts`, one child's steps in
`save-steps.ts`, the adapters' request in `save-types.ts`, the wire shapes
in `packages/data-core/src/save.ts`) plans every part with today's
planners, under its own form's policy, in the save's scope:

- the record's step first: an insert, an update, or the touch;
- each child the save changes, in codepoint order of form and field: its
  `within` where it creates rows -- the record under the child's lookup
  filter for a create, which 0043's membership check would ask -- then its
  deletes, its updates and its creates, every one pinned to the record's
  key through the child's foreign key: bound where the key is known, taken
  from the record's step only where the database numbers it;
- each child's count, under its read filters and throughs, held to `min`
  and `max`;
- the record read back by its key, and the configured deadline.

It answers every part's field errors at once; a part's other refusal
alone, at its part; a row the record's list does not hold `not-found`; a
list already above `max`, or a new record's creates outside its bounds or
without a child that requires rows of it, before any statement.
`planSaveList` is the list a save is planned over, with `max + 1` rows.

`RecordAdapter.save` runs the request as one transaction, never sent
twice. On PostgreSQL it is one `sql.begin` on the path the record's
definition chooses (0041), the locked one under any isolation but READ
COMMITTED or where a delete reaches past its root (0051): `SET LOCAL`
lock and statement timeouts of the deadline, on the locked path one
`LOCK … IN ROW EXCLUSIVE MODE` of every table it writes, then each step
as today's statement, the deadline checked before each and before COMMIT.
On SQL Server it is one batch that owns its transaction: `set
lock_timeout` of the deadline, each step followed by the checks a write
alone's batch carries -- shared functions (`batch-steps.ts`), the
definition's and the INSTEAD OF guard after the first step on each table
only, since that step's IX lock keeps an ALTER and a new trigger out to
the end -- the deadline checked in the batch before each step, and CATCH
recording the step it stopped at with SQL Server's own number, translated
by the rule a single write's refusal is. Each child's pin is added to the
WHERE that locates each of its rows and to the read that explains one that
changed nothing, and written into each create. A step that changes
nothing, a `within` that is false and a count outside its bounds stop the
save and roll it back; the first is then explained, outside the
transaction, by the read a write alone asks. The bounds and the limit of
each count are bound; only the timeouts are spliced, from the deadline's
whole number. `SAVE_MAX_ROWS` and `DEFAULT_SAVE_DEADLINE_MS`
(`packages/data-core/src/records/save-limits.ts`) are measured, by the
adapters' sized suites, and `TOGETHER_MAX_ROWS` is the fewer of a page
less one and `SAVE_MAX_ROWS`.

**A child's pinned column is held through its lookup's filter.** A
column of a child's foreign key onto the record that the child's policy
pins to the context is written in a save from the record's key, not from
the context. The policy's fit already refuses a policy that pins a column
a lookup sets unless that lookup's filter pins the target's column to the
same attribute, so `within` -- the record under that filter -- holds the
record's value there to the context's, as a selection of another
tenant's record is not an option when a row is created alone. Nothing
compares the two again at plan time.

**The menu narrows the parent's create; the flags wait for
`FormMenuChild.together`.** `togetherChildren` gives each together
child's `TogetherChild` for one person: in a save that creates the
record, the child's create with the parent's create and a key the save
can know before the rows' statements, every key column written or
numbered by the database (`newKeyPart`, which the planner asks too); in
one over a saved record, each of the child's writes with the parent's
update and a touch, which a row filter on the touch column rules out
(`pinsTouch`, likewise). On SQL Server every flag is off where the
parent's step and every together child's `max` rows do not fit one batch
of 2,100 parameters, by `saveParameters`, a prediction of the batch the
adapter will build. `formMenu` leaves out a parent's create where the
person could not make the save; nothing sends the flags yet.

**Later parts of the decision**, each its own pull request: the generator's `together` and
`touchColumn`, the bundle check's comparison of both and its refusal of a
child read policy that narrows by anything but the together key; `POST
/v1/forms/:id/records/save`, its audit event and `sendOnce`'s `save`
(0023, 0031); the create route's refusal of a plain create where
`rowsRequired` finds a child, and the form route's matching narrowing of
`create`, which `grantedOperations` alone does not make;
`FormMenuChild.together` and `PublishedForm.together`; the host page's
pending rows and one Save; and the studio's controls. Until they land no
published form changes behaviour: nothing generates `together`, and the
bundle check refuses a stored request that carries it, as not in its
normalised form.

## Consequences

What it buys: an order held to at least one line and at most `max`, and
an order and its lines stored together or not at all, on both engines,
for the children an administrator chooses; every other child keeps its
per-row saves.

What it costs, and what it does not do:

- **Two people saving different lines of one order at once.** Today both
  succeed. Here the second is `stale`. Where it changed only lines, "Keep
  my line changes" and Save store them, each line still guarded by its own
  version; where it also changed the order's own fields, Load discards
  them.
- **The record's version moves on every save of its rows.** Someone
  editing the record's own fields at the same time gets `stale`. The
  person saving rows needs the record's `update` in the policy and the
  database's UPDATE on its version column, or on a rowversion table's
  touch column. On PostgreSQL's locked path, any isolation but READ
  COMMITTED, the save's `LOCK … IN ROW EXCLUSIVE MODE` needs a grant to
  write the record's table: UPDATE on the version column alone is refused,
  42501, as measured before this was decided. The record's UPDATE triggers
  fire on a save of rows alone, and a `rowversion` parent needs an
  administrator to confirm a touch column before its rows can be saved
  over a saved record.
- **A touch stamps nothing.** A save of rows alone moves the record's
  version and writes none of its columns but the touch column, so a
  column the server stamps on update (0153) does not say who saved the
  rows, or when.
- **The record's own step runs first.** Its triggers see the rows as they
  were; a trigger on the order that totals or checks its lines sees the
  old set, and a line's trigger that updates the order runs after it.
- **The bound is held for these two forms' writes, not the database's.** A
  writer outside the module, or a trigger, can leave a record outside it.
  A second published form over the child's table, without `together`,
  creates and deletes rows one at a time: nothing relates two forms over
  one table. Another form's delete whose reach (0051) removes or clears
  the child's rows never touches the record's version. An older server
  reading the same store serves no together child, but can still create
  its parent alone.
- **A together child's read policy may narrow only by the record its rows
  belong to.** A row filter outside the together foreign key, a through by
  another field, or row security on the child table refuse `together`; a
  multi-tenant child whose tenant column is not part of its foreign key
  onto the record cannot be together.
- **A record whose rows are required is not to be created alone**: the
  menu leaves its create out now, the create route will refuse one, and
  every plain create of every form will read every published form to find
  out, as the menu does.
- **A key the database fills by a default that can repeat**, one
  `numbersKey` does not count, cannot be known before the rows'
  statements: such a record is created with no rows saved with it, and
  where its rows are required, is offered no create at all.
- **All or nothing, except on SQL Server**, where a trigger that ends the
  transaction can store a save in part, answered `unknown-outcome`.
- **A together child cannot be created or deleted row by row**, through
  the page or the API; its own form updates rows, and integrators use the
  save for the rest.
- **Bounds, one level and the excluded forms.** A record holds at most
  `max` rows of a together child through the form, rows above it
  read-only until reduced elsewhere, and `max` is at most one row less
  than a list's page; two rows swapping a unique value in one save
  fail, each statement checked as it runs; a save holds one record and its
  direct together children; sections (0109), trees (0110) and forms over
  versions (0113) are not together.
- **SQL Server's 2,100 parameters** bound a save: refused in the menu for
  the parent and its children together, by a prediction every batch the
  SQL Server suite builds stays within, and refused by the adapter before
  it sends a batch past it; so a parent republished with more fields can
  turn a working together tab read-only. The limit is Microsoft's documented
  figure, not measured here.
- **Locks, round trips and the deadline.** A save holds its record's row,
  and every row it writes, for its transaction; before it, one read, one
  list per changed child and one membership check per selection. The
  deadline bounds each statement, not the transaction: a save holds its
  locks for less than twice it, and a SQL Server statement slow for
  another reason than a lock runs into mssql's request timeout and is
  `unknown-outcome`. A save on SQL Server is one batch, which SQL Server
  compiles the first time it sees it: measured, the first save of a size
  took seconds where one that reused its plan took a fraction of one, a
  compile the deadline does not bound and mssql's request timeout does,
  and 500 lines did not answer within it; `SAVE_MAX_ROWS` is set below
  that (save-limits.ts says on what and when).
- **The audit trail** will name the record and count the rows, never which.
- **Built in part.** The plan and both adapters' save are built; until the
  route lands nothing calls `RecordAdapter.save` but the suites, and the
  limits were measured on one workstation, not on the CI runner, which
  holds only that a save of `SAVE_MAX_ROWS` lines is stored within the
  default deadline.

## Alternatives considered

- **Defer**: keep 0015's foreclosure and the
  plan's default. An order can still be stored without lines, and a failed
  third line leaves two stored.
- **Creates first**: a new record stored with its rows in one
  transaction, the bound checked then, later edits per row. It needs no
  version move, no touch column and no serialisation, since nobody else
  sees a record before it commits; but the bound would be true at creation
  only, and a page would edit one child two ways.
- **Lock the record's row without moving its version.** No `stale`
  between people saving different lines, and
  no touch column. But under PostgreSQL's REPEATABLE READ the lock does not
  make the count see a save that committed while it waited -- measured: the
  waiter is not rolled back and its count misses the holder's rows -- so
  the version would have to move under that isolation anyway, a second
  rule. A lost save of rows alone would be reconciled row by row, a
  numbered create unverifiable, and a resend reaching another process
  would store its new rows twice.
- **No per-row writes at all**: its own form
  read-only. Not taken: the together field is written on create only and
  the read policy narrows only by it, so an update alone can move no row
  out of a bound, and a line's quantity is still changed by itself, from
  the API and Drill down's habits, without moving the order's version.
- **Every per-row write allowed**, the bound checked only in
  saves: a per-row create or delete would skip it.
- **Per-row saves with a bound checked after each.** No atomicity: an
  order is briefly without lines, and a failed third line leaves two.
- **The children as a repeater in the parent's document.** Another table's
  columns in the parent's bindings, repeater rows given tokens and versions
  the spec does not carry, and the child's policy restated in the parent.
- **Count without serialising.** Two saves at once each pass their count,
  and the bound is exceeded.
- **Reorder the steps** -- lock and check the record, then the rows, then
  its update or touch. A create must still go first, so creates and
  updates would differ, and an update moved last would need its version
  read again, since a line's trigger can move a rowversion first.
- **Answer the record from its step's returning.** SQL Server's OUTPUT
  predates the AFTER triggers, so a total a line's trigger keeps would be
  answered stale beside a new version.
- **A database constraint, trigger or idempotency table made by the
  module.** It changes the customer's schema, which the plan rules out;
  the record's version makes an idempotency key unneeded over a saved
  record.
- **One statement of data-modifying CTEs on PostgreSQL.** Every CTE reads
  one snapshot, so a count cannot see the rows the save writes.
- **Requests on an `mssql.Transaction`.** A round trip per step with locks
  held between them, an isolation setting whose life on a pooled
  connection is not checked, and a batch whose trigger checks assume it
  owns its transaction.
- **A transaction held open across HTTP requests.** A lock held while a
  person thinks, which 0015 rejected.
- **Stopping a save on abandonment.** The browser's own resend (0031)
  would be answered "not saved".
- **Counting every row that references the record, ignoring the read
  policy.** A refusal would disclose rows outside the person's read scope
  (0012, 0015); limiting the read policy makes the two counts one.
- **The bound in the policy, or in the parent's bundle.** The first is not
  a "who may"; the second needs a reference across bundles, which would
  dangle once a form is unpublished.
- **The together child's operations written off by the generator.** The
  policy's fit would then refuse every grant a save needs; `offeredFor`
  tells a write alone from one in a save.
- **A touch that stamps.** A save of rows alone could stamp the record's
  who and when as changed; not taken, so a touch writes no field and the
  record's own fields keep saying who last changed them.
- **The pin on every row's request**, `parent` on each update and delete
  rather than once on the child. Two copies of one value per child, which
  could disagree, and no type can make an adapter apply either; the
  adapters' save holds it, by a row of another record that is `not-found`.
- **A plan-time comparison of the record's key with the child's pins.** A
  second rule beside the policy's fit and `within`, which hold it already.
- **A `max` past one list page**, read over several pages. A save would be
  planned from rows read by several statements, which another writer can
  move between, and no measurement says a save of that many rows fits its
  deadline.

