# 0061 — A lookup statement stops when its request is abandoned or its deadline passes, and a search is not bounded before it scans

- **Status:** accepted; extended by [0063](0063-the-default-lookup-deadline-is-outside-the-measured-product.md): the default lives alone in `lookup/default-deadline.ts`, which the measured product leaves out, so setting it to what a measurement derived no longer makes that measurement stale
- **Date:** 2026-10-14
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-server/src/routes/runtime-lookup-limits.integration.test.ts`
  — on PostgreSQL 17 and SQL Server 2022, through `DRIVER_FACTORIES`, a real
  `listen` and `fetch`, with the customer table held behind its owner's lock
  (`blockTable`): a search whose client aborts once it waits stops waiting
  in the database while the lock is still held, and the audit trail has one
  `lookup-query` event, 499 `abandoned`; on a server with a short deadline a
  search is 503 `lookup-timeout` with its sentence and a resolve 503
  `unavailable`, each seen waiting and then gone while the lock is held; a
  create whose membership check passes the deadline is 503 `unavailable`,
  the log says the deadline passed, the check is gone and the owner counts
  no new order; and on PostgreSQL, while a lookup and a record read both
  wait, the lookup's backend carries `formancy-data lookups` in
  `pg_stat_activity` and the read's does not.
  `routes/runtime-lookups.test.ts`, over fake ports that keep the port's
  contract — a lookup that completes is answered as the port answered and
  its signal never aborts; past the deadline a search is 503
  `lookup-timeout` and a resolve 503 `unavailable`, the log naming the
  deadline for each, and the port's signal carries a TimeoutError; a
  connection that takes longer to open than the deadline still answers its
  search, the signal not aborted; a port that rejects with anything but the
  reason itself is 503 `unavailable`; a client that leaves aborts the port
  with an AbortError and is audited 499 `abandoned`; and a create whose
  membership check passes the deadline is 503 `unavailable` with nothing
  inserted. `routes/abandoned.test.ts`, over loopback HTTP and no database —
  a route's signal aborts with an AbortError when the client's fetch aborts,
  never for a request that is answered, aborts for both of two pipelined
  requests when the connection goes, and a keep-alive socket holds the same
  listeners on its twentieth request as on its first.
  `lookup-deadline.test.ts` — unset is `DEFAULT_LOOKUP_DEADLINE_MS`, `250`,
  `1` and 2147483647 are taken, and `''`, `0`, `-1`, `1.5`, `abc`, a space
  either side, `5e2`, `0x10` and 2147483648 are refused with the sentence
  naming the variable; `createDataServer` refuses a `runtime.lookupDeadlineMs`
  of 0, -1, 1.5, NaN, 2147483648 or Infinity, naming the option, and takes
  1 and 2147483647; a deadline aborts with a TimeoutError, or with the
  reason of the request's signal, and once cleared never aborts and leaves
  no listener; and a Node timer of `MAX_LOOKUP_DEADLINE_MS` has not fired
  after 50 ms where one a millisecond longer has.
  `packages/data-client/src/lookups.integration.test.ts` — on both engines,
  a renderer's option source whose signal is aborted while the statement
  waits rejects with the AbortError, and the statement is gone from the
  database; the lock is on `sales.country`, which only that file's own form
  reads, so the files sharing the database cannot wait on it or be counted.
  `packages/data-postgres/src/lookups-limits.integration.test.ts` — a
  search, a resolve and a rejects aborted while they wait stop before the
  lock is released, and the next lookup answers on the same backend with
  `statement_timeout` still 0; a deadline rejects with its own TimeoutError;
  an already-aborted signal sends nothing, two round trips for the search
  after it, and an already-aborted resolve or rejects with no key still
  rejects; an abort in the same tick, while the connection is opened, and
  while queued each leave a pool of one that answers; with every answer held
  100 ms at the hop, an abort while queued, in the same tick and during the
  first round trip each stop a 30 s sleep once its execute is sent; a cancel
  request the hop refuses leaves no unhandled rejection and the pool
  answering; one cancel request, of a lookup aborted past its execute and
  counted at the hop, held until it lands on the next lookup, which runs
  once more and answers its page; the two a search aborted in its parse is
  sent, each held at a gate of its own and released in turn, stopping the
  next lookup and then its one run more, which is refused with 57014; a
  connection cut and a backend terminated under a lookup; and
  `connectPostgres`'s `applicationName`.
  `packages/data-sqlserver/src/lookups-limits.integration.test.ts` — a
  search, a resolve and a rejects aborted while they wait reject before the
  event loop turns, with exactly the reason, and leave
  `sys.dm_exec_requests` while the lock is held; a deadline rejects with the
  TimeoutError itself; an already-aborted signal sends nothing, and with no
  key still rejects; an abort in the same tick sends no statement; the one
  pooled connection after a cancel has the same `@@spid`, `@@trancount` 0,
  the same `@@options` and `@@lock_timeout`, and answers the same page; and
  a resolve in two key groups sends no second when aborted in the first or
  between them. Every existing lookup suite on both engines passes a signal
  that never aborts and asserts its answers, round trips and rows read
  unchanged. `packages/data-performance/src/deadline.test.ts` — the
  derivation over a hand-built set, and `DEFAULT_LOOKUP_DEADLINE_MS` equal to
  what `docs/performance/results.json` derives through today's catalogue;
  `server-log.test.ts`, what one counted request addressed against the
  catalogue's operation; `render.test.ts`, the page's sentence and its
  absence for a result measured before this record. `packages/data-fixtures`'
  `tcp-hop.test.ts` (connections held until released, counted when
  released, and how many a hold holds; connections refused with a reset
  until released) and
  `fixtures.integration.test.ts` (`blockTable` holds exactly one reader on
  each engine, and none after release). The gates' `container` job's step
  "A FORMANCY_DATA_LOOKUP_DEADLINE_MS that is not a number of milliseconds
  stops the server". Watched failing on 2026-10-14: the server's suite
  against adapters that ignored the signal (the abandoned search waited
  until the lock went, the deadline answered nothing for 30 s on PostgreSQL
  and `unavailable` from mssql's default request timeout after 15 s on SQL
  Server, and the create's case passed on SQL Server for that reason until
  it also asked the log, then failed), and against a lookups client with no
  application name; the client's case against the same adapters;
  `abandoned.ts` listening to the request's `close` (the answered request
  aborted) and without `settle` (the socket's listeners grew); the
  deadline's upper bound removed (2147483648 was taken); the default typed
  as 535 (the committed figures derive 536); the hop without
  `holdNewConnections`; `blockTable` with its lock statement replaced by
  `select 1` (no reader ever waited, on either engine); `addressedProblem`
  and the render sentence before they existed; the route test with its
  identity check reduced to `signal.aborted` (the translated rejection was
  answered as a timeout) and with the membership log's deadline branch
  removed (the log did not say it). On PostgreSQL: the abort and deadline
  cases without the cancel (each statement waited until the lock went); the
  late cancel without the retry (the second lookup rejected with 57014);
  the same-tick and opening-connection cases with the listener attached
  before the query was sent, and the opening-connection case with the cancel
  only deferred a turn (each left a pool of one that never answered); the
  queued case with the cancel in the property setter not deferred; and the
  cut and terminate cases on a design that reserved a connection per lookup
  (an uncaught TypeError from the driver). On SQL Server, each against a
  mutation: no `request.cancel()` (the abort, deadline, same-tick and
  first-group cases), a rejection only once the driver settled (every "at
  once" assertion, and the deadline and connection cases on ECANCEL), a
  wrapped reason (every identity assertion), no check inside `runUntil` (the
  between-groups resolve answered) and none at the top of the methods (the
  no-key case). Watched failing on 2026-10-15, after review: the three
  latency cases without the second cancel (each sleep ran on, in two runs;
  with answers held 20 ms instead, the first-round-trip case passed once,
  which is why the hold is 100 ms), the refused cancel against
  `query.cancel()` (an unhandled `ECONNRESET` rejection), the no-key case
  on PostgreSQL before it checked the signal first (the lookup answered),
  the hop's refusal before it existed, the route's deadline started before
  the form was read (the search on a slow connection was 503
  `lookup-timeout`), the resolve answered `lookup-timeout`,
  `createDataServer` given each bad deadline (it was built), the server's
  PostgreSQL-client case -- which now reads the table each session waits
  for from `pg_locks`, since `pg_stat_activity` keeps only a statement's
  first 1024 bytes -- with the lookups on the records' client (no backend
  carried the lookups' name), and the client's case, now on its own table,
  with the route handing the adapter a signal that never aborts (the
  statement waited until the lock went). On Node 24 the
  pipelined case passes with the response's `close` alone; it fails without
  the socket's listener only on Node 22, which CI runs, as the probe below
  shows. Watched failing on 2026-10-17: the late-cancel case as first
  written abandoned a search waiting in its parse and held both of its
  cancel requests -- every one of 150 runs of a probe did -- so it passed
  only while the second reached the backend before the lookup it stopped
  ran again; under CPU load on PostgreSQL 18 the second stopped that run
  too in 19 of the 150, and once in CI (run 39025046412, its first
  attempt). Rewritten, the one-request case failed without the retry
  (57014) and with a second request sent once the execute was already
  written (the hop held 2); the two-request case without the retry (the
  lookup was never sent again) and with a third run (it was sent 3 times).

## Context

[`docs/performance.md`](../performance.md) measured, under 0034, that a
lookup search reads every row its row filter admits, on every search
request: no index serves a contains search or the order by label on either
engine. It said "no remedy ships": no trigram index, no prefix mode, no
minimum length, no statement timeout on PostgreSQL, and no cancellation --
the renderers abort a superseded search's request, but the server passed no
signal to the adapter, so the database finished every scan it started.

Probed on 2026-10-14 on an Intel i9-10900K workstation (20 logical CPUs,
32 GiB, Windows 11, Docker 28.3.3) against `postgres:17-alpine` (PostgreSQL
17.11) and `mcr.microsoft.com/mssql/server:2022-latest`, with the drivers
this repository installs: postgres 3.4.9, mssql 12.7.4, tedious 20.3.3, and
Fastify 5.12.5. Not 0034's measurement, its machine as presented or its
protocol: these say how things behave, not what the product costs.

- **postgres.js `query.cancel()`** sends PostgreSQL's cancel request.
  `pg_sleep(10)` cancelled after 300 ms rejected with 57014 5.1 ms later; a
  3M-row contains scan that ran 8,391 ms uncancelled rejected 22.3 ms after
  its cancel; over 30 trials 2.5 / 2.7 / 15.0 ms (min / median / max). The
  next statement ran on the same backend. Three hazards. A cancel before
  the query is sent wedges a pool of one: the probe's cancel before the
  query's first `then`, and this record's PostgreSQL suite's while the
  connection the query would run on was being opened -- the next query never
  answered. A query still waiting in the pool's queue is removed without
  being sent, but nothing public tells it from one a connection is being
  opened for. And a cancel travels on a connection of its own, so it can
  land after its statement finished: with a second statement pipelined
  behind a lookup on a shared pool of one, the lookup completed and the
  OTHER statement got 57014; on a reserved connection, 1,000 trials with the
  abort timed near the end of a 4 ms statement sent 93 cancels, of which 92
  lost the race and 86 stopped the next statement.
- **PostgreSQL drops a cancel that arrives while the backend waits for the
  client.** postgres.js has PostgreSQL parse and describe an unprepared
  statement with parameters -- every lookup -- before it sends the
  parameters and the execute. A cancel sent the moment the query is sent
  stops one that waits in its parse, for a lock; one that arrives after the
  parse, while the describe's answer is on its way, is dropped, and the
  execute that follows runs to its end. Found in review on 2026-10-15:
  against PostgreSQL 17 with every answer held 5 or 20 ms by the fixtures'
  hop, a 2 s sleep aborted while queued or 3 ms into its first round trip
  ran its full length 10 times in 10.
- **A cancel request that fails is fatal to the process.** postgres.js
  reports the failure of the connection it opens for a cancel by rejecting
  a promise `query.cancel()` never returns, and Node ends the process on an
  unhandled rejection. Found in review on 2026-10-15 with a database that
  stopped accepting connections while its open one still answered, which is
  when a deadline fires.
- **mssql `request.cancel()`** sends TDS attention. A 10 s WAITFOR rejected
  `ECANCEL` 5.7 ms after a cancel at 300 ms; a scan that ran 14,478 ms
  uncancelled rejected 88.9 ms after its cancel; over 30 trials 1.8 / 2.3 /
  3.5 ms. Attention travels in-band and tedious waits for its
  acknowledgement before reusing the connection: of 300 trials, 99 cancels
  were sent near completion, all 99 own requests were reported ECANCEL, and
  no next request was hit. A request still waiting for a pooled connection
  is rejected once one frees, and sends nothing.
- **PostgreSQL's `statement_timeout`** bounds a statement only from outside
  it: `SET LOCAL` in a transaction worked and did not leak to the next use
  of the connection, but took a plain statement's 2 round trips through the
  fixtures' hop to 5 or 6. A `set_config(…, true)` inside the statement, or
  outside a transaction, bounded nothing.
- **SQL Server already has a deadline.** `connectSqlServer` sets no
  `requestTimeout`, so mssql hands tedious its own default of 15,000 ms for
  every request (`lib/tedious/connection-pool.js` in mssql 12.7.4), writes
  included, counted from when the request is sent, not while it waits for a
  connection. A per-request `requestTimeout` worked, did not carry over, and
  kept 2 round trips.
- **What says the client left**, Fastify 5.12.5, n=20 per platform: the
  response's `close` with `writableFinished` false, 0.96 ms median after a
  fetch's abort on Node 24.21.0 (Windows) and 0.74 ms on Node 22.23.3
  (Linux, as CI runs it), and the socket's `close` within 0.05 ms of it.
  The request's `close` fires as soon as its body is read, `aborted` never
  fires, and `onRequestAbort` never runs once the body was read. A request
  pipelined behind another has no socket of its own for its response until
  the answer before it is written: with `node:http` alone, on Node 22.23.3
  that response emitted no `close` when the connection went, on Node
  24.21.0 it did; the socket's `close` came on both.
- **What the renderers send**, `@formancy/react` 0.5.0 run in jsdom and
  `@formancy/angular` 0.5.0 read: a search `""` with `limit: 50` 250 ms
  after mount, which a plain select sends too; a search 250 ms after the
  last key (`DEBOUNCE_MS = 250`, `MIN_QUERY = 0`, `MAX_ROWS = 50`), sent
  untrimmed; six keys 120 ms apart sent one search, six keys 300 ms apart
  six, each aborted at the next keystroke while the source was still
  answering. A superseded search is aborted only while it is in flight.

## Decision

**The browser's abort reaches the database.** `LookupAdapter`'s `search`,
`resolve` and `rejects` take the caller's signal, last and required. The
server aborts it when the response closes before it finished, or the
request's socket closes (`routes/abandoned.ts`); listeners are removed when
the route has its answer. An adapter given an aborted signal sends nothing
and rejects with its reason, even when no key is worth asking about; one
aborted while its statement runs asks the driver to stop it -- PostgreSQL's
cancel request, mssql's `request.cancel()` -- and rejects at once with the
signal's reason, untranslated, so the route tells its own abort from a
database's failure by identity. An answer read before the abort is returned
unchanged.

**On PostgreSQL a lookup is cancelled once postgres.js has sent it, and
again once it has sent its execute**, through three of postgres.js 3.4.9's
own properties, none of them its API (`lookups/cancel.ts`). The query's
`state`, which the driver sets when it sends the query, says when a cancel
cannot wedge the pool; so a lookup abandoned while it queued for a
connection is still sent, and then stopped. The query's `describeFirst`,
which the driver clears just after it writes the execute, says when a
second cancel can no longer be dropped; a lookup aborted before PostgreSQL
described it is sent that second cancel if it is still unsettled then. The
query's `canceller`, which `query.cancel()` calls and forgets, is called by
the adapter itself, which handles the promise it returns: a cancel request
that cannot be delivered stops nothing, and the statement finishes as it
would have. A postgres.js that moved any of them fails this record's
PostgreSQL suite as a statement never stopped.

**Every lookup statement has a deadline, one timer in the server, the same
on both engines**, started when the adapter is asked for the statement --
so a wait for a pooled connection, inside the driver, counts, and reading
the form and opening its connection do not -- and cleared when it answers
(`lookupDeadline` in `lookup-deadline.ts`). A search past it is 503
`lookup-timeout`, a code of its own because 0028 says a refusal says whether
trying again helps, and a contains search that timed out reads the same
rows again: "The search took longer than this server allows (n ms), and the
database was told to stop it. The same search will take as long again." A
resolve past it is 503 `unavailable`, which invites another try: it reads
by key, at most a row a token, so one past the deadline waited rather than
read too much; the log names the deadline. A client that left is answered
499 `abandoned`, which nobody reads; it exists so the audit trail's event
says what happened (0023, 0033). A membership check inside a create or an
update has a deadline of its own per check and no abandonment, because a
write goes on after its client leaves (0031); past it, it keeps every
failed check's answer, 503 `unavailable`, nothing saved, and the log says
the deadline passed. Neither PostgreSQL's `statement_timeout` nor SQL
Server's per-request `requestTimeout` is used.

**PostgreSQL lookups run on a client of their own**, opened by the
composition root with `application_name` `formancy-data lookups`, so a late
cancel can stop only another lookup, never a record read or write, which
0015 never retries. A lookup stopped by a cancel it did not ask for -- 57014
while its own signal has not aborted -- runs once more: it is a read, and on
its own client nothing but another lookup's late cancel sends it one. SQL
Server needs neither: its attention is in-band.

**A search is not bounded before it scans**: no minimum length, no prefix
mode. The rows a search reads do not depend on its text -- the empty
search, a common, a unique and an absent match each read the tenant's every
admitted row, as both adapters' sized suites pin -- so a minimum length
removes requests, not the cost of any one, and the empty search must stay:
a plain select asks only `""`. A prefix mode changes what a completed
search returns, which 0028's contains forbids, and reads fewer rows only
through an index this module does not create.

**The deadline is the operator's**, one value for the server,
`FORMANCY_DATA_LOOKUP_DEADLINE_MS`, a whole number of milliseconds from 1 to
2147483647, the longest a Node timer holds; anything else stops the
process with a sentence naming it. An embedder passes
`runtime.lookupDeadlineMs`, held to the same rule: `createDataServer`
refuses anything else, naming the option. The default,
`DEFAULT_LOOKUP_DEADLINE_MS` in data-core, is derived, not chosen: the
slowest timed lookup or resolve answer in `docs/performance/results.json`,
across both engines, every block and every form, rounded up to the
millisecond, so no lookup or resolve answer the measurement timed would
have been refused -- today 536, from SQL Server's "Search no customer
matches" on the tenant-filtered form, reading 100,001 rows, at 8 in flight,
measured 2026-10-10 under 0034's publish protocol. Which scenario is a
lookup is the catalogue's `operation`, which the counting pass holds to the
route each scenario's request addressed, and the audit reconciliation to
what the server recorded. The harness runs its server with the deadline at
the longest a timer holds, so nothing it measures is cut. The page size and
`MAX_SEARCH_LENGTH` are unchanged.

A search that completes before its signal aborts is answered exactly as
before. 0012 and 0028 are untouched: a cancel only stops a statement, and
the retry runs the same statement under the same filters.

## Consequences

**What it buys.** A superseded search no longer runs to its end for nobody,
on either engine; no lookup statement runs longer than the operator allows;
a lookup's late cancel never stops a record's statement; and the default is
a measured number that moves when the figures do.

**What it costs.**
- **A search still reads every row its filter admits.** The deadline caps
  how long, not how much. A deployment past the measured size refuses
  searches instead of serving them slowly: fail closed, visible as
  `lookup-timeout` in the audit trail.
- **The default describes one block on one machine**: SQL Server's tenant
  search, reading 100,001 rows, 8 in flight, on the 0034 measurement's
  machine on 2026-10-10. A search of the whole table, which a form with no
  tenant row filter makes, was measured only one at a time, so its cost
  under concurrency is not in the default. It is the slowest timed answer:
  the warm-ups, which absorb opening the pool's connections, and the
  membership checks inside creates and updates, which the deadline also
  bounds, were not part of what it was derived from. A deadline equal to
  the slowest answer measured refuses whatever runs slower than anything
  measured, which a run on the same machine can. A slower or larger
  deployment must raise `FORMANCY_DATA_LOOKUP_DEADLINE_MS`.
- **The deadline does not cover reading the form or opening its
  connection**, which take no signal. A deadline that passes while a lookup
  waits for a pooled connection, or while postgres.js opens one inside the
  driver, is answered `lookup-timeout` too, though the same search may then
  answer.
- **The deadline is a timer in the server process, not in the database.** If
  the process dies, its statement runs on: PostgreSQL notices a gone client
  only when it sends, unless the operator sets
  `client_connection_check_interval`.
- **The PostgreSQL adapter reads and patches three private properties of
  postgres.js 3.4.9**, `state`, `describeFirst` and `canceller`. An upgrade
  that changes them fails the adapter's suite, and is a change to this
  record.
- **A PostgreSQL lookup abandoned before it was sent is still sent**, then
  stopped: a statement the database starts and a cancel request where none
  was needed. One aborted before PostgreSQL described it may be sent two
  cancel requests; when the first also stopped its execute, the second can
  arrive after the statement ended and stop the next lookup on that backend,
  and when both arrive after it ended, the first stops the next lookup and
  the second its one run more.
- **PostgreSQL uses up to twice the connections** per allowlisted database:
  two postgres.js pools, each at the driver's default size.
- **A PostgreSQL lookup stopped by another's late cancel runs twice**, and so
  does one stopped by an operator's own role-level `statement_timeout`. A
  lookup stopped by two late cancels is answered `unavailable`.
- **postgres.js keeps the FATAL of a backend an operator terminates** and
  gives it, unsent, to the first statement on the next connection it opens,
  a record's statement included; characterised by the PostgreSQL suite, not
  changed here.
- **Behind a proxy, the abort reaches the server only if the proxy closes
  its upstream connection when its client goes.** `deploy/web/nginx.conf`
  sets nothing that stops it (`proxy_ignore_client_abort` is off by
  default), but no test holds this, and the Cloudflare edge (0037) was not
  measured.
- **The person reads "The options could not be loaded. Type to try again."**
  At formancy 0.5.0 a source's message has nowhere else to go, and typing
  more does not make a contains search cheaper.
- **The published figures predate this record** and are stale until
  measured again, which blocks a release, not a pull request.
- **A page of records (0044) searches the same way** and gets neither
  cancellation nor a deadline. Its cost is not measured, so no default could
  be derived for it.
- **On SQL Server, mssql's default request timeout of 15 s still cuts any
  deadline set above it**, answered `unavailable`.
- **499 is not a standard status.** It appears only in the audit trail.

**What it does not do.** No index, no full-text search, no minimum length,
no prefix mode, no deadline per lookup or per connection, no change to a
record operation.

## Alternatives considered

**A trigram index.** `pg_trgm` cannot be assumed, SQL Server has none, and
the module does not own the schema.

**Full-text search** (`to_tsvector`, `CONTAINS`). It matches words, not
substrings, differently on each engine, which breaks 0028's one meaning,
and needs catalog objects the module does not create.

**Debounce in the client only.** Upstream debounces at 250 ms already; a
slower typist sends a search per key, and a debounce stops nothing in the
database.

**A minimum search length.** The rows read do not depend on the text, and
the empty search is needed.

**A prefix mode.** It changes the results, needs an index, and its plans are
unmeasured.

**`statement_timeout` through `SET LOCAL`.** 2 round trips per statement
become 5 or 6, measured.

**A pool-level `statement_timeout`.** It reaches writes on a shared client,
and on the lookups' client its 57014 cannot be told from a late cancel
without reading a localized message.

**SQL Server's per-request `requestTimeout`.** It excludes the wait for a
pooled connection, and would be a second mechanism beside the server's.

**A deadline counted from the route's start**, as first built. Loading the
form and opening a cold connection counted against it, and a first search
whose connection took longer to open than the deadline was answered "the
database was told to stop it" with no statement sent.

**`AbortSignal.any` over `AbortSignal.timeout`**, as first built. A timeout
signal cannot be cleared, and each request's composite stayed reachable
until its timer fired: about 730 bytes a request held for up to 24.8 days
at the longest deadline, measured in review on 2026-10-15 with Node
24.21.0 over 200,000 requests' worth of signals.

**`lookup-timeout` for a resolve too**, as first built. Its sentence would
say what is true of a search and not of a read by key, and one code would
mean two things.

**`query.cancel()`**, as first built. Its failure is a rejection nobody can
handle, which ended the process.

**Waiting for PostgreSQL's describe before the first cancel.** A statement
waiting in its parse, for a lock, would never be cancelled until the lock
went.

**A reserved connection per lookup** (`sql.reserve()`). It sends nothing it
was asked to cancel, but in postgres.js 3.4.9 releasing a connection after
it closed put it back in the pool with no socket, and the next lookup
crashed the process with an uncaught TypeError; and a reserve rejected while
its connection opened left its queue entry behind, which later took a
connection that was never released.

**A reserved connection with an absorbing `pg_sleep` before release.** It
needs a bound of its own, and was measured holding the connection in 3 of
76 raced cancels.

**`pg_terminate_backend` of one's own backend before release.** It crashed
postgres.js with an uncaught TypeError.

**`pg_cancel_backend(pid)`.** It needs the backend's pid -- a round trip, or
one more of the driver's properties -- and a free pooled connection to send
it on, which can deadlock under exhaustion.

**A deadline per lookup in the policy or the bindings.** Its right value
depends on the deployment's hardware and data, not the form; it would put
an operational time into a versioned bundle 0019 checks on every read,
need studio controls, and change only on republish.

**A fixed deadline.** A deployment slower or larger than the measured one
would refuse every search, with no way out.

**A deadline per connection** in `FORMANCY_DATA_CONNECTIONS`, for databases
of very different sizes. Left for when a deployment needs it.

## Older records

Extended, not edited away: 0012 (the lookup port carries the request's
signal); 0016 and 0017 (each adapter stops a lookup with its driver's own
cancel); 0025 (PostgreSQL lookups have a client of their own). Narrowed:
0034, whose "no remedy ships" is no longer true of cancellation or a
deadline, and extended: its default deadline is derived from its figures,
and its catalogue names each scenario's operation. 0015 is unchanged:
record operations are untouched.
