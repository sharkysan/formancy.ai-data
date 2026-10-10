# 0034 — Performance is measured through the shipped server against a sized lookup table, published with what it ran on, and held without a clock by what each operation reads and how often it asks the database

- **Status:** accepted
- **Date:** [TO FILL at merge: the merge date]
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-postgres/src/lookups-sized.integration.test.ts` — on the
  sized `sales.customer`, the statement `createPostgresLookups` actually
  sent, captured through postgres.js's `debug` hook and replayed under
  `EXPLAIN (ANALYZE)` as the writer, against `sizedRowsRead()` of
  `@formancy/data-fixtures`, the counts the SQL Server suite and the
  performance catalogue read too: in a session with parallel workers off,
  every search's scan on `customer` runs once, each tenant-filtered search
  and the first page return at most 51 rows and read exactly the tenant's
  100,001, and the same four on a form with no tenant filter read all
  1,000,002; resolving 100 keys or one reads at most a row per key and
  checking one reads exactly one, in that session and under the defaults;
  under the defaults, each search keeps the plan shape P3 found and its
  count within PostgreSQL 17's per-loop rounding. Watched failing with
  `filterSql` returning `[]` (8 cases: 1,000,002 read against 100,001, and a
  sequential scan), with no `limit … offset` (8: 100,001 or 10,000 rows
  returned), with `lookups.ts` asking for a limit of 10,000 (8: 10,001 or
  10,000 rows), with `"r"."customer_no" + 0` in the key tuple (4: about
  100,000 rows read), with the serial setting removed and parallelism forced
  (8: "a scan on customer ran more than once: expected 3 to be 1"), and, on
  2026-10-09 after review, with `+ 0` on both key columns of the resolve
  statement (6, the one-key resolve among them: 100,001 and 99,999 rows read
  where one is the most) and with `sizedRowsRead()`'s tenant raised by one
  (the 4 serial searches: "expected 100001 to be 100002"; under the defaults
  the rounding bound is wider than one row).
  `packages/data-sqlserver/src/lookups-sized.integration.test.ts` — the same
  searches through `createSqlServerLookups` as the writer, `ActualRowsRead`
  summed over every operator and thread on `[customer]` from the actual
  plan of that statement, against the same `sizedRowsRead()`: at most 51
  rows returned, exactly 100,001 read by seeks only with the tenant filter,
  1,000,002 without, at most a row per key resolving 100 keys or one, and
  exactly one for the membership check. Watched failing with `filtered()`
  removed (4: 1,000,002 read), with no `offset … fetch` (4: 100,001 or 10,000
  rows returned), with `+ 0` in the key match (2 before the one-key resolve
  was added: 99,003 and 100,001 read; 3 after it, on 2026-10-09: 99,003,
  100,001 and 100,001), with a limit of 10,000 in `lookups.ts` (4), and with
  `sizedRowsRead()`'s tenant raised by one (4: "expected 100001 to be
  100002").
  `packages/data-fixtures/src/sized.test.ts` — the generator: the same rows
  twice, the tenant counts and ranges in key order, names unique
  case-insensitively, code-point order equal to case-insensitive order over
  the tenant, the three search terms doing what they are named for, the
  expected page's order, the chunk's countries, `sizedRowsRead()` counted
  again over the rows the table holds, and each refusal of the read-back.
  Watched failing with a lowercase word in a list (the order case, naming
  the first disagreement), `absent` set to a stem, a multiplier sharing a
  factor with 10^6 (uniqueness and `unique`), `hasMore` with `>=`, the
  country chosen by tenant, the read-back comparing counts only, ignoring a
  missing row or ignoring an extra one (a case each), and a typed 100,000 in
  `sizedRowsRead()`.
  `packages/data-fixtures/src/sized.integration.test.ts` — the load reads
  back as the generator says on both engines, and one name changed by the
  owner is refused naming its key (watched failing with the verifier
  comparing counts only: "promise resolved instead of rejecting", once per
  engine). `packages/data-fixtures/src/fixtures.integration.test.ts`, "the
  fixtures' containers" — each fixture's `containerId` is a running
  container with the image the suites name (watched failing with an empty
  id: "(HTTP code 301) unexpected"); and `connectDocker()`, the reader the
  harness reads Docker through, lists both by the id `docker ps` shows,
  describes their images and limits, counts CPU that never goes backwards,
  and finds both images present and an absent one absent (watched failing
  on 2026-10-10 with ids cut to ten characters: "to deep equally contain";
  and with a 404 read as present: "expected true to be false").
  `packages/data-fixtures/src/tcp-hop.test.ts` — round trips are turns:
  request, reply, request is 2; two writes before a reply are 1; a reply in
  two reads is 1; two connections sum; a counter started later counts from
  then; a delay holds every answer until the injected scheduler runs, keeps
  order, holds the server's close behind it, and refuses a negative or
  infinite delay; and Nagle's algorithm is off on both of the hop's sockets,
  asked of the sockets rather than timed (watched failing counting client
  chunks instead of turns, 3 cases; forwarding before the scheduled
  callback, 4; each callback forwarding only its own chunk, 2; passing the
  close on at once, 1; no validation, 1; a zero delay ignoring held chunks,
  1; the hop as review found it: "the side the driver connects to: expected
  [] to have a length of 1").
  `packages/data-server/src/rate-limit.test.ts` — unset is 600 a minute;
  `1` and `10000000` are accepted; empty, `0`, `-1`, `1.5`, `abc`,
  `9007199254740993`, padded, `6e2` and `0x10` are refused with the sentence
  (watched failing with `Number(text)` and no whole-number check: 6 cases).
  `.github/workflows/gates.yml`, the container job's
  `FORMANCY_DATA_RATE_LIMIT` step, which `ci.yml` and `release.yml` both run
  (0035) — the server image with a limit of 2 answers three requests 401,
  401, 429, and with `abc`, otherwise configured, stops within 30 s naming
  the setting. Watched failing on 2026-10-09, while the step was in
  `ci.yml`, on the Docker Sandbox VM (Linux
  x86_64) on the user's Windows 11 workstation, with the step's own script
  run against an image built with `main.ts` as it was before this change,
  which never reads the setting: "three requests answered 401 401 401", and,
  its second half run alone against that image, "the server was still
  running after 30 s, or exited 0"; then passing against the image of this
  tree.
  `packages/data-performance/src/harness.integration.test.ts` — the whole
  harness with the smoke protocol on both engines: the eight forms and the
  two the refusals use publish, every content check passes, the counting
  pass equals the pins (the unfiltered forms, the floor and both refusals
  included, each refusal answered 409 `drift`), creates reference more than
  one customer, runtime events equal the harness's tally by operation, form
  and status, and the result validates as smoke and is refused as published.
  Every block's probe and database CPU are read in the idle gaps around it.
  Watched failing, each run ending with its own sentence: a second read in
  the read route ("The round trips differ from catalogue.ts", at the
  counting pass); a lookup limit of 51 ("pg lookup-first-page on
  pg-hop-order: answered 400 limit-out-of-range"); a lowercase-initial word
  in the generator, `adler` for `Adler` ("pg lookup-first-page on
  pg-hop-order: the page differs from the one the generator expects": on
  musl code-point order puts it after every capital, where SQL Server's
  case-insensitive collation agrees with the generator); the unfiltered
  form keeping the tenant row filter ("lookups.customer must pin
  sales.customer.tenant_id to tenant", at publish); on 2026-10-10, rebased
  onto 0041 with the pins as they were, the counting pass refusing with
  "PostgreSQL form: counted 2 round trips, the catalogue pins 0" and
  "PostgreSQL create: counted 6 round trips, the catalogue pins 4", and the
  same two lines for SQL Server; and, the same day, data-core's
  `planCreate` and then `planUpdate` built with their drift refusal skipped
  ("pg create-drifted on pg-hop-drifted: saved, where the catalogue says
  409 drift", and the same for `update-drifted`).
  The package's pure suites: `stats.test.ts` (watched failing with a floor
  rank, 3 cases, and with `n·(1 − q) ≥ 10` in floating point, 3, among them
  `supported(100, 90)`); `format.test.ts` (with `toPrecision(3)` for every
  value: "1.00e+3" for 999.5); `validate.test.ts` (each check deleted in
  turn fails exactly its own case: the smoke protocol, a missing block, a
  block twice or unnamed, p90 below p50, round trips against the pins and
  the floor's, an empty machine field, steal 0 where none is reported, a
  token-shaped string, a container running before, runtime events against
  requests, the missing tolerance, a field of the wrong type; after review,
  a proxy setting still carrying a user and a hop that, undelayed, took more
  than D longer than the same request direct, each failing before its check
  existed; on 2026-10-10, a refusal missing, twice, unnamed, against other
  pins or answered otherwise, failing before the check existed, and then
  its pin and its answer each removed alone, failing only its own case);
  `render.test.ts` (with p99 printed regardless of n: "null"; with
  `measuredAt` through `new Date(...).toString()`: the time-zone case; with
  the unfiltered rows unlabelled, steal printed as 0, rows read typed into
  the renderer, every runtime package listed, and D printed as a measured
  figure; after review, with the database's CPU per request printed whole
  and for requests that make no round trip, with no direct p50 beside the
  hop's, and with the write count's old sentence, "which the write-id cache
  (0031) holds within its own bound"; on 2026-10-10, after the rebase onto
  0035, a region never rendered, whose marker names no source, found and
  given the marker naming `results.json`, with the lookup on that marker
  alone: "the page needs both generated-region markers, start before end";
  and on 2026-10-10 the refusals' table, before it existed: "no section
  "Refused, counted and never timed"");
  `quiet.test.ts` (each of nine
  decisions removed in turn, and a repeated block keeping its first attempt
  instead of its second; after review, a block judged by the probe under its
  own load rather than in the gaps around it, 3 cases, and the dirty check
  reading the source files alone, without the build configuration);
  `network.test.ts` (a proxy URL's credentials kept; after review, a
  scheme-less `user:password@host` and a value no URL parser reads handed
  through whole: "alice:s3cret@proxy.example:3128");
  `machine.test.ts` (fields counted from the first `)`, guest time counted
  twice, steal of 0 reported); `server-log.test.ts` (events counted from
  request lines, level 50 missed, a line that is not JSON skipped, and audit
  lines, which carry no request id, left out of lines per request: 5 against
  8); `aggregate.test.ts` (CPU per request as a mean of the rounds' ratios,
  an infinite ratio without round trips, steal 0, the middle of the rounds'
  p50s instead of the pooled p50; after review, no idle CPU rate and the
  calibration taken from the probe under load); `catalogue.test.ts` (a typed
  100,000; after review, a typed 100,002 where `sizedRowsRead()` says
  100,001); `calibration.test.ts` (P13's spread from window means instead of
  medians; after review, each window against the whole run's median rather
  than the slowest gap against the fastest baseline window, which reads 1.25
  where the run's statistic is 1.6); `sampler.test.ts`, after review (an
  idle gap that held no whole probe judged by the next probe after it, which
  runs under the next block's warm-up: "expected 2 to be 1");
  `drifted.test.ts`, on 2026-10-10 (the refusals' case held to stopping
  both writes while allowing reads, on both engines: each check removed in
  turn, "expected [Function] to throw an error", a case each).
  `scripts/performance-stale.test.mjs` — on a repository in miniature, a
  changed byte of an imported file is named, and a test, an unreached file,
  a type, a declaration package and a version bump are not; an added or
  removed imported file is named; a transitive dependency's version change
  is named with both versions; a reached package's build configuration and
  the tools' versions are named; a missing required dependency throws; on
  this repository the walk finds the core's query rules and its runtime
  drift decision, the hop, the shared drift case, the fixture SQL and the
  catalogue, not the fixture model, the renderer or a test, and the runtime
  closure holds `postgres`, `mssql`, `tedious`, `fastify`, `pino` and
  `@formancy/spec` (watched failing on 2026-10-10 with `drifted.ts`
  importing the case as a type only: "expected [ …(157) ] to include
  'packages/data-fixtures/src/drifting.ts'"; and with the server's
  package.json hashed too: the version bump is stale; with versions resolved
  through `createRequire(...).resolve(name + '/package.json')`: 7 cases,
  "Package subpath './package.json' is not defined by "exports""; with every
  re-export of an index followed: `model.ts` appears; with `@types/*`
  counted: the declaration package is stale); and `release.yml`, parsed
  with `yaml`, has exactly one step that runs the comparison, in a job its
  publishing job waits for through `needs`, neither `--describe` nor
  allowed to fail nor skipped by an `if:` on the job or on the step, and
  neither `gates.yml` nor `ci.yml` runs it at all (first written over the
  workflow's text and watched failing before the job existed, with it
  dropped from the publishing job's `needs`, with `--describe`, with
  `continue-on-error: true` on the job and with `if: ${{ false }}` on the
  step; rewritten when 0035 gave the release its five jobs, and watched
  failing again on 2026-10-10: with `check` dropped from `publish`'s
  `needs`, "expected [ 'tag', 'npm-token', 'gates' ] to include 'check'";
  with `--describe`, "expected [] to have a length of 1 but got +0"; with
  `continue-on-error: true` on the step and on the `check` job, and
  `if: ${{ false }}` on the step, each naming the key; and with a step in
  gates.yml's `verify` job running it with `--describe`); and the command
  itself, the two scripts copied into the miniature
  with figures recorded on it, exits 0 while they describe it and 1 naming a
  changed file, run directly and through a symlinked path alike, and 1 with
  no figures at all (watched failing through the symlink: the script
  compared its real path with the path it was run by, did nothing and
  exited 0, `{ status: 0, said: '' }`; the command now has no such check).
  `scripts/performance-doc.test.mjs` — the page's region is what
  `results.json` renders, and the result validates as published against the
  catalogue it carries. Watched passing on a made-up published result
  rendered into the page, then failing with one figure in the page edited
  by hand, and with that result's protocol made `smoke` ("protocol.name:
  smoke, where a published result is measured with the publish protocol").
  Until the first measurement is committed it fails because
  `docs/performance/results.json` does not exist, as intended: no figures,
  no merge.

## Context

Plan release gate 11 asks for published performance figures that include
the database's size, the hardware, the network conditions and the
percentile. The plan's fixtures include "a lookup table large enough to
expose accidental full-table loading", and its usability target is familiar
lookup interactions "without loading the whole referenced table". Budgets
are published as measured results, not promises.

Before this record no runtime route had a figure, no plan had been read for
a contains search or a first page over a large table,
[0019](0019-a-published-form-is-checked-every-time-it-is-read.md) deferred
caching the published version "until a request profile says so", and the
shipped binary throttled each client address to its default limit while
`app.ts` (line 25 at 4536125) told an operator behind a proxy to set "a
limit to match" that `main.ts` (line 108) never read.

What the design rests on, as of 4536125, the commit this branch started
from:

- **A page is capped and fetched plus one.** `validateLookupQuery` refuses a
  limit above `maxPageSize` (`data-core/src/lookup/query.ts:69`), which is
  `DEFAULT_MAX_PAGE_SIZE = 50` (`config.ts:16, 227`) because the server
  builds every lookup with the snapshot alone
  (`data-server/src/routes/runtime.ts:361`). PostgreSQL asks for limit + 1
  (`data-postgres/src/lookups/sql.ts:117-119`) and trims to the page in
  `lookups.ts:46`; SQL Server fetches limit + 1 by `offset … fetch`
  (`data-sqlserver/src/lookups/statements.ts:111-117`) and puts a `case …
  is null` ahead of every sort column (`statements.ts:93`).
- **A search is a leading-wildcard contains** on both engines, and the
  order is by `name`, which has no index; row-level security shows the
  writer tenant 1 through a predicate, `current_user <> 'formancy_writer'
  or tenant_id = 1` (`fixtures/postgres.sql:155`; `sqlserver.sql:147`),
  that neither engine can seek on. The policy's own tenant filter can.
- **Every adapter statement is two round trips today.** mssql validates a
  pooled connection on every acquire unless told otherwise
  (`lib/base/connection-pool.js:73`), with `SELECT 1;`
  (`lib/tedious/connection-pool.js:152`), through tarn 3.1.2;
  `connectSqlServer` sets nothing. postgres.js's `unsafe` is unprepared
  (`src/index.js:119-125`), and an unprepared query with parameters is
  described first (`src/connection.js:238`); every PostgreSQL statement goes
  through `sql.unsafe` (`data-postgres/src/sql/statement.ts:55`).
- **A tenant-filtered form cannot have an unfiltered lookup**:
  `lookupProblems` (`data-core/src/policy/validate.ts:28`), applied at
  publish through `validatePolicy` (`data-server/src/bundle.ts:140`), refuses
  a lookup that sets a row-filtered column without pinning it. A form with no
  tenant row filter is a different policy.
- **On the writer's order form**, an update reads the record and then
  updates it, and a create checks the customer's membership and inserts.
- **The renderers** (`@formancy/react` 0.3.0, read 2026-10-09) debounce a
  search and abort the superseded fetch; the server passes no signal to the
  adapter, so the database finishes every scan it started.

What changed under it when the branch was rebased on 2026-10-10 onto
`cfa8200`, which had gained 0036 to 0042:

- **[0041](0041-the-runtime-refuses-what-drift-blocks.md) decides every
  record request over a description of the form's own table read in that
  request.** Opening the form is that description, one statement where it
  was none; a create describes, checks the customer's membership and
  inserts, three where it was two; a read and an update by someone who may
  read carry it in the statement that reads the record, so they stay at one
  and two. PostgreSQL under READ COMMITTED, the fixture's default, and SQL
  Server alike; under another isolation PostgreSQL takes a lock first in a
  transaction of its own, which no scenario here runs. This record now
  pins those counts, and counts two refusals beside them: a create and an
  update on a form whose table drift review says stops both writes, each
  answered 409 `drift` and sending nothing past the description it was
  decided over.
  The catalog walk inside each statement adds time no count separates.
- **[0040](0040-instants-and-times-are-read-to-the-shape-and-an-unedited-one-is-never-written.md)**
  reads instants and times to the field's shape and reads the record before
  every update. The order form has neither an instant nor a time, so no
  answer a scenario checks changed, and the update already read first.
- **[0042](0042-generated-forms-stay-on-spec-3-after-spec-4-is-released.md)**
  moved upstream to 0.4.0: `@formancy/react` 0.4.0, read 2026-10-10, keeps
  the 250 ms debounce, no minimum query and 50 rows, and still aborts the
  superseded fetch. [0039](0039-a-publish-says-what-happens-to-the-grants-of-reassigned-keys.md)
  asks a publish about reassigned keys only over an earlier version; the
  harness publishes every form once, from no version.

What the review of this change measured, on the same Docker Sandbox VM
(Linux x86_64) on the user's Windows 11 workstation, on 2026-10-09 between
22:57 and 23:20 UTC, beside the live demo and another worktree's suites (load
average 1.8 to 2.7), with the harness built from this branch, and what
changed because of it:

- **The calibration probe slows under the run's own load.** `lscpu` shows
  20 vCPUs of an i9-10900K, a part of 10 cores and 20 threads, presented as
  20 cores of one thread each, so the guest can neither keep the probe off a
  busy vCPU's sibling nor see the clock fall as more cores work. In a scratch
  run the probe's median was 1.08 times the baseline (1.56 at most) over the
  35 blocks with the machine under 25% busy, and 1.69 (1.26 at least) over
  the 13 at 40% or more; with threads of SHA-256 beside it, 1.37 at 4, 1.32
  at 8, 1.42 at 16 and 2.75 at 19, against 0.79 to 1.06 idle. Rechecked at
  23:42 UTC with the same workload at a 100 ms interval in 8 s windows: 1.04
  at 4 threads, 1.21 at 8, 1.86 at 16. A tolerance taken from idle minutes
  would have repeated and refused the busiest blocks, and one wide enough
  to pass them could not see what it is there for. The P13 the design
  described also measured each window against the whole run's median,
  which leaves out the error of the one window the run takes as its
  baseline. The probe is now read only in an idle gap before each block's
  warm-up and after its timed window, and P13 measures what the run judges.
- **The TCP hop left Nagle's algorithm on**, Node's default; tedious turns
  it off on its own socket. Through the hop, undelayed, a 100-key resolve on
  SQL Server took 92.0 ms at p50 against 13.7 ms direct, and a create 55.8
  against 14.7; with no-delay on every socket the harness made, 8.85 against
  10.8 and 12.3 against 13.9. PostgreSQL through the hop matched direct. The
  hop now turns it off on both its sockets, the added-latency table prints
  the direct p50 beside it, and a published result is refused when the hop
  undelayed is more than D slower than direct.
- **The database's CPU per request carried the engine's own work.** During
  `/health` and the form, which make no round trip, PostgreSQL's container
  used 94 to 566 ms of CPU a second, published as 0.13 to 2.25 ms per
  request, while autovacuum and autoanalyze of `customer` and `order`
  stayed at 0. The idle gaps now read the container's CPU too, the page
  prints the per-request figure with that rate taken off and the rate
  beside it, and none for a request that makes no round trip, and the
  disturbances count autovacuum, autoanalyze and statistics updates on any
  table.

The probes, run on a Docker Sandbox VM (Linux x86_64) on a Windows 11
workstation, 20 vCPUs presented by Microsoft's hypervisor, with Docker
29.8.1, PostgreSQL 17.11 on musl and SQL Server 2022 16.0.4295.3 CU27
Developer, SQL_Latin1_General_CP1_CI_AS:

- **P1** (2026-10-09, about 20:45 UTC): SQL Server orders the generated
  names exactly as `sizedLookupPage` does; every tenant search and both
  unfiltered first pages equal it, so the word lists needed no change.
- **P2**: `sys.dm_exec_query_plan_stats` with `LAST_QUERY_PLAN_STATS` on
  gives `ActualRows` per thread but no `ActualRowsRead`. The test reads the
  actual plan of the adapter's own statement from an Extended Events session
  on `query_post_execution_showplan`, limited to `formancy_writer`. The
  design's fallback, `SET STATISTICS XML` over text the test builds, was not
  used: a limit raised in `lookups.ts` would be invisible to it, and under
  the Extended Events capture that mutation fails with 10,001 rows.
  Tenant searches read exactly 100,001 through a parallel Clustered Index
  Seek; unfiltered ones 1,000,002 through a Clustered Index Scan.
- **P3**: no sequential scan for the tenant. Under the defaults and
  serially, a Bitmap Heap Scan over a Bitmap Index Scan of `pk_customer` on
  `tenant_id = 1`; the default plan is parallel (Gather Merge, two workers).
  Unfiltered searches are a sequential scan, parallel under the defaults. A
  100-key resolve is a nested loop probing the index once per key, so the
  serial session's single-loop check applies to the searches only, and the
  resolve is held to at most 100 rows read in both sessions.
- **P4** (2026-10-09, about 22:00 UTC, the harness with the smoke
  protocol): counted through the hop, on both engines, `/health` and the
  form 0 round trips; every lookup, both resolves, a read and the floor 2;
  a create and an update 4. The drivers' code predicted exactly that, and
  `catalogue.ts` pinned it. Counted again on 2026-10-10 after the rebase onto
  0041, by the same pass before the pins moved: the form 2 and a create 6
  on both engines, everything else unchanged, which is 0041's own count;
  `catalogue.ts` now pins those, and both refusals at 2 on both engines,
  as the smoke run counted them at about 16:08 UTC: a create's describe,
  and the read an update makes anyway.
- **P5** (an index on `(tenant_id, name, customer_no)` created and dropped
  by the probe): on PostgreSQL the first page and `bau` become an ordered
  index-only scan that stops early (51 and 331 rows read), while a search
  matching one customer or none still reads all 100,001 and an unfiltered
  search stays a sequential scan; on SQL Server the first page still reads
  100,001 and sorts them, because the `case … is null` blocks an ordered
  scan. Not shipped and not published.
- **P6**: loading took 34.5–35.4 s on PostgreSQL (the insert about 33 s)
  and 15.0–15.2 s on SQL Server (about 13 s) with the machine otherwise
  quiet, and 35.9 s and 19.7 s during the smoke run beside other work.
  [TO FILL from this pull request's CI: the load seconds in the
  data-fixtures, data-postgres, data-sqlserver and data-performance jobs;
  with them `LOAD_SECONDS` and its comment in
  `packages/data-performance/vitest.config.ts`; and whether the other three
  suites' hook timeouts need raising.] Those were left as they were on local
  load times alone. data-postgres's is shorter than data-fixtures' and
  data-sqlserver's, and its sized file's `beforeAll` now loads the table on
  top of the image pull the timeout was set for.
- **P7**: testcontainers' runtime client reads one-shot container stats on
  Docker 29.8.1, the cumulative CPU nanoseconds and memory in one read of
  9 to 89 ms. Docker Desktop was not available to try.
- **P8**: the branch started after 0033 merged. `main.ts` passes the audit
  planes and the rate limit, and in the smoke run every audit event carried
  its plane: 16 administrator events for 16 requests, and runtime events
  equal to the harness's tally. Again on 2026-10-10 after the rebase onto
  `cfa8200`: 20 administrator events for 20 requests, the two drifted
  forms' among them, and runtime events equal to the harness's tally, the
  refusals' 409s included.
- **P9**: JIT never fired. `jit` is on, `jit_above_cost` 100,000 and
  `pg_jit_available()` true, but no plan cost more than 35,584 under the
  defaults or 69,968 serially (the unfiltered first page).
- **P10**: [TO FILL from the measurement run: autovacuum, autoanalyze,
  recompile and statistics-update counts per block, on any table, and which
  blocks, if any, they cluster in; and the databases' idle CPU rates in the
  gaps, and which blocks they are highest after.]
- **P11** (2026-10-09, about 22:10 UTC, beside other work, load average
  about 4.4): inserting the million generated customers into a copy of
  `sales.customer` took 42.0, 39.5, 37.7, 38.3 and 40.1 s on PostgreSQL and
  15.3, 13.6, 12.1, 12.5 and 11.6 s on SQL Server at 10,000, 25,000, 50,000,
  100,000 and 200,000 rows a chunk. Past 25,000 the differences are within
  what the machine did on its own, so the loaders keep 50,000, about 2.9 MB
  of JSON a statement.
- **P12** is not part of this change.
- **P13**: [TO FILL from the measurement run: the output of
  `pnpm --filter @formancy/data-performance run calibrate` over ten idle
  minutes on the quiet machine -- the slowest idle gap's median, a gap as
  long as the protocol's, against the fastest window as long as the quiet
  check's -- and the tolerance it sets in `protocol.ts`.]
- **P14**: [TO FILL from the measurement run: whether 200 samples per
  latency pass gave a median difference whose round-to-round spread is
  under a tenth of D, and how far the hop undelayed sat from the direct p50
  for each request, against the bound of D.]

The machine the figures were measured on is described in the generated
region of `docs/performance.md`, as its hypervisor presents it; it is not
retyped here.

## Decision

- **A sized `sales.customer`**, opt-in, in `@formancy/data-fixtures`: a
  million generated customers beside the fixture's own, a tenth in the
  measured tenant, generated once, loaded identically into both engines
  from one JSON text per chunk, and read back row by row.
- **The shipped `main.mjs`** as a child process, configured only through its
  environment, over real HTTP through `@formancy/data-client`, as the
  writer, with the per-address limit raised through a new public setting,
  `FORMANCY_DATA_RATE_LIMIT`.
- **Closed loop at one and several in flight, and an added-latency block**
  through a TCP hop that adds its delay and, undelayed, at most that much
  to a published result's p50, with the publish protocol in code
  (`packages/data-performance/src/protocol.ts`). Every block waits an idle
  gap, nothing in flight, before its warm-up and after its timed window; a
  calibration probe and the database's idle CPU are read there and nowhere
  else.
- **Results committed** as `docs/performance/results.json`, carrying the
  catalogue and protocol they were measured with, and rendered into
  `docs/performance.md`.
- **Rows sent, rows read and round trips pinned on both engines in CI**;
  timing never gated. Beside the measured requests, two refusals are
  counted and never timed: a create and an update on a form whose table
  changed so that drift review stops both writes (0041), the shared
  `narrowed-decimal` case of `DRIFTING`, granted to the writer, each held to
  409 `drift` and to the round trips of the description it was decided
  over.
- **Staleness named, not guessed, and a stale release refused**:
  `scripts/performance-stale.mjs` compares the source files the measurement
  runs, found by following its imports, the installed runtime closure of the
  server and the client, and the build inputs, with what the results
  recorded. `release.yml` runs it in its `check` job, which the publishing
  job `needs`, so a release whose product differs is not cut until somebody
  re-measures, and a rehearsal says so first. CI does not run it.
- **In the release report** (0035), gate 11's evidence is
  `docs/performance.md`, a document: every report shows the gate as stated
  by it, with its last change, never as passed in the run. The harness's
  suite runs in the gates' test matrix and its results reach the report as
  every package's do.

## Consequences

**What it buys.** A host can see what each interaction costs and why: rows
read and round trips explain the figures, and the added-latency table shows
what a slower network between the server and the database adds. A change
that loads a table, reads past a tenant or adds a database round trip fails
CI on both engines. 0019 gets a figure, at the fixture snapshot's size. The
two driver behaviours that double every statement's round trips are named,
with their remedies -- `validateConnection: 'socket'` for mssql, prepared or
typed statements for postgres.js -- for decisions of their own.

**What it costs.**

- **Every release whose measured code, runtime dependencies or build
  inputs changed must be re-measured** on a quiet Linux machine, for as long
  as a run takes ([TO FILL from the measurement run: its duration and date]).
  In practice, every release.
- **CI time**: the fixtures, PostgreSQL and SQL Server suites each load a
  million customers, and the gates' test matrix gains a job that runs the
  harness; a release runs the same gates, each suite on a runner of its own
  (0035). The stale check is a step of the release's `check` job, after the
  install it already makes, and the container gate starts the image twice
  more.
- **The figures describe one machine**, the one the generated region names,
  as its hypervisor presents it: loopback HTTP, databases through Docker's
  published ports, no TLS; warm caches, both images' default settings, SQL
  Server's Developer edition, PostgreSQL on musl and so in code-point order;
  one server process, the order form on the writer's account; a customer
  table loaded in key order (an interleaved PostgreSQL heap is not
  measured) and an order table grown only by the run; closed-loop load, so
  tails under an arrival rate are not measured, and nothing past the pools'
  size; one page size; not the Alpine image, not 0032's proxy; PostgreSQL
  under READ COMMITTED only, so 0041's lock-first path under another
  isolation is neither counted nor timed.
- **0041's description is inside the figures, not beside them.** The
  counting pass shows the statements it adds; the catalog walk PostgreSQL
  plans and runs inside each describe, read and write, and SQL Server's in
  each describe and read and after each write, is in those statements' time
  and is not separated from the rest of it.
- **A refusal's time is not measured**, only its round trips, which are
  what show it sent nothing past its description. How long a host waits to
  be told 409 `drift` is not on the page.
- **Host activity outside the VM cannot be observed.** The hypervisor
  reports no steal; the calibration probe sees contention only on the CPU
  it ran on, and only in the idle gaps around each block: it slows under
  the run's own load too, so contention during a block's own load cannot be
  told apart from that load, and is not seen.
- **Every block waits two idle gaps**, which lengthens every run by that
  much for each block.
- **The database's CPU per request is net of an idle rate**, the
  container's CPU per second in the gaps around the block. Work the engine
  did on its own only while the block ran is still in it; the rate is
  printed beside it.
- **A published result is refused when the hop, undelayed, was more than D
  slower at p50** than the same request sent directly. D is the bound
  because it is the size of what the block measures: a choice, not a
  measurement.
- **The added-latency table covers one leg.** The browser's leg to the
  server, TLS, bandwidth and TCP's congestion window are not in it.
- **A contains search grows with the rows a filter admits.** Two sizes are
  measured, not a curve. No remedy ships: no trigram index (`pg_trgm`
  cannot be assumed, and SQL Server has none), no prefix mode, no minimum
  length, no statement timeout on PostgreSQL, no cancellation of an
  abandoned search.
- **The round-trip pins fail on any change that adds a statement**,
  deliberately. Updating the pin is part of such a change, and it makes the
  figures stale.
- **A latency regression that changes neither rows nor round trips** is
  found only at the next measurement.
- **`FORMANCY_DATA_RATE_LIMIT` is one more setting**, and `trustProxy` is
  still not offered: behind a proxy it raises the one shared bucket.
- **The run's write count is recorded** beside the write-id cache of
  [0031](0031-an-answer-lost-after-a-write-is-unknown.md). It is not a claim
  about that cache's bound.
- **The product walk follows imports by pattern**, not with a TypeScript
  parser, and does not follow the build toolchain's own dependencies. A test
  on the real repository holds what it finds. Declaration packages
  (`@types/*`) are left out of the runtime closure, as `import type` is left
  out of the walk: neither runs.

**What it forecloses.** `FORMANCY_DATA_RATE_LIMIT` becomes a public setting
of the published `@formancy/data-server`: renaming or removing it breaks an
operator's configuration. `@formancy/data-performance` is private and never
released, so nothing else in it is a contract.

## Alternatives considered

- **A timing gate in CI** ("a lookup must answer in under X ms"): CI's
  runners are shared, and the contention recorded in `gates.yml` pushed a
  two-second test past sixty seconds. A gate would be meaningless or flaky.
- **Budgets as promises**: the plan asks for measured results.
- **Proving "no full load" by timing alone**: passes for the wrong reason as
  soon as the machine is fast. Rows read are exact.
- **Counting rows sent with a protocol parser at the hop**: the plan's top
  node gives the same number exactly, with no framing code to keep correct.
- **Explaining SQL the test builds**: it would never reach `lookups.ts`,
  where a raised limit would hide.
- **Exact PostgreSQL counts from `pg_stat_user_tables`**: whether a parallel
  worker's counts are flushed when the leader returns is a race nobody here
  has proved. The serial session is exact without it.
- **Asserting that latency multiplies by round trips without measuring
  it**: a claim nothing measured. The added-latency block measures it.
- **`createDataServer` in-process, or `app.inject`**: a second composition
  root that can drift from `main.ts`, and not HTTP; the shipped logger and
  audit would go unmeasured.
- **The server image under Docker**: adds musl Node and a second userland
  network path; it belongs with 0032's stack, as a later profile.
- **The owner account**: PostgreSQL's superuser bypasses row security, so
  it would measure what production must not do.
- **Staying under the default limit, or many source addresses**: ten
  requests a second cannot keep several in flight, and spreading load over
  addresses misrepresents the server.
- **autocannon, k6 or wrk**: new dependencies that know nothing of write
  ids, version chains or content checks.
- **Open loop first**: no arrival rate is yet worth asking about.
- **A schema of its own, or SQL generators per engine**: the first measures
  a lookup no published form uses; the second is two implementations of one
  decision that only a read-back would see disagree.
- **Interleaved tenants**: measures PostgreSQL's heap locality as much as
  the product, near a plan threshold.
- **An index on `name`**: discovery cannot see it, and the generator cannot
  ask for it. P5 records what one would change.
- **Committing raw samples**: megabytes per release; the summary is what is
  published.
- **A digest check on every pull request, or validating against the current
  catalogue in `pnpm test:repo`**: either blocks every product change until
  somebody re-measures on a quiet machine.
- **Every file under each package's `src/`, direct versions only, or
  `pnpm ls`**: the first marks the figures stale for changes that measure
  nothing new; the second misses a transitive change under a caret range;
  the third is an output shape the repository does not control and a script
  no test could run without pnpm.
- **CPU quotas or cpusets for the databases**: testcontainers 12.2 has no
  cpuset, and CFS quotas add tail latency of their own. Busy time and the
  calibration probe are recorded instead. Keeping the stack off one vCPU
  and pinning the probe there would not keep it off that vCPU's hyperthread
  sibling either, which this hypervisor does not show the guest.
- **Judging a block by the probe while the block runs**, as first built:
  the probe slows under the run's own load, so a tolerance either refuses
  undisturbed blocks or is too wide to see anybody else.
- **Pinning image digests for the measurement only**: it would measure an
  image the suites do not test; the digests are recorded instead.
- **A synthetic snapshot curve for 0019**: it would measure a schema nobody
  discovered.

## Older records

[0005](0005-one-fixture-written-twice.md) is extended: the fixture gains the
opt-in sized `sales.customer`, generated once and loaded into both engines
from one text, and its Status line says so.
[0035](0035-a-release-report-is-derived-from-the-run-that-gated-it.md) is
extended, as it said it would be for gate 11: the release's `check` job
also runs the stale check, gate 11's evidence is `docs/performance.md`,
stated and never passed, and the container gate also checks
`FORMANCY_DATA_RATE_LIMIT`. Under its rule that only `@formancy/data-fixtures`
declares testcontainers, the harness reads Docker -- the daemon, the running
containers, an image's presence, a container's limits and counters --
through that package's `connectDocker()`, which starts nothing.
[0019](0019-a-published-form-is-checked-every-time-it-is-read.md) and
[0031](0031-an-answer-lost-after-a-write-is-unknown.md) are applied, not
changed: 0019's read of the published version gets a figure at the fixture
snapshot's size, and the run's write count is recorded beside 0031's cache
without a claim about its bound.
[0041](0041-the-runtime-refuses-what-drift-blocks.md) is applied, not
changed, as it said it would be when this record's harness merged: the
pins carry its describe, and its two refusals are counted. Nothing here
pins its PostgreSQL figures under another isolation, which it says too.
