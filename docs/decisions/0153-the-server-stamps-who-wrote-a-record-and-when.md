# 0153 — The server stamps who wrote a record, and when

- **Status:** accepted
- **Date:** 2026-11-15
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/generate/stamps.test.ts` -- the stamps a request
  confirms are kept in catalog order with their columns' types, each
  stamped column a field shown and never written, in the Record section,
  never required, with a note that says what fills it and when, and a NOT
  NULL creator stops no create (watched failing with the stamp left out of
  the field's `possible`: every stamped field was written on create and
  update, and created_by was a required input); a request without stamps
  generates as before, no `stamps` in its bindings; a stamp whose column
  the account may not write stops the write that stamps it, in a note
  (watched failing with `unstampable` unasked: both writes were offered);
  and every stamp no write could honour is refused, naming its column --
  one the root lacks, one stamped twice, a malformed one, a person into a
  number, the time into text or into a time of day, a generated column, a
  key, a pinned column, a lookup's, a chain's, a view's (watched failing
  with the time's type check, the pin check and the key check each taken
  out).
  `packages/data-core/src/records/plan-stamps.test.ts` -- a create writes
  the actor's id and the named attribute as values through their columns'
  codecs and the time stamps as the clock columns, and asks no stamped
  column of the answers (watched failing with the stamped columns not
  supplied: "created_by: A value is required.", and with the stamps left
  out of the values); a submitted stamp is over-posting with the stamp as
  its reason (watched failing with the reason taken out); an attribute the
  context lacks is `missing-attribute`, an id longer than its column
  `unstampable`, naming the column (watched failing with the codec
  skipped); an update restamps what it stamps and nothing of the create's,
  and an update that changes nothing is still `nothing-to-update` (watched
  failing with the create's stamps planned on update); a read and an
  update are filtered by the tenant alone; the fields a page sends and a
  copy carries name no stamp (watched failing with the stamped fields
  generated writable); a row filter on a stamped column is refused
  (watched failing with the check taken out); bindings a hand edit changed
  are refused before anything is planned (watched failing with
  `stampsProblem` unasked); and the next version of a chain is stamped as a
  create (watched failing with its stamps left out).
  `packages/data-core/src/drift/stamps.test.ts` -- a stamped column gone
  stops the writes it is stamped on, with or without a field (watched
  failing with the stamp unasked: a note, and every create left to the
  database to refuse); narrowed under a stamp of who, it stops them, and
  the runtime refuses those writes and allows the others (watched failing
  with `stampStops` unasked); a stamp of the time narrowed to less
  precision, or to NOT NULL, stops nothing (watched failing with every
  narrowing stopping); a revoked grant stops the write it stamps (watched
  failing with the stamp unasked: update stayed offered).
  `packages/data-postgres/src/records/stamps.test.ts` and
  `packages/data-sqlserver/src/records/stamps.test.ts` -- each engine's clock
  is fixed SQL in the statement, the stamped column quoted and no time
  bound as a parameter (watched failing with `localtimestamp` for
  PostgreSQL's wall clock, with `sysdatetimeoffset()` for SQL Server's
  instant, with the clock columns left out of PostgreSQL's insert and with
  SQL Server's batch reading no `@now`).
  `packages/data-postgres/src/stamps.integration.test.ts` and
  `packages/data-sqlserver/src/stamps.integration.test.ts`, against real
  servers -- `STAMP_PARITY`'s `created`, `updated`, `clock`, `utc`,
  `rounded` and `superseded`, declared with `covers()`: who from the
  context, the time between the engine's own clock read before and after,
  the instant's place against a default of the engine's clock, its offset,
  the wall clock and the day in UTC, `logged_at` within half its column's
  unit, and a change from a date stamping its next version only (to be
  watched failing in CI with the clock left out of each statement --
  23502 and 515, NOT NULL -- with `clockSql` reading PostgreSQL's session
  zone under the owner's Pacific/Chatham session, and with SQL Server's
  instant stamped by `sysdatetimeoffset()`).
  `packages/data-server/src/routes/runtime-stamps.integration.test.ts`, on
  both engines through the runtime plane -- the form proposed with its
  stamps and published; Alice's create stores her id and site and the
  database's time; a stamp in a body is 403 `over-posting`; Bob's update
  restamps who changed it and keeps who created it; an echo of a stamp
  changed is refused; Carol reads what Alice created; an id the column
  cannot hold is 403 `unstampable` and a token without the attribute 403
  `missing-attribute` (to be watched failing in CI with the stamps left out
  of the insert, which the database refuses).
  `packages/data-server/src/bundle.test.ts` -- a stored request's stamps
  are its bindings' exactly, in any order, read as strictly as the rest of
  it (watched failing with the stamps left out of the comparison, and with
  `stamps` not read, which refused the stored request as not normalised);
  a stamp the generator refuses is refused at publish in its words
  (watched failing with the generator's check taken out).
  `packages/data-fixtures/src/load.test.ts` and `cases.test.ts` -- both
  parity editions create `audited` and `audited_price`, and
  `STAMP_PARITY`'s cases are shared cases (watched failing before the
  table list and the family were named).
  `apps/studio/src/choose-stamps.test.tsx` -- the Choose step offers each
  column a stamp can take, the ones an audit name suggests first and said,
  all unticked; generated so, nothing is stamped; ticked, the stamp is in
  the request and the generator binds it, every control named and axe
  clean (watched failing with the stamps left out of the request); an
  attribute without a name and a column pinned and stamped are said before
  anything is sent (watched failing with the stamps unasked); an integer
  created_by is neither offered nor suggested (watched failing with the
  candidates asked of nothing but the key, and with the suggestion asked of
  the name alone); and a published form generated again keeps its stamp
  ticked (watched failing with the stamps left out of the draft taken up).

## Context

Tables carry audit columns -- `created_by`, `created_at`, `changed_by`,
`changed_at` -- that the application, not the person, fills. A generated
form offered them as inputs, so a person could type somebody else's name,
or left them to the database's defaults, which know the time but not who
is signed in to the host: the module writes as one account for everybody
(0011). A row filter writes a column from the context on create (0011),
but it also filters every read and update by it, so a `created_by` pinned
so would show each person only what they created.

The verified context already holds who is asking: the actor's id, the
token's subject, and the attributes the host maps (0014, 0091). The
planner is where a request meets the policy, the codecs and the bindings
(0018), and data-core reads no clock (formancy.ai 0019). A version column
is confirmed by an administrator because one that merely looks like one is
how a lost update happens (0009); a column that merely looks like an audit
column is the same kind of guess.

## Decision

**The administrator names each stamp in the generation request**:
`stamps`, a list of `{ column, value, on }` -- `value` the actor's id
(`{ kind: 'actor' }`), a named attribute of the verified context
(`{ kind: 'attribute', attribute }`) or the time (`{ kind: 'time' }`), and
`on` `create`, `update` or `both`. In the request, so a regeneration keeps
it and the bundle check recomputes the base (0030); the bindings keep each
with its column's type (`FormBindings.stamps`), absent where none is, so
every form published before compares equal to its regeneration.
`readGeneration` reads it as strictly as the rest, so a server older than
this one refuses a stored request that stamps.

**The generator holds each stamp to what it can be**
(`packages/data-core/src/generate/stamps.ts`): a person into text only,
since the context's id and attributes are text; the time into a timestamp,
with or without a zone, or a date, never a time of day; never a column the
database generates, the record's key, the version column, a pinned
column, a lookup's or a chain's (0113), and nothing of a view. Each refusal
throws, naming the column. The stamped column's field is shown and never
written -- in the Record section, never required, with a note saying what
fills it and when -- and a NOT NULL one stops no create, since the server
gives it its value. A stamp whose column the account may not INSERT, or
UPDATE, stops the write that stamps it with a note, as a pinned column does
(0027). `prepare` asks the same rules of a bindings file, and
`validatePolicy` refuses a row filter on a stamped column: a stamp filters
nothing, so whoever may read sees the records others wrote.

**Who is the verified context, bound as a parameter**
(`records/stamps.ts`): the actor's id or the attribute, through the
column's codec, beside the pinned tenant among the insert's values or the
update's SET. An attribute the context lacks is `missing-attribute`; a
value the column cannot hold -- an id longer than it, text it refuses --
is `unstampable`, 403, naming the column and never the value, and is never
cut to fit.

**When is the database's clock, in the statement itself**, as fixed SQL:
the request carries the column and its type (`ClockColumn`), never a time.
One source of truth with the columns' own defaults, no clock in data-core,
and nothing of a request in the SQL but the column's quoted name. Each
engine's expression is written in its adapter, and where they differ the
difference is named there and in `STAMP_PARITY`:

- **PostgreSQL** (`records/sql.ts`, `clockSql`): `current_timestamp` for an
  instant -- SQL syntax no search path can shadow, and the transaction's
  start, which a `now()` default in the same statement takes too: the two
  are one instant. A wall clock is `(current_timestamp at time zone 'UTC')`
  and a day that cast to `pg_catalog.date`, both UTC's whatever the
  session's TimeZone.
- **SQL Server** (`records/statements.ts`, `clockSql`): the write's batch
  reads `sysutcdatetime()` once into `@now datetime2(7)`, before the
  statement, and every stamp of the write is that reading: an instant
  `todatetimeoffset(@now, 0)`, stored at +00:00 whatever the server's own
  zone; a wall clock `@now`; a day `convert(date, @now)`. A
  `sysdatetimeoffset()` default reads its own clock as the insert runs, so
  a stamp is not later than it, where PostgreSQL's equals it; and
  `sysutcdatetime()` and `sysdatetimeoffset()` are readings of their own,
  so a reading per column would not promise one instant.
- **Precision** is the column's: each engine rounds the instant assigned to
  a column of less, PostgreSQL's timestamp(3) to the millisecond and SQL
  Server's datetime to 1/300 s, whose nearest is within 1667 microseconds.

**The write stays one guarded statement** (0015): the stamps are part of
the INSERT, of the UPDATE's SET beside the version column moved by one
(0011, 0050), and of the next version a change from a date inserts, which
is stamped as a create; the version it ends is not stamped again -- its
end is the next one's start, whose stamps say who wrote it and when. An
update that changes nothing the person sent is still `nothing-to-update`:
the stamps say who changed a record, and are no change of their own.

**The browser never supplies one.** A stamped field writes on no
operation, so the over-posting check refuses a value for it, with the
stamp as the reason; the fields a page sends (0117) and a copy carries
(0107) are that check's, and name none; the echo the runtime removes (0022,
0098) is removed of a stamp as of any field the person may not write.

**Drift treats a stamp as a write of its column** (0010): gone, it stops
the writes it is stamped on, with or without a field; retyped, now
generated, or narrowed under a stamp of who, it stops them; a stamp of the
time narrowed to less precision, or to NOT NULL, stops nothing, since the
time still fits and a stamp is never NULL; a revoked grant stops the write
it stamps. The runtime refuses what review stops (0041).

**The studio's Choose step offers the stamps**
(`apps/studio/src/choose-stamps.tsx`): every column a stamp can take, with
a box, unticked. One whose name is an audit column's --
`created_`, `changed_`, `updated_` or `modified_` with `_by`, `_at`, `_on`
or `_date`, in any case, where its kind can take it -- comes first, says
what its name suggests, and starts with it once ticked: who or when, on
create for `created_` and on both for the others. A name is never a stamp.

## Consequences

An audit column is filled by the server from what the host verified,
never typed, and stays readable by everybody the policy lets read.

What it costs:

- **A wall clock and a day are UTC's**, on both engines, whatever the
  server's zone. A table whose defaults or other writers use local time
  disagrees with a stamp by the zone's offset, and a stamp of the day is
  the day in UTC, not the business's day: an order changed at 00:30 in
  Zurich is stamped the day before.
- **PostgreSQL's stamp is the transaction's start.** On the path that locks
  the table first (0041), it is the time the transaction began, before the
  wait for the lock; SQL Server's reading is the batch's start, before its
  locks too. A stamp says when the write was asked for, to within the wait.
- **SQL Server stores an instant at +00:00**, where a `sysdatetimeoffset()`
  default beside it stores the server's offset: one instant, two spellings
  in the table. The API reads either in UTC.
- **Only writes through this module are stamped.** Nothing here is a
  trigger: another application, a script or a person in the database's own
  tool writes what they write, and a `changed_by` they leave is stale.
- **Who is the token's subject as the host issues it.** A person renamed
  in the host is somebody else from then on; nothing stored is updated.
- **A column that refers to a person by number cannot be stamped**: an
  integer `created_by` that references a users table needs the person's
  key, which the context does not carry as such. It stays a lookup.
- **A missing attribute is refused on save, not on opening.** The form
  offers the write to a person whose token lacks the attribute a stamp
  names, and refuses it with `missing-attribute`; an id longer than the
  column refuses every save of that person until the column is widened.
- **The ended version of a chain is not restamped**: who ended it is the
  next version's creator.
- **What each engine does was not measured in this change.** The parity
  suites hold each expectation above on both engines and the release
  report fails a run where one is missing; they were written where no
  container could be started, and are to be watched failing in CI.
  SQL Server's smalldatetime, which rounds to the minute, has no column in
  the fixture, and nothing tests a stamp into one.

## Alternatives considered

- **A row filter on the creator's column.** It writes the context on
  create, and filters every read and update by it: each person would see
  only their own records, and nobody could change another's. Refused at
  generation and at publish instead.
- **The database's defaults and triggers.** A default knows the time and
  not who is signed in, since the module connects as one account, and
  there is no default on update. A trigger could read who only from a
  session value the module set first -- `set_config` on PostgreSQL,
  `sp_set_session_context` on SQL Server -- a second statement before
  every write, set per engine, and trusted by code the module cannot see.
- **A time the server passes in.** The server process's clock is another
  source of truth beside the database's defaults; data-core reads no clock
  (formancy.ai 0019); and a zoneless timestamp has no codec to bind one
  through (0009), so the wall clock could not be stamped at all.
- **No field for a stamped column.** A person would lose who created a
  record and when; shown read-only, they see it and cannot write it.
- **Stamping the version a change from a date ends.** On SQL Server the
  batch's check that text was stored as sent reads the insert's OUTPUT
  only, so a stamp of who on the ended row would go unchecked; and the
  next version's stamps already say who ended it, and when.
- **Trusting a name.** `created_by` as an integer is a reference to a
  person, not a person; a stamp is confirmed, as a version column is.
