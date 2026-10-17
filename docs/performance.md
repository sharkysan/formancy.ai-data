# Performance

What every request a host sends to the runtime plane costs: opening a form,
opening the customer lookup and searching it, resolving stored selections,
reading, creating and updating an order; and what a write the runtime
refuses because the form's table changed still asks the database. Measured
results, not promises
([0034](./decisions/0034-performance-is-measured-through-the-shipped-server-and-held-without-a-clock.md)).
All but a page of records, the menu of forms and a delete, which the
harness does not measure yet
([0044](./decisions/0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md)
names what measuring a page needs). The server measured has the lookup
limits
([0061](./decisions/0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md)):
a lookup's signal and PostgreSQL's second client for lookups are in it,
and its deadline is set to the longest a timer holds, so no timed answer
was cut by one, and the default deadline is derived from these figures
([0063](./decisions/0063-the-default-lookup-deadline-is-outside-the-measured-product.md)).

The requests go through `@formancy/data-client` and real HTTP to the shipped
server, `packages/data-server/dist/main.mjs`, started as an operator starts it
and configured only through its environment, on PostgreSQL and on SQL Server.
The database behind it is the fixture's order schema with `sales.customer`
filled with generated customers, read through the order form's own
least-privilege account, which row-level security confines to one tenant.
Beside the figures are the database's size, the machine as its hypervisor
presents it, the network path and the date.

Everything between the two markers below is rendered from
[`docs/performance/results.json`](./performance/results.json) by
`@formancy/data-performance`; nothing in it is typed, and a test fails when it
differs from what the results render.

## What holds each claim

- **What a lookup reads and sends.** On both engines, against the sized table,
  in CI on every pull request:
  `packages/data-postgres/src/lookups-sized.integration.test.ts` and
  `packages/data-sqlserver/src/lookups-sized.integration.test.ts` read the plan
  of the statement the adapter actually sent. A lookup hands the server at most
  a page and one more row. With the tenant row filter the database reads that
  tenant's rows and no others, and every one of them for every search: no index
  serves a contains search or the order by name, on either engine. On a form
  with no tenant row filter it reads the whole table, a cost those tests pin.
  A resolve and the membership check read at most one row per key.
- **What stops a lookup.** On both engines, against a table its owner holds
  locked so a statement waits in the database
  ([0061](./decisions/0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md)):
  each adapter's `lookups-limits.integration.test.ts` holds that an aborted
  search, resolve or membership check stops waiting before the lock goes;
  `packages/data-server/src/routes/runtime-lookup-limits.integration.test.ts`
  that a browser's abandoned search does the same over HTTP, that a search
  past the deadline is 503 `lookup-timeout` and a resolve 503 `unavailable`;
  and
  `packages/data-client/src/lookups.integration.test.ts` that a renderer's
  abort does. Every existing lookup suite passes a signal that never aborts
  and holds its answers, round trips and rows read unchanged.
- **The default lookup deadline.**
  `packages/data-performance/src/deadline.test.ts` fails when data-core's
  `DEFAULT_LOOKUP_DEADLINE_MS` is not the slowest lookup or resolve answer
  `results.json` holds, rounded up: after a re-measurement, until it
  follows. Which scenarios are lookups is the catalogue's `operation`, which
  the counting pass refuses a run to contradict. The harness's own server
  runs with the deadline at the longest a timer holds, so nothing it
  measures is cut.
- **How often each request asks the database.** Every measurement counts the
  database round trips of each request through a TCP hop
  (`packages/data-fixtures/src/tcp-hop.ts`) and refuses to run when the count
  differs from `packages/data-performance/src/catalogue.ts`. In CI,
  `packages/data-performance/src/harness.integration.test.ts` runs the whole
  harness briefly on both engines and checks every answer, every count and the
  audit reconciliation, never a time.
- **What a write drift review stops still sends.** On a form whose own table
  its owner changed after publishing, so that drift review stops both writes
  and still allows reading -- the shared `narrowed-decimal` case of
  `DRIFTING` in `@formancy/data-fixtures` -- a create and an update are
  answered 409 `drift`
  ([0041](./decisions/0041-the-runtime-refuses-what-drift-blocks.md)), and the
  same count holds them to the database round trips of the description they
  were decided over and nothing more. They are counted, never timed.
- **This page.** `scripts/performance-doc.test.mjs`, in `pnpm test:repo`, fails
  when the region below is not what `results.json` renders, and when the
  result does not validate as a published measurement: the publish protocol,
  a quiet check the run enforced with no other container running, every
  block and every refusal the catalogue names, its
  round trips equal to the pins it was measured against, each refusal
  answered as the catalogue says, every runtime request the harness sent
  an event in the server's audit trail, and a TCP hop that, undelayed, was
  within its own delay of the same request sent directly.
- **That the figures still describe the product.**
  `node scripts/performance-stale.mjs` compares the source files the
  measurement runs (found by following its imports), the installed runtime
  dependencies of the server and the client, and the build inputs with what
  `results.json` recorded, and names every difference. The release
  workflow runs it in its `check` job, which publishing waits for, so a
  release, and a rehearsal before it, is refused while it names one; CI does
  not run it, so a pull request is never held for want of a re-measurement.
  `scripts/performance-stale.test.mjs` fails when publishing stops waiting
  for it, when the step is skipped or allowed to fail, when the gates run it,
  and when the command itself passes a product that changed.
- **In the release report.** Release gate 11 names this page as its
  evidence ([`docs/release/gates.json`](./release/gates.json)), so every
  report shows the gate as stated by it, with its last change, and never as
  passed in that run: a CI runner measures nothing here
  ([0035](./decisions/0035-a-release-report-is-derived-from-the-run-that-gated-it.md)).

No time is asserted anywhere in CI: its runners are shared, and a timing gate
there would be either too loose to mean anything or flaky.

## What the figures do not show

- **One machine**, the one the region names, as its hypervisor presents it.
  Host activity outside the VM cannot be observed when the hypervisor reports
  no steal; the calibration probe sees contention only on the CPU it ran on,
  and only in the idle gaps around each block. It slows under the run's own
  load too, so contention during a block's own load cannot be told apart from
  that load, and is not seen.
- **The database's CPU per request** is its container's CPU over a block,
  less what the container used per second in the idle gaps around it. Work
  the engine did on its own only while the block ran -- a checkpoint, an
  autovacuum of any table -- is still in it; the idle rate is printed beside
  it.
- **Loopback HTTP and no TLS**, between the client and the server and between
  the server and the databases, which are reached through Docker's published
  ports. Not the server's Alpine image, and not the composed stack's proxy.
- **The added-latency table covers one leg**, the server's to the database:
  it shows what holding every database answer adds, against the round trips
  counted. The browser's leg to the server, TLS, bandwidth and TCP's
  congestion window are not in it.
- **An added-latency difference is no finer than the machine's drift.** Each
  request's undelayed and delayed passes run one after the other, so what the
  machine drifted between them is in the difference. For some requests it
  moved between rounds by more than a tenth of the delay, which more samples
  a pass did not remove (0034, P14); the table prints the median of the
  rounds' differences, not their spread.
- **Warm caches and default settings**: both images as the suites run them,
  SQL Server's Developer edition, and PostgreSQL on musl, which orders text by
  code point. A glibc or ICU PostgreSQL compares by locale for every row a
  search reads, and is not measured.
- **One server process**, the order form, the writer's account, one page size.
  The customer table is loaded in key order, so an interleaved PostgreSQL heap
  is not measured; the order table grows only by the run's own writes.
- **Closed loop**: each request starts when one finishes, so a slow answer
  delays the next. No arrival rate is modelled, so tails under an arrival rate
  are not measured, and nothing past the drivers' pool size is.
- **A contains search grows with the rows the filter admits.** Two sizes are
  measured, the tenant and the whole table, not a curve. What ships bounds
  how long a search runs, not how much it reads
  ([0061](./decisions/0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md)):
  the renderers abort a superseded search's request while it is in flight
  (`@formancy/react` 0.5.0, run 2026-10-14: a search 250 ms after the last
  key, so six keys 300 ms apart send six searches and abort five), and the
  server now stops the statement in the database; and every lookup
  statement stops at a deadline, `FORMANCY_DATA_LOOKUP_DEADLINE_MS`, by
  default the slowest timed lookup answer these figures hold. What does not ship:
  no trigram index (PostgreSQL's extension cannot be assumed, and SQL Server
  has none), no prefix mode, which would change what a search returns, and
  no minimum length, because the empty search a plain select sends reads as
  many rows as any other. A deployment past the measured size refuses
  searches at the deadline rather than serving them slowly.
- **Two driver behaviours double every statement's round trips**: mssql checks
  each pooled connection with `SELECT 1` before using it, and postgres.js has
  the server describe an unprepared statement before running it. The figures
  include both; changing either is a decision of its own.
- **The description of the form's table every record request reads**
  ([0041](./decisions/0041-the-runtime-refuses-what-drift-blocks.md)) is in
  the figures and is not separated from them: opening the form is that
  description, a create reads it before its membership check and insert, a
  read and an update carry it in the statement that reads the record, and
  every write holds the table to it in the statement that writes, or on SQL
  Server in the same batch. Counting shows
  the statements it adds; what the catalog walk inside each statement costs
  is in their time and cannot be told apart from the rest of it.
- **No page of records.** `POST /v1/forms/:id/records/list` came after the
  figures
  ([0044](./decisions/0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md)):
  what a page reads, its round trips and its time are not here, and no
  block of the harness sends one.
- **No export.** `POST /v1/forms/:id/records/export` came after the figures
  too
  ([0079](./decisions/0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md)):
  it is every page of a list, one statement a page, and one resolve a page
  per lookup field, so it costs what those pages cost, which is not
  measured either, and by how both engines run an offset each page reads
  every row before it. Its two bounds are not figures: 16 MiB is a memory
  budget, and 30 s is nginx's default read timeout less a SQL Server
  statement's overrun and a margin. No block of the harness sends one.
- **No menu of forms.** `GET /v1/forms` came after the figures too
  ([0045](./decisions/0045-the-runtime-plane-lists-the-forms-a-person-may-read-and-nothing-about-the-others.md)):
  it asks no database, and reads and validates every published form on
  every request, so its time grows with every form published; no block of
  the harness sends one. 0045 records one measurement in-process, outside
  the harness and its protocol: about 2 ms a published form.
- **PostgreSQL under READ COMMITTED only**, the fixture's default isolation.
  Under another, every read and write first locks the form's table in a
  transaction of its own (0041), which takes more round trips than the pins
  here; it is not measured.
- **The published version is read and checked on every request**
  ([0019](./decisions/0019-a-published-form-is-checked-every-time-it-is-read.md)):
  the fixed-costs table measures it at the fixture snapshot's size, which is
  printed beside it. How it grows with a larger snapshot is not measured.
- **A latency regression that changes neither the rows read nor the round
  trips** is found only by the next measurement.

## How to run it

On a quiet Linux machine with Docker, both database images already pulled and
no other container running:

```bash
pnpm performance
```

It builds, measures with the publish protocol, writes
`docs/performance/results.json` and renders this page. It refuses before
starting anything while another container runs, while a file it measures is
not committed, or while `packages/data-performance/src/protocol.ts` holds no
calibration tolerance, which `pnpm --filter @formancy/data-performance run
calibrate` measures on the quiet machine first. Raw samples and the server's
log stay in `packages/data-performance/runs/`, which git ignores.

`pnpm --filter @formancy/data-performance render` renders the page again from
`results.json`; `node scripts/performance-stale.mjs` says whether the figures
describe the current tree, and `--describe` prints what it compares.

## The figures

<!-- generated by packages/data-performance/src/render-cli.ts from docs/performance/results.json; do not edit -->
### When and on what

- **When:** from 2026-10-15T19:22:59.972Z to 2026-10-15T22:05:37.814Z, 9,756 s. Commit `2e0c4071e113`, product digest `22ec0c5ef047`.
- **Machine:** Intel(R) Core(TM) i9-10900K CPU @ 3.70GHz; 20 vCPUs presented by the Microsoft hypervisor as 1 socket × 10 cores × 2 thread; the host's topology is not visible. Memory 15926.4 MiB (16,699,994,112 bytes). Ubuntu 24.04.1 LTS, kernel 5.15.167.4-microsoft-standard-WSL2, 100 clock ticks a second. The harness in cgroup `/init.scope`, `cpu.max` `not readable`. Database container limits: PostgreSQL none; SQL Server none.
- **Docker** 28.3.3 on Docker Desktop, storage driver overlay2, cgroup driver cgroupfs, 20 CPUs, 15926.4 MiB (16,699,994,112 bytes). **Node** v22.23.3.
- **Network:** the client sends HTTP/1.1, keep-alive, Node fetch to `127.0.0.1`, no TLS; HTTP_PROXY unset, HTTPS_PROXY unset, NO_PROXY unset, NODE_USE_ENV_PROXY unset. PostgreSQL at `localhost` (resolved in the order `127.0.0.1`), port 33141, with no docker-proxy process found for the port, no TLS; SQL Server at `localhost` (resolved in the order `127.0.0.1`), port 33142, with no docker-proxy process found for the port, no TLS. The added-latency block holds every database answer 5 ms in a TCP hop.
- **Server:** `packages/data-server/dist/main.mjs` under Node v22.23.3, configured by `FORMANCY_DATA_ADMIN_ROLES`, `FORMANCY_DATA_ATTRIBUTES`, `FORMANCY_DATA_AUDIENCE`, `FORMANCY_DATA_AUDIT_KEY`, `FORMANCY_DATA_CONNECTIONS`, `FORMANCY_DATA_IDENTITY_SECRET`, `FORMANCY_DATA_ISSUER`, `FORMANCY_DATA_LOOKUP_DEADLINE_MS`, `FORMANCY_DATA_RATE_LIMIT`, `FORMANCY_DATA_STORE_DIR`, `MS_WRITER_PASSWORD`, `NODE_ENV`, `PERF_AUDIT_KEY`, `PERF_HOST_SECRET`, `PG_WRITER_PASSWORD`, `PORT`; rate limit 10,000,000 a minute; logger on; audit on, records named by a keyed hash. Account: `formancy_writer` on PostgreSQL, `formancy_writer` on SQL Server.
- **Quiet check:** no other container running; load average 0.940; busiest second 0.518 vCPUs; steal not reported by this hypervisor; calibration baseline 9.88 ms; over 10 s.

| Engine | Image | Image id | Digests | Version | Text order | Settings |
| --- | --- | --- | --- | --- | --- | --- |
| PostgreSQL | `postgres:17-alpine` | `sha256:1bea307dfb3ee30541a7acf7de14b58bcd6948da98e5d31a04c627c4d35ec64b` | `postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73` | PostgreSQL 17.11 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit | code-point order (musl) | shared_buffers 128MB, work_mem 4MB, max_parallel_workers_per_gather 2, max_worker_processes 8, jit on, pg_jit_available true, datcollate en_US.utf8, datctype en_US.utf8 |
| SQL Server | `mcr.microsoft.com/mssql/server:2022-latest` | `sha256:5b0916c7af8ca97ce9390be7e1182862d6fa90bff9f44f035dbe1626df140637` | `mcr.microsoft.com/mssql/server@sha256:4402d880dd4c34bfa7d8705e56a86cd6c88da80a1f6bbbe741f999e76264a090` | 16.0.4295.3 Developer Edition (64-bit) CU27 | the collation in Settings | cost threshold for parallelism 5, max degree of parallelism 0, max server memory (MB) 2147483647, database collation SQL_Latin1_General_CP1_CI_AS, physical_memory_kb 13046784 |

Drivers and server libraries as installed: `@fastify/rate-limit@11.2.0`, `@formancy/spec@0.5.0`, `fastify@5.12.5`, `jose@6.2.12`, `mssql@12.7.4`, `pino@10.4.0`, `postgres@3.4.9`, `tedious@20.3.3`, and 115 other packages in the server's and the client's runtime closure, each version in `results.json`.

### Database size

`sales.customer` holds the generator's `sales.customer sized 1` (digest `27bf9c5f740f`), loaded in 36.0 s on PostgreSQL and 16.9 s on SQL Server. The measured clerk is tenant 1.

| Engine | `sales.customer` rows | Customer data | Customer indexes | `sales.order` rows, start → end | Database, start → end |
| --- | --- | --- | --- | --- | --- |
| PostgreSQL | 1,000,002 (100,001 in tenant 1, 900,001 in tenant 2) | 72.7 MiB (76,226,560 bytes) | 21.4 MiB (22,487,040 bytes) | 1 → 13,186 | 104.8 MiB (109,893,299 bytes) → 106.3 MiB (111,474,355 bytes) |
| SQL Server | 1,000,002 (100,001 in tenant 1, 900,001 in tenant 2) | 86.7 MiB (90,865,664 bytes) | 0 bytes | 1 → 13,190 | 336.0 MiB (352,321,536 bytes) → 336.0 MiB (352,321,536 bytes) |

| Form | Version file | Its snapshot | Snapshot objects |
| --- | --- | --- | --- |
| `ms-order` | 55.4 KiB (56,733 bytes) | 21.1 KiB (21,603 bytes) | 9 |
| `pg-order` | 55.8 KiB (57,160 bytes) | 21.4 KiB (21,908 bytes) | 9 |

### How it was measured

- Protocol `publish`: 3 rounds, engine order alternating; in each, every block warms up with up to 100 requests or 5 s, whichever ends first, and at least 10, then takes up to 1,000 requests or 60 s, whichever ends first, and at least 100.
- Closed loop at 1 and 8 in flight: a request starts when one finishes, so a slow answer delays the next and no arrival rate is modelled.
- A sample is the time from the client call to its parsed answer. Percentiles p50, p90, p99 by nearest rank over every round's samples, printed only when at least ten samples sit at or above the rank, otherwise "n too small".
- Added latency: 5 ms on every database answer, through a TCP hop, one request at a time, 1,000 samples per pass, undelayed first. The difference is the median of the rounds' differences of p50s.
- In-process components: 200 warm-up and 2,000 samples each.
- Before each block's warm-up and after its timed window, an idle gap of 2,000 ms with nothing in flight. Calibration: a fixed CPU-bound workload every 500 ms on a worker thread, read only in the gaps, because it slows under the run's own load too; a block with a gap whose median ran past 2.41 times the quiet baseline is run again once, and a second miss refuses the run. Contention during a block's own load is not seen.
- Database CPU per request is the database container's CPU over the timed window less its CPU per second in the gaps times the window's seconds, over the requests; what the engine did on its own during the window alone is in it. None is printed for a request that makes no round trip.
- Disturbances, read by the database's owner between blocks: PostgreSQL's autovacuum and autoanalyze runs on any table of the database, SQL Server's recompilations and statistics updated on any user table.
- The default lookup deadline, 892 ms, is the slowest lookup or resolve answer in these figures: SQL Server, Search many customers match, 8 in flight.

### One request at a time: PostgreSQL

| Operation | Rows the database reads | Rows answered | Database round trips | n | p50 (ms) | p90 (ms) | p99 (ms) | max (ms) | p50 by round (ms) | Server CPU per request (ms) | Database CPU per request, idle rate taken off (ms) | Database CPU when idle (ms a second) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Health check | — | 0 | 0 | 3,000 | 0.878 | 1.35 | 6.89 | 21.9 | 0.600–1.14 | 0.657 | — | 191 |
| Open the form | — | 0 | 2 | 3,000 | 10.6 | 14.1 | 20.9 | 207 | 10.1–11.4 | 5.01 | 6.20 | 124 |
| Open the customer lookup | 100,001 | 50 | 2 | 3,000 | 33.7 | 40.2 | 52.1 | 66.5 | 33.5–33.9 | 4.43 | 84.9 | 116 |
| Search many customers match | 100,001 | 50 | 2 | 3,000 | 46.1 | 55.8 | 75.4 | 137 | 44.5–48.3 | 4.91 | 122 | 117 |
| Search one customer matches | 100,001 | 1 | 2 | 3,000 | 51.2 | 63.8 | 88.7 | 136 | 49.2–53.0 | 4.82 | 140 | 128 |
| Search no customer matches | 100,001 | 0 | 2 | 3,000 | 42.6 | 54.2 | 72.2 | 90.5 | 41.7–43.3 | 4.19 | 114 | 124 |
| Open the customer lookup (no tenant row filter) | 1,000,002 | 50 | 2 | 1,696 | 103 | 128 | 161 | 192 | 95.8–109 | 4.63 | 296 | 144 |
| Search many customers match (no tenant row filter) | 1,000,002 | 50 | 2 | 1,544 | 110 | 144 | 202 | 241 | 108–120 | 4.55 | 331 | 116 |
| Search one customer matches (no tenant row filter) | 1,000,002 | 1 | 2 | 1,518 | 115 | 135 | 203 | 256 | 114–115 | 4.06 | 336 | 127 |
| Search no customer matches (no tenant row filter) | 1,000,002 | 0 | 2 | 1,613 | 107 | 135 | 181 | 212 | 105–111 | 4.03 | 315 | 122 |
| Resolve one stored customer | at most 1 | 1 | 2 | 3,000 | 4.36 | 5.17 | 6.40 | 8.24 | 4.23–4.49 | 3.37 | 0.523 | 115 |
| Resolve the most one request may ask | at most 100 | 100 | 2 | 3,000 | 6.72 | 8.24 | 10.1 | 41.9 | 6.43–7.20 | 4.34 | 2.17 | 121 |
| Read an order | — | 1 | 2 | 3,000 | 10.1 | 11.6 | 14.5 | 20.6 | 9.94–10.2 | 4.05 | 5.90 | 117 |
| Create an order | — | 1 | 6 | 3,000 | 18.0 | 21.3 | 27.4 | 39.2 | 17.7–18.2 | 5.54 | 11.4 | 116 |
| Update an order | — | 1 | 4 | 3,000 | 17.6 | 20.9 | 27.6 | 79.4 | 17.4–17.9 | 5.43 | 11.3 | 119 |

### One request at a time: SQL Server

| Operation | Rows the database reads | Rows answered | Database round trips | n | p50 (ms) | p90 (ms) | p99 (ms) | max (ms) | p50 by round (ms) | Server CPU per request (ms) | Database CPU per request, idle rate taken off (ms) | Database CPU when idle (ms a second) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Health check | — | 0 | 0 | 3,000 | 0.552 | 1.10 | 2.91 | 10.0 | 0.489–0.965 | 0.447 | — | 20.0 |
| Open the form | — | 0 | 2 | 3,000 | 8.25 | 11.0 | 14.2 | 31.0 | 7.51–9.44 | 5.65 | 3.50 | 23.2 |
| Open the customer lookup | 100,001 | 50 | 2 | 3,000 | 48.4 | 61.9 | 83.5 | 182 | 45.4–54.8 | 5.86 | 476 | 22.6 |
| Search many customers match | 100,001 | 50 | 2 | 3,000 | 43.4 | 58.0 | 83.2 | 122 | 40.7–48.2 | 5.64 | 418 | 22.2 |
| Search one customer matches | 100,001 | 1 | 2 | 3,000 | 38.5 | 54.0 | 75.3 | 322 | 37.9–39.3 | 5.51 | 403 | 24.4 |
| Search no customer matches | 100,001 | 0 | 2 | 3,000 | 39.4 | 61.3 | 79.6 | 227 | 36.3–43.4 | 5.72 | 415 | 34.6 |
| Open the customer lookup (no tenant row filter) | 1,000,002 | 50 | 2 | 2,079 | 81.0 | 111 | 182 | 227 | 74.9–93.5 | 5.56 | 492 | 44.0 |
| Search many customers match (no tenant row filter) | 1,000,002 | 50 | 2 | 2,183 | 73.6 | 112 | 182 | 208 | 71.8–86.2 | 6.01 | 481 | 37.1 |
| Search one customer matches (no tenant row filter) | 1,000,002 | 1 | 2 | 2,694 | 63.9 | 77.6 | 121 | 394 | 61.6–69.8 | 4.94 | 414 | 81.7 |
| Search no customer matches (no tenant row filter) | 1,000,002 | 0 | 2 | 2,790 | 63.0 | 72.2 | 98.9 | 178 | 62.3–64.1 | 4.72 | 407 | 26.9 |
| Resolve one stored customer | at most 1 | 1 | 2 | 3,000 | 5.43 | 7.26 | 9.51 | 29.6 | 4.98–6.41 | 4.42 | 1.05 | 25.7 |
| Resolve the most one request may ask | at most 100 | 100 | 2 | 3,000 | 8.97 | 12.0 | 25.2 | 56.2 | 8.13–10.7 | 7.01 | 3.26 | 24.1 |
| Read an order | — | 1 | 2 | 3,000 | 7.82 | 9.49 | 12.4 | 32.8 | 7.48–8.27 | 4.71 | 3.21 | 25.3 |
| Create an order | — | 1 | 6 | 3,000 | 20.5 | 27.9 | 46.6 | 270 | 19.4–21.2 | 8.36 | 12.3 | 16.8 |
| Update an order | — | 1 | 4 | 3,000 | 19.8 | 26.3 | 43.7 | 126 | 18.9–22.3 | 8.24 | 11.7 | 21.9 |

### 8 in flight: PostgreSQL

| Operation | n | Requests per second | p50 (ms) | p90 (ms) | p99 (ms) | max (ms) | Server CPU per request (ms) | Database CPU per request, idle rate taken off (ms) | Database CPU when idle (ms a second) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Health check | 3,000 | 3,698 | 1.97 | 2.73 | 5.50 | 7.87 | 0.240 | — | 123 |
| Open the form | 3,000 | 284 | 25.3 | 40.1 | 57.6 | 73.0 | 3.94 | 6.85 | 125 |
| Open the customer lookup | 3,000 | 102 | 65.7 | 121 | 145 | 207 | 5.44 | 122 | 124 |
| Search many customers match | 3,000 | 81.3 | 78.4 | 158 | 197 | 473 | 5.11 | 162 | 122 |
| Search one customer matches | 3,000 | 57.1 | 114 | 227 | 479 | 553 | 5.93 | 233 | 142 |
| Search no customer matches | 3,000 | 76.7 | 85.1 | 169 | 223 | 407 | 5.29 | 171 | 121 |
| Resolve one stored customer | 3,000 | 410 | 19.0 | 22.8 | 30.0 | 38.5 | 2.66 | 0.496 | 122 |
| Resolve the most one request may ask | 3,000 | 295 | 25.6 | 33.0 | 43.3 | 78.0 | 3.75 | 2.31 | 117 |
| Read an order | 3,000 | 285 | 26.5 | 37.2 | 50.9 | 64.6 | 3.83 | 7.39 | 124 |
| Create an order | 3,000 | 209 | 35.0 | 50.5 | 87.0 | 113 | 5.14 | 13.8 | 118 |
| Update an order | 3,000 | 216 | 34.7 | 46.4 | 75.8 | 128 | 5.05 | 13.4 | 120 |

### 8 in flight: SQL Server

| Operation | n | Requests per second | p50 (ms) | p90 (ms) | p99 (ms) | max (ms) | Server CPU per request (ms) | Database CPU per request, idle rate taken off (ms) | Database CPU when idle (ms a second) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Health check | 3,000 | 4,003 | 1.78 | 2.59 | 4.48 | 8.68 | 0.193 | — | 23.7 |
| Open the form | 3,000 | 150 | 44.7 | 80.8 | 108 | 178 | 7.40 | 4.60 | 30.6 |
| Open the customer lookup | 3,000 | 21.9 | 341 | 505 | 696 | 859 | 9.73 | 614 | 24.8 |
| Search many customers match | 3,000 | 26.4 | 283 | 421 | 562 | 891 | 8.61 | 509 | 26.5 |
| Search one customer matches | 3,000 | 28.9 | 267 | 393 | 562 | 788 | 8.96 | 475 | 34.9 |
| Search no customer matches | 3,000 | 34.2 | 228 | 326 | 445 | 600 | 7.44 | 408 | 18.3 |
| Resolve one stored customer | 3,000 | 306 | 24.8 | 32.6 | 45.2 | 58.2 | 3.66 | 0.932 | 16.4 |
| Resolve the most one request may ask | 3,000 | 187 | 37.7 | 58.3 | 99.9 | 124 | 5.90 | 2.84 | 40.9 |
| Read an order | 3,000 | 267 | 29.1 | 36.1 | 44.0 | 64.0 | 4.06 | 3.56 | 16.8 |
| Create an order | 3,000 | 123 | 59.1 | 94.6 | 146 | 196 | 8.38 | 14.9 | 16.1 |
| Update an order | 3,000 | 183 | 42.0 | 56.7 | 76.1 | 93.5 | 5.73 | 11.6 | 16.8 |

### Added database latency: PostgreSQL

| Operation | Database round trips | p50 direct (ms) | p50 through the hop, undelayed (ms) | p50 with 5 ms per answer (ms) | Difference (ms) | 5 ms × round trips | Ratio |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Health check | 0 | 0.878 | 0.508 | 0.506 | 0.0228 | 0 | — |
| Open the form | 2 | 10.6 | 10.4 | 21.1 | 10.5 | 10.0 | 1.05 |
| Open the customer lookup | 2 | 33.7 | 33.7 | 45.8 | 11.4 | 10.0 | 1.14 |
| Search many customers match | 2 | 46.1 | 47.4 | 54.4 | 5.64 | 10.0 | 0.564 |
| Search one customer matches | 2 | 51.2 | 49.1 | 58.5 | 8.08 | 10.0 | 0.808 |
| Search no customer matches | 2 | 42.6 | 42.4 | 51.9 | 11.2 | 10.0 | 1.12 |
| Resolve one stored customer | 2 | 4.36 | 4.70 | 15.8 | 10.9 | 10.0 | 1.09 |
| Resolve the most one request may ask | 2 | 6.72 | 7.10 | 17.7 | 10.7 | 10.0 | 1.07 |
| Read an order | 2 | 10.1 | 10.8 | 21.7 | 11.1 | 10.0 | 1.11 |
| Create an order | 6 | 18.0 | 20.4 | 52.6 | 31.3 | 30.0 | 1.04 |
| Update an order | 4 | 17.6 | 19.5 | 40.9 | 22.2 | 20.0 | 1.11 |

### Added database latency: SQL Server

| Operation | Database round trips | p50 direct (ms) | p50 through the hop, undelayed (ms) | p50 with 5 ms per answer (ms) | Difference (ms) | 5 ms × round trips | Ratio |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Health check | 0 | 0.552 | 0.469 | 0.470 | 0.0100 | 0 | — |
| Open the form | 2 | 8.25 | 8.08 | 18.9 | 10.9 | 10.0 | 1.09 |
| Open the customer lookup | 2 | 48.4 | 48.0 | 61.7 | 12.4 | 10.0 | 1.24 |
| Search many customers match | 2 | 43.4 | 45.0 | 55.2 | 8.18 | 10.0 | 0.818 |
| Search one customer matches | 2 | 38.5 | 37.2 | 46.0 | 13.9 | 10.0 | 1.39 |
| Search no customer matches | 2 | 39.4 | 43.4 | 45.4 | 6.38 | 10.0 | 0.638 |
| Resolve one stored customer | 2 | 5.43 | 5.78 | 16.3 | 11.0 | 10.0 | 1.10 |
| Resolve the most one request may ask | 2 | 8.97 | 7.62 | 18.7 | 11.1 | 10.0 | 1.11 |
| Read an order | 2 | 7.82 | 8.04 | 19.3 | 11.5 | 10.0 | 1.15 |
| Create an order | 6 | 20.5 | 20.5 | 52.5 | 32.0 | 30.0 | 1.07 |
| Update an order | 4 | 19.8 | 18.6 | 40.5 | 21.4 | 20.0 | 1.07 |

### Refused, counted and never timed

Each counted once through the hop after one request to warm it, its answer checked; a refusal is not timed.

| Operation | Answer | Database round trips, PostgreSQL | Database round trips, SQL Server |
| --- | --- | --- | --- |
| Create, on a form whose table narrowed after it was published | 409 `drift` | 2 | 2 |
| Update, on a form whose table narrowed after it was published | 409 `drift` | 2 | 2 |

### Fixed costs

| Component | n | p50 (ms) | p90 (ms) | p99 (ms) | max (ms) | Beside it |
| --- | --- | --- | --- | --- | --- | --- |
| Verify a host token | 2,000 | 0.208 | 0.288 | 0.527 | 0.849 |  |
| Read and check the published version, `pg-order` | 2,000 | 1.93 | 2.49 | 3.38 | 4.74 | a 55.8 KiB (57,160 bytes) version, its snapshot 21.4 KiB (21,908 bytes) in 9 objects |
| Read and check the published version, `ms-order` | 2,000 | 1.71 | 2.34 | 3.17 | 7.77 | a 55.4 KiB (56,733 bytes) version, its snapshot 21.1 KiB (21,603 bytes) in 9 objects |
| `GET /health` over loopback, PostgreSQL rounds | 3,000 | 0.878 | 1.35 | 6.89 | 21.9 | as in the one-at-a-time table |
| `GET /health` over loopback, SQL Server rounds | 3,000 | 0.552 | 1.10 | 2.91 | 10.0 | as in the one-at-a-time table |
| One parameterised select as the writer, PostgreSQL | 2,000 | 0.805 | 0.978 | 1.31 | 5.69 | 2 round trips: 0.402 ms each at p50 |
| One parameterised select as the writer, SQL Server | 2,000 | 1.57 | 2.21 | 3.07 | 7.62 | 2 round trips: 0.787 ms each at p50 |

### The run

| Engine | Block | Machine busy, mean (%) | Steal, most (%) | Generator lag p99, worst (ms) | Calibration, worst idle gap against the baseline | Repeated | Disturbances | Reconnects |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PostgreSQL | 1 in flight | 12.8 | not reported | 7.75 | 1.87 | no | autovacuum 0, autoanalyze 2 | 0 |
| PostgreSQL | 8 in flight | 37.8 | not reported | 5.01 | 1.61 | no | autovacuum 1, autoanalyze 3 | 0 |
| PostgreSQL | added latency | 9.81 | not reported | 2.92 | 2.12 | no | autovacuum 3, autoanalyze 10 | 0 |
| SQL Server | 1 in flight | 26.5 | not reported | 4.19 | 2.31 | no | recompiles 0, statistics updated 0 | 0 |
| SQL Server | 8 in flight | 36.2 | not reported | 10.6 | 2.26 | yes | recompiles 0, statistics updated 0 | 0 |
| SQL Server | added latency | 21.2 | not reported | 3.80 | 1.96 | no | recompiles 0, statistics updated 0 | 0 |

The server wrote 3.00 log lines per runtime request. Its log holds 281,986 runtime audit events for the 281,986 runtime requests the harness sent, equal by operation, form and status, and 20 administrator events for 20 requests. 52,786 creates and updates were sent, all through one server's write-id cache (0031); that is a count, not a claim about the cache's bound. The run's orders reference 100 customers on PostgreSQL and 100 customers on SQL Server: creates rotate through them, so no one customer's row is locked by every create.
<!-- end generated -->
