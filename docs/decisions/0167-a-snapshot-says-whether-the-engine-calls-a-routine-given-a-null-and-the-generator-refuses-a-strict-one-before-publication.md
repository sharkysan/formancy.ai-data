# 0167 — A snapshot says whether the engine calls a routine given a NULL, and the generator refuses a STRICT one before publication

- **Status:** accepted
- **Date:** 2026-11-19
- **Deciders:** Daniel Bacher
- **Verified by:** written on a machine without Docker on 2026-11-19: the
  cases that need no database ran there, each watched failing with its
  rule taken out and the file put back byte for byte; the suites that
  start the databases, and the studio's browser gate, have never run, and
  CI is their first run.
  Ran and watched failing:
  `packages/data-core/src/routines.test.ts` -- a snapshot whose routine
  says nothing of it hashes to the literal data-core at 7343512, the
  release before this record, gave it, and the fact read is in the
  fingerprint (watched failing with an absent fact recorded as `called`:
  "expected 'ba806b0a…' to be 'd5fc4277…'"); a value outside the two, a
  `null`, a key set to undefined, and a procedure not called are refused
  naming the routine (watched failing with the value check, and then the
  procedure check, taken out: "expected [Function] to throw an error").
  `packages/data-core/src/generate/actions.test.ts` -- a PostgreSQL
  routine not called given a NULL is refused in the note's words (watched
  failing with `nullInputProblem` unasked in `routineProblem`: "a refused
  action was bound: expected true to be false"); a routine whose snapshot
  does not say binds, with the notes, exactly what one known to be called
  binds (watched failing with an unknown read as not called: "expected
  undefined to deeply equal [ { name: 'ship', …(6) }, …(1) ]"); a SQL
  Server function declared RETURNS NULL ON NULL INPUT is refused as a
  function (watched failing with the rule asked before the engine's kind:
  "expected 'sales.weigh_order() is STRICT: Postgr…' to be
  'sales.weigh_order() is a function, wh…'"). Under the same unknown
  mutation every case of `packages/data-core/src/actions/plan.test.ts`
  failed, 17 of 17: its routines say nothing of the fact, so the
  planner's suite holds an old binding to plan as before.
  `packages/data-core/src/drift/routines.test.ts` -- a bound routine made
  STRICT since publication blocks its actions alone, at review and in the
  runtime's verdict (watched failing with `madeStrict` answering null: a
  `routine-changed` for review that stopped nothing; and with it left out
  of `runtimeRoutineStops`: "expected [ 'ship', 'close' ] to deeply equal
  [ 'close' ]"); the fact read for the first time is no change, bound or
  not, and a change between two snapshots that both say is a note
  (watched failing with routines compared whole: "called: expected [ [
  'routine-changed', …(2) ] ] to deeply equal []"), and its fingerprint is
  not the base's, so that review compares in full (watched failing with
  the fact left out of the fingerprint); a SQL Server procedure become a
  function declared RETURNS NULL ON NULL INPUT is one change of its call
  shape (watched failing with STRICT's rule asked whatever the engine:
  "expected [ [ 'routine-changed', …(2) ], …(1) ] to deeply equal [ [
  'routine-changed', …(2) ] ]"). `packages/data-core/src/drift/fixture.ts`
  holds every report the drift suites build, against a base none of whose
  routines says, to the one against the same snapshot without the fact
  (watched failing with routines compared whole: "whether a routine is
  called given a NULL, read since 0167, changed a report against a base
  that never read it").
  `packages/data-server/src/bundle.test.ts` --
  `fixtures/bundle-before-0167.json`, a bundle data-core and data-server
  at 7343512 published, its action bound over a routine whose snapshot
  says nothing of it, validates with the fingerprint it was published with
  and is still what the generator makes of its request (watched failing
  with an unknown read as not called: "expected [ Array(1) ] to deeply
  equal []").
  `packages/data-sqlserver/src/discovery/routines.test.ts`, from the
  statement's rows -- a function declared RETURNS NULL ON NULL INPUT is
  not called, every procedure is whatever its module row says, and a
  function whose module row is not shown records nothing (watched failing
  with the column read as a procedure's too: "expected 'not-called' to be
  'called'"; and with a NULL read as called: "expected 'called' to be
  'absent'").
  `packages/data-fixtures/src/conformance.test.ts` -- `routineDisagreements`
  notices a routine reported not called, and one that does not say,
  against the model (watched failing with the fact uncompared: "expected
  [] to deeply equal [ …(2) ]"). `load.test.ts` -- `ACTION_ON_NULL` names
  each routine both actions editions create, and those it says are not
  called are the ones each file declares so (watched failing with
  weigh_order left out of it, and with STRICT taken out of the PostgreSQL
  file); and every PostgreSQL fixture file closes each dollar quote it
  opens, since PostgreSQL parses a file sent as one query before it runs
  any of it (watched failing with weigh_order's body quoted by a single
  `$`: "expected [ …(2) ] to deeply equal []").
  `cases.test.ts` -- `ACTION_ON_NULL` is a family of shared cases
  (watched failing without it: "expected [ 'ACTION_ON_NULL' ] to deeply
  equal []").
  `apps/studio/src/choose-actions.test.tsx`, against the real server
  behind a fake `fetch` -- ship_order made STRICT is listed with its box
  disabled and the generator's refusal under it, cannot be ticked, and
  axe finds nothing (watched failing with `nullInputProblem` unasked:
  "expected false to be true"). `apps/studio/src/fixtures.test.ts` holds
  `fixtures/routines.json`, completed by hand with the fact, to the model
  (watched failing with one routine's fact taken out: "expected [
  Array(1) ] to deeply equal []").
  Never run, CI first:
  `packages/data-postgres/src/discovery-routines.integration.test.ts` --
  STRICT and RETURNS NULL ON NULL INPUT recorded not called, read as the
  reader, every other routine called, beside the server's own NULL for a
  call of each; and
  `packages/data-sqlserver/src/discovery-routines.integration.test.ts` --
  a scalar function declared RETURNS NULL ON NULL INPUT recorded not
  called beside the server's own NULL, every other routine called, and an
  account that may only EXECUTE it reading the fact while sys.sql_modules
  gives it no definition, the documentation's claim (R2) measured.
  Both suites' `MODEL_CASES.routines` and `MODEL_CASES.routineAccess`
  cases now compare the fact, which `FIXTURE_ROUTINES` gives as called for
  every fixture routine on both engines.
  `packages/data-postgres/src/actions.integration.test.ts` and
  `packages/data-sqlserver/src/actions.integration.test.ts`, each
  declaring `ACTION_ON_NULL_CASE` with `covers()` -- discovery says
  weigh_order is not called and every other routine of the actions schema
  is; on PostgreSQL, for every routine of the schema the run's description
  answers STRICT's `refused` exactly where the generator's rule names one,
  and the generator refuses weigh_order in that rule's words, which is
  how a test finds out if the two ever read STRICT two ways; and
  close_order made STRICT after publication stops `close` and `close-all`
  at review and in the runtime's verdict; on SQL Server the generator
  refuses weigh_order as a function and every procedure is recorded
  called. `apps/studio/scripts/browser/actions.mjs` -- the refusal under
  a STRICT routine's box, measured at every width of the gate, 320 pixels
  among them.

## Context

0160 left this as its cost: a STRICT routine is not run on PostgreSQL --
the run's description refuses it, `refused`, since PostgreSQL does not
call one given a NULL argument and the run would answer done for a call
that never ran -- and neither discovery nor the generator says so, so a
form bound to one is found refused only when it is run. Telling it before
publication was a later record's: this one.

The generator decides from the snapshot alone (0009), and a routine's
snapshot (0158) said nothing of it. Every published bundle's snapshot is
hashed again on every read (0019), and every bundle written again -- an
approval, a policy edit -- is compared with what the generator makes of
its request and snapshot (0030), as is every stored action at every run
(0159). Every snapshot that records routines today was taken without this
fact, and so were the studio's captured files.

What the engines and their documentation say, 2026-11-19:

| Probe | What it says |
|---|---|
| R1, PostgreSQL | `pg_proc.proisstrict` is STRICT, which RETURNS NULL ON NULL INPUT spells too: the function is not called and its answer is NULL when an argument is NULL. CREATE PROCEDURE takes neither. pg_proc shows every role every routine (0158, R1). Held by the discovery suite beside the server's own answer, first run in CI. |
| R2, SQL Server | CREATE FUNCTION's RETURNS NULL ON NULL INPUT "specifies the OnNULLCall attribute of a scalar function", CALLED ON NULL INPUT by default; CREATE PROCEDURE has no such option. `sys.sql_modules.null_on_null_input` is "declared to produce a NULL output on any NULL input"; OBJECTPROPERTY and OBJECTPROPERTYEX name no such property. Metadata Visibility Configuration: a catalog view shows a securable's row to a user who owns it or holds any permission on it, and of sys.sql_modules only `definition` is kept from one without VIEW DEFINITION -- so an account that may only EXECUTE a function reads its row. Read from Microsoft Learn; measured first in CI as such an account. |
| R3 | data-core and data-server at 7343512 read a routine that carries the fact: `assertRoutine` checks only the fields it names, and the fingerprint hashes the routine as stored, so a snapshot taken after this record hashes to its own fingerprint there, and its generator ignores the fact. Its drift compares a routine whole (`canonicalize(was) !== canonicalize(is)`, `drift/routines.ts`), against a discovery that does not read the fact. Read in the code, not run. |

## Decision

1. **The fact in the snapshot, absent where it was not read.**
   `RoutineMeta.onNull` (`packages/data-core/src/routines.ts`) is
   `'called' | 'not-called'`, every value listed in a record so a new one
   is a compile error. Absent is "not read" -- every snapshot taken before
   this record, and a SQL Server function whose module row the catalog
   does not show the account -- and never `null` beside it, since one fact
   in two spellings would hash two ways; a key set to undefined, a `null`
   or another value is refused naming the routine, and so is a procedure
   not called, which neither engine can declare. Absent, the key is not
   hashed, so every snapshot stored before keeps its fingerprint.
2. **Discovery reads it on both engines,** by the read the run's
   description shares. PostgreSQL: `p.proisstrict` in `readRoutines`,
   normalised by `routineOf`, which the description reads it through too
   (`actions/definition.ts`). SQL Server: every procedure called; a
   function's from `sys.sql_modules.null_on_null_input`, a subquery of
   `ROUTINE_ROWS`, which the description reads too, and nothing where it
   shows no row. Where the engines differ is said in each adapter's
   `discovery/routines.ts`.
3. **The generator refuses a routine PostgreSQL does not call given a
   NULL.** `nullInputProblem` (`packages/data-core/src/generate/actions.ts`)
   is the rule, in the run's words: "is STRICT: PostgreSQL does not call it
   when an argument is NULL, so a run would answer done for a call that
   never ran". `routineProblem` asks it among PostgreSQL's rules, after a
   procedure and a function that returns, so the note names it for a
   routine every other rule binds; a SQL Server function declared RETURNS
   NULL ON NULL INPUT is refused first as the function it is, and a
   procedure, all SQL Server binds, is always called. PostgreSQL's
   description asks the same function of the routine `routineOf` read and
   answers `refused` with 0160's sentence, as before: one decision, which
   that adapter's actions suite holds to one answer for every routine of
   the fixture's schema. A routine whose snapshot does not say binds as
   it did. It holds for both scopes (0165), and the studio's Choose step
   says it under the routine's box, as it says every refusal of
   `routineProblem` (0163).
4. **Drift: a bound routine made STRICT stops the actions over it.** Called
   in the base and not called now is `routine-changed`, `blocking`, in the
   generator's words, for the actions over that routine alone, at review
   and in the runtime's verdict (`runtimeRoutineStops`), whose request's
   description refuses it. Asked on PostgreSQL alone, as the generator
   asks it: on SQL Server a bound routine is a procedure, and one dropped
   and created again as a function declared RETURNS NULL ON NULL INPUT has
   changed its call shape, which says so once. Not in `callShape`, which a
   request compares with a described routine: a base that does not say
   against a description that does would make every request over a bundle
   published before this record `drift`. The fact read for the first
   time, either way, is no change of the routine, bound or not; between
   two snapshots that both say, a change of an unbound routine is a note
   as any is. The runtime's answer is 0160's, unmoved: the description
   refuses it.
5. **One fixture routine written twice, one shared case.** The actions
   schema's `weigh_order`: a STRICT function returning void on PostgreSQL,
   bindable by every other rule, and on SQL Server a scalar function
   declared RETURNS NULL ON NULL INPUT, since a procedure cannot be.
   `ACTION_ON_NULL` (`packages/data-fixtures/src/actions.ts`) says what
   discovery records of each routine both editions create, and
   `ACTION_ON_NULL_CASE` holds both actions suites to it. `FIXTURE_ROUTINES`
   gives ship_order and SQL Server's predicate as called, on both engines,
   so the model's own cases compare the fact; the studio's
   `fixtures/routines.json`, which completes the captured files with
   routine facts by hand, says so of each.

## Consequences

**What it buys.** An administrator binding a STRICT routine is told
before publication, in the words the run would answer, and the routine
cannot be bound; a form whose routine became STRICT after publication is
stopped at review, before its people meet the refusal; and a form
published before keeps every binding, fingerprint and answer it had.

**What it costs.**

- **A form published before this record that binds a STRICT routine
  keeps offering its action**, every run of it refused as 0160 has it,
  until the form is generated again from a discovery since this record,
  which drops the action with the generator's note -- and refuses the
  grant and the words that name it, which the administrator edits then.
  Drift review of it against a new discovery stops nothing: nothing about
  the routine changed, and only the snapshot it was published from could
  not say.
- **Every snapshot that records routines moves its fingerprint.**
  Discovered since this record, it hashes otherwise than one of the same
  catalog discovered before. Drift review compares a form's published
  snapshot with a fresh discovery, so every review of a form published
  from a snapshot taken before this record leaves the fingerprint
  shortcut and compares in full, finding no change, until the form is
  published again from a discovery since.
- **A STRICT routine is refused whatever its arguments.** One whose every
  argument could never be NULL -- the key, a required answer, the actor's
  id -- is refused all the same: the generator does not reason about which
  argument may be NULL. The deployment declares it CALLED ON NULL INPUT
  to bind it.
- **SQL Server's fact rests on its documentation until CI measures it.**
  That an account that may only EXECUTE a function reads its module row is
  Microsoft's word (R2), held by a case first run in CI; where no row is
  shown, nothing is recorded, never a guess. And on SQL Server it changes
  nothing bound: a function is refused as a function, and every procedure
  is called.
- **Rolling the server back** to one before this record loses the
  refusal: it reads a snapshot carrying the fact, hashes it to its own
  fingerprint, and binds a STRICT routine its run refuses (R3, read in the
  code). And its drift compares a routine whole while its discovery does
  not read the fact, so every review of a form published since this
  record reports each of its routines as changed -- a bound one
  `routine-changed` for review, "changed in what a call of it does not
  rest on", any other a note -- though nothing changed, until the form is
  published again from a discovery of that server.
- Every fixture container's actions schema holds one more routine,
  weigh_order, which no action binds.

**What it does not do.** It does not refuse a routine whose snapshot does
not say, read a routine's body, or ask whether an argument can be NULL;
and a run's answer to a STRICT routine is 0160's, `refused`.

**Forecloses:** nothing.

## Alternatives considered

**Refuse only at run time, as 0160 does.** Lost: a form is published whose
every run is refused, and its people find out before its administrator.

**Refuse a routine whose snapshot does not say, too.** Lost: every bundle
whose snapshot predates this record would generate without its actions,
so every write of one would be refused as not what the generator makes,
and every run's planner would refuse its stored binding -- every action
published before, STRICT or not, stopped at once.

**Pass only NULL-free arguments, and call a STRICT routine anyway** --
bind one where no argument can be NULL, or refuse at run time only a run
with a NULL argument. Lost: whether a column can be NULL is the database's
and can change after publication, a second rule of when a call happens
would sit beside the description's, and 0160's run would move for a gain a
declaration of CALLED ON NULL INPUT gives.

**STRICT in the call shape.** Lost: `callShape` is compared with a
request's description too, and a base that does not say against a
description that does would make every request over a bundle published
before this record `drift`.

**A drift kind of its own.** Lost: the kinds are a closed list every
client words, and `routine-changed`, blocking, already says the routine an
action rests on changed; its sentence names STRICT.

**A routine read as not called for the first time stopped as drift.**
Lost: nothing changed; it would report a change the database never made,
and the regeneration says it, with the generator's note.

**`null` written for "not read".** Lost: a snapshot taken before this
record has no key at all, and two spellings of one fact would hash two
ways.

**OBJECTPROPERTYEX on SQL Server.** Lost: neither it nor OBJECTPROPERTY
names the attribute; `sys.sql_modules` keeps it (R2).

## Older records

Extended, not edited away: 0158 (a routine records whether the engine
calls it given a NULL, absent where not read, and in the fingerprint only
where read); 0159 (the generator refuses a routine PostgreSQL does not
call given a NULL, and drift stops the actions over one that became so,
at review and at the runtime); and 0160 (its description refuses a STRICT
routine by the generator's own rule over discovery's own reading, and
what it costs is told before publication).
