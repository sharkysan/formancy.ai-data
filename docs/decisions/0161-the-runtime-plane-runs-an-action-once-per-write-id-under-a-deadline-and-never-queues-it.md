# 0161 — The runtime plane runs an action once per write id, under a deadline, and never queues it

- **Status:** accepted
- **Date:** 2026-11-17
- **Deciders:** Daniel Bacher
- **Verified by:** the route, its deadline setting, the run pool's count,
  what the server publishes of an action and the client -- the parts of
  this decision built here; the studio's panes and the host page's
  control are later records'. Every case was watched failing with its
  rule taken out, the file put back byte for byte, on 2026-11-17; the
  container suites on postgres:17-alpine and
  mcr.microsoft.com/mssql/server:2022-latest.
  `packages/data-server/src/routes/runtime-actions.test.ts`, over fake
  ports -- a run is described once and sent once under the server's
  deadline, and answered with the record's token (watched failing with
  the run sent under 15000 in place of the server's deadline); an auditor
  the policy does not let run close, and an action the form does not
  bind, are 403 before any statement, and neither is offered (watched
  failing with the policy asked only by the planner, after the
  description: "expected { described: 1, runs: +0 } to deeply equal {
  described: +0, runs: +0 }"); an action drift stops is absent from
  `GET /v1/forms/:id` and its run is 409 `drift`, never sent, while the
  form still reads and the other action runs (watched failing with GET
  offering every runnable action whatever the verdict: "expected [
  'close', 'ship' ] to deeply equal [ 'ship' ]"); each answer its
  parameter's codec refuses is 422 by its dialog field, nothing sent
  (watched failing with the field errors left out of the 422); one write
  id is one run, its second sending answered with the first's answer,
  and the same id with another body 400 (watched failing with the route
  running without `sendOnce`: "expected { described: 2, runs: 2 } to
  deeply equal { described: 1, runs: 1 }"); with every connection of the
  actions' pool running one, the next is 503 `unavailable` with nothing
  described or sent, and runs once one answers (watched failing with the
  count taken out: "expected [ 200, undefined ] to deeply equal [ 503,
  'unavailable' ]"); a lost answer is 502 naming the action and the
  record with its version (watched failing with the adapter's unknown
  outcome answered as any failure: a 500); each other code a run fails
  with is answered in the server's words, the deployment's own refusal
  apart (watched failing with `action-timeout` answered as `unavailable`);
  the trail is one event naming the operation `action`, the action and
  the record's keyed hash, a declined run by its code alone, and an
  unbound action by no name (watched failing with the name taken from the
  URL: the unbound run's event carried "reopen"); no answer, input or
  declined reason reaches the log (watched failing with the declined
  reason logged beside its code: "expected [ { level: 30, …(8) } ] to
  deeply equal []"); a bundle whose bindings bind an action its request
  does not name as they bind it, and a format-1 bundle binding one, are
  not served (watched failing with the request's actions uncompared,
  "unnamed: expected [ 200, undefined ] to deeply equal [ 500,
  'corrupt-bundle' ]", and with format 1 unchecked, "format-one: …"); a
  proposal naming an action is discovered with the routines, every other
  without, and a request whose actions are of no shape this release reads
  is 400 before anything is discovered (watched failing with the proposal
  discovered as every other, its scope asking for no routine, and with a
  scope other than `record` read as one: the generator's 422 in place of
  the reading's 400); drift review, a regeneration, a restore and an
  import discover a form recorded with routines with them again (watched
  failing with each of the four discovering as every other, in turn); and
  `FORMANCY_DATA_ACTION_DEADLINE_MS` is 15 s unset, a whole number of
  milliseconds otherwise, and the option refused when building the server
  (watched failing with the option unchecked: the server was built).
  `packages/data-server/src/e2e-lost-answer.integration.test.ts`, on both
  engines through 0031's TCP hop -- a run whose answer is lost is 502 with
  the action and the order with its version, the marker crossed once,
  PostgreSQL's never committed and SQL Server's did, the same run sent
  again from the version sent stale on SQL Server and run on PostgreSQL,
  and the trail names the action each time and none of the note (watched
  failing with the route sending a run again after its answer was lost:
  PostgreSQL's second sending ran it, "expected 200 to be 502", and SQL
  Server's was stale, "expected 409 to be 502").
  `packages/data-client/src/actions.integration.test.ts`, on both engines
  across real HTTP -- the form offers close with its dialog, a run commits
  and moves the version, the routine given the note and the clerk's id,
  and the same run again is 409 `stale` (watched failing with the client
  posting to the update route: every run refused 400); the deployment's
  refusal is `declined` in its own words, nothing kept, and another
  tenant's order `not-found` (watched failing with declined answered as
  refused in the server's dist: the person read the server's sentence).
  `packages/data-client/src/transport.test.ts` -- `runAction` posts
  exactly its two keys with a write id of its own, and is done only on a
  token for every record (watched failing with the answer read as a
  write's record: the tokens were an unknown run); every answer that is
  not the data server saying what happened is an `UnknownAction` from the
  transport, sent once, and the server's 502 one from the database
  (watched failing with every 2xx taken as done: "a portal: expected {
  ok: true, value: {} } …"); 422 `declined`, 409, 403, 503 `unavailable`
  and 503 `action-timeout` are refusals (watched failing with
  `action-timeout` read as any 503: the run was unknown); and a form's
  `actions` is held to its shape, a reply without it refused (watched
  failing with `actions` left unchecked: a reply without it was taken).
  `scripts/server-start.test.mjs` -- the built server stops at start on an
  action deadline that is not a whole number of milliseconds, quoting it,
  and starts on one that is (watched failing with `main.ts` reading no
  action deadline: the server listened at "15s").
  `deploy/cloudflare/doors.json`, generated from the built server's
  router and held by `scripts/cloudflare/doors.test.mjs`, forwards the
  route at the runtime door; `scripts/live-demo.test.mjs` holds the live
  demo's Worker to it; and `apps/host/src/plane.test.tsx` leaves the route
  unsent until the host page has an action's control.

## Context

0159 decided what data-core holds of an action and 0160 how both adapters
run one, each over the open record alone. Nothing in the server ran an
action: there was no route, no deadline setting, no count of the runs in
flight on the actions' pool 0160 opened, no client, and `GET
/v1/forms/:id` offered none. And nothing could be published: the server
read no `actions` in a generation request, so a bundle naming one was
refused as not in its normalised form (0159, Decision 12), and no
discovery the server made asked for routines (0158). The design's
section 7 laid out the route's order, its deadline and its pool, and
section 8 that a page draws a dialog and a confirmation from what it is
served and then sends one run, the server keeping nothing between them.

## Decision

1. **`POST /v1/forms/:id/actions/:action/run`**
   (`packages/data-server/src/routes/runtime-actions.ts`, registered by
   `routes/runtime.ts` alone), body `{ records: [{ record, version }],
   answers }`, in this order, each step answering alone: the body's shape,
   400, by the planner's own reading (`readRunBody`), before the write id
   is read; the write id, 400 for one that is not one; the published
   form, which validates (0019), and an action of that name it binds, 403
   `operation-unavailable` -- in words that do not repeat the URL's name;
   who may run it (`authorizeAction`), 403 before the connection is
   opened and before any statement; a connection of the actions' pool
   free (5); the root and the routine described in one statement (0041);
   the plan (`planAction`): 409 `drift` where the database no longer lets
   the action run, 400 `duplicate-record`, 422 `invalid-values` with
   every answer's error by its dialog field; and the run, once.
2. **Once per write id.** Steps from the pool's count to the run run once
   per sending of a write id (0031), each action an operation of its own,
   `action:<name>`; a sending that arrives again is answered with the
   first one's answer and asks nothing; the same id with another body is
   400. A run takes no signal and goes on after its client leaves, as a
   write does. A lost answer is said once in the log with the adapter's
   sentence and answered 502 `unknown-outcome` naming the operation
   `action`, the action and each record with the version sent, and is
   never sent again.
3. **Answers.** Done is 200 `{ records }`, each record's token as the
   statement that moved it read its key, never a version: the run moved
   it, and the routine may have moved it again. Each failure of 0160 is
   answered in the server's words and says nothing was done: `not-found`
   404, `stale` and `version-ended` 409, `schema-changed` 409,
   `permission-denied` 403, `refused` 422, `unavailable` 503,
   `action-timeout` 503; `declined` is 422 in the deployment's own words
   (0156), about the run as a whole -- an action's person answers its
   dialog, not the form, so no field error is placed.
4. **A deadline.** `FORMANCY_DATA_ACTION_DEADLINE_MS`, read in `main.ts`,
   parsed in `action-deadline.ts` by the lookup deadline's rule, a whole
   number of milliseconds from 1 to 2147483647, and held to the same rule
   by `createDataServer` as `runtime.actionDeadlineMs`; the run's
   argument (0160). **The default is 15,000 ms**, the deadline every SQL
   Server write already has from mssql's default request timeout, which
   0061 read in mssql's source: chosen so that a run waits no longer than
   a save beside it may, and not a measurement of any action -- none was
   timed for it (2026-11-17). Nothing holds it to mssql's request timeout
   at start, as the save deadline is (0155): a run's batch carries its own
   request timeout, at the deadline.
5. **No run waits in the pool's queue.** `OpenConnection.actionPool` is
   how many connections the actions' pool opens at most -- postgres.js's
   `options.max` on PostgreSQL, which it reports, and
   `SQLSERVER_ACTION_POOL` on SQL Server, which mssql does not (0160) --
   and the route counts the runs in flight on each connection against it,
   from before the description to the run's answer. A run that would wait
   for a free connection is 503 `unavailable` before anything is
   described or sent, so no run's deadline is spent in a queue. The count
   is the process's: each server opens pools of its own.
6. **What a form offers.** `PublishedForm.actions`, required, is every
   action the bindings bind, worded as `presentedActions` words it, that
   the policy lets this person run (`runnableActions`) and the root as
   described in that request leaves runnable (`DriftVerdict.actions`) --
   each with its label, its confirmation and done sentences or none, its
   dialog served as stored with its words applied, and what to read again.
   A routine is not described there: its run describes it.
7. **The trail and the log.** A run is one event of the operation
   `action`, naming the record by its keyed hash and the action by its
   name -- the form's configuration -- once the published form binds an
   action of that name, so a name only the URL said is never written;
   `action` is absent from every other event, which is what it was.
   Neither carries an answer, an input, a field's value or the routine's
   message, and a declined run is its code alone. A pool found full is
   said in the log with the count, and nothing else.
8. **The server publishes an action.** This amends 0159's Decision 12.
   `readGeneration` reads a request's `actions` by shape and copies it, so
   a stored request naming one is in its normalised form; the bundle check
   holds every action the bindings bind to one the request names as they
   bind it -- its routine, scope and each parameter's source, in any order
   -- and refuses a format-1 bundle that binds one, as it refuses one
   saving rows (0155). The generator may still leave out an action it
   refuses, with a note, so a request may name more than its bindings
   bind. A proposal whose request names an action is discovered with the
   routines in scope (0158), and every discovery the administrator's plane
   compares with a published version -- drift review, a regeneration, a
   restore, and the gate an import and a draft under review pass (0062,
   0065) -- asks for them exactly where that version's snapshot recorded
   them, so review compares like with like. Every other discovery is the
   one it was.
9. **The client.** `@formancy/data-client` gains `runAction(formId,
   name, { records, answers })`, which sends exactly the route's two keys
   with a write id of its own and is done only on a token for every record
   it addressed. Its answer is read by `heard`, the one reading of 0031's
   rules a write's answer and a run's share, with a run's own two: a 503
   `action-timeout` is the server saying nothing was done, as 503
   `unavailable` is, and anything that is not the data server saying what
   happened is an `UnknownAction` -- `ok: false`, the action and each
   record with the version sent, from the call's own arguments -- so a
   host that checks only `ok` fails closed. `isUnknownAction` tells one
   apart. A form reply without `actions`, or with one of another shape, is
   no server's this client knows.

## Consequences

**What it buys.** A host can run an administrator's action over the open
record through one route and one client call, on both engines, decided
again under the policy on every request and answered once per sending,
with a lost answer named so that a page can reconcile it -- and a client
other than the studio can publish a form with actions through the
administrator's plane today.

**What it costs.**

- **`GET /v1/forms/:id` decides over the root alone.** A routine that
  changed since publication is still offered, and its run is refused 409
  `drift` by its own description: describing every action's routine there
  would put a statement per action on the actions' pool on every opening
  of a form.
- **A full pool refuses rather than waits.** With ten runs in flight on
  one database, the eleventh is 503 at once, however soon one of the ten
  would answer: a deadline spent in the queue would be spent on nothing
  the run did.
- **The deadline is chosen, not measured.** Fifteen seconds for every
  action on the server; a deployment whose routines take longer raises
  it, and above 15,000 ms on SQL Server a save blocked by a run may end as
  "It may have been saved": the save's own batch times out at mssql's 15 s
  first (0155) -- reasoned, not measured.
- **Each server counts its own runs.** Two replicas each open their own
  pools and each count their own, so the database may hold twice the
  bound in runs.
- **An action is published only by a client that writes its generation
  request itself.** The studio binds none yet, and the host page offers no
  action's control: a run is sent by a page an integrator writes, or by
  `runAction`.
- **A request naming an action reads the routines in scope** on every
  proposal of it, and on every comparison with a version that recorded
  them: more of the catalog (0158).
- **The audit event of a run carries a key no other event has**, `action`,
  which a collector that holds every event to one shape meets.
- **Behind Cloudflare, a tunnel forwards the route only once
  `tunnel-config` writes its configuration again** (0037); until then the
  runtime door does not forward a run, which fails closed.

**What it does not do.** No selection of records, no preview, no check
routine: later records'. The host page and the studio offer no action.
No reconciliation of an unknown run in the client: the host reads the
records again (0031), which is the host page's record's. A run is never
cancelled, and never sent twice.

**Forecloses:** nothing.

## Alternatives considered

**Ask the policy inside the write id's scope, after the connection**, as
the delete route does (0050). Lost: opening a connection pings the
database the first time, and the design asks for 403 before any
statement; asked first, the policy is still answered again for a second
sending, the same way.

**Let a run wait for a free connection**, as every other operation does
on its pool. Lost: a run's deadline would be spent in the queue, and a
handful of slow runs would hold every later one past its deadline without
any of them running.

**Count the runs in flight in the driver's factory**, around the actions'
port. Lost: the description is on the same pool, and the count must hold
from before it to the run's answer, which only the route sees whole.

**Describe every action's routine for `GET`**, so a changed routine is not
offered. Lost: a statement per action on every opening of a form, on the
pool runs need, for a refusal the run gives anyway.

**`action: null` on every audit event**, as `rows` and `moved` are.
Lost: every event of every other operation would change shape for a key
it never has.

**The client's own copy of 0031's rules for a run.** Lost: a write and a
run would read one answer two ways, and nothing would find out; `heard`
is the one reading both ask.

**Leave publishing to the studio's record.** Lost: nothing could serve
or run an action until then, and neither the route nor the client could
be proved through a real server.

## Older records

Extended, not edited away: 0023 (a run is an audit event naming its
action); 0029 (the client reads a run's answer); 0031 (a run is sent once
per write id, and a lost one named by its action and its records); 0041
(the actions a form offers are what the root as described leaves
runnable); 0158 (a proposal naming an action asks for the routines, and a
comparison with a version that recorded them asks again); 0159 (the
server reads, holds and serves what it binds, amending its Decision 12);
and 0160 (the route runs what both adapters run, under the server's
deadline, never queued on the actions' pool).
