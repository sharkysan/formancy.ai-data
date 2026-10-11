# Performance

What every request a host sends to the runtime plane costs: opening a form,
opening the customer lookup and searching it, resolving stored selections,
reading, creating and updating an order; and what a write the runtime
refuses because the form's table changed still asks the database. Measured
results, not promises
([0034](./decisions/0034-performance-is-measured-through-the-shipped-server-and-held-without-a-clock.md)).

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
  a quiet machine, every block and every refusal the catalogue names, its
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
  measured, the tenant and the whole table, not a curve. No remedy ships: no
  trigram index (PostgreSQL's extension cannot be assumed, and SQL Server has
  none), no prefix mode, no minimum length, no statement timeout on
  PostgreSQL, and no cancellation: the renderers abort a superseded search's
  request (`@formancy/react` 0.4.0, read 2026-10-10, as 0.3.0 did), but the
  server passes no signal to the adapter, so the database finishes every
  scan it started.
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

- **When:** from 2026-10-10T22:04:59.538Z to 2026-10-11T00:29:50.307Z, 8,691 s. Commit `217f78d2cb84`, product digest `df8d8f650d99`.
- **Machine:** Intel(R) Core(TM) i9-10900K CPU @ 3.70GHz; 20 vCPUs presented by the Microsoft hypervisor as 1 socket × 20 cores × 1 thread; the host's topology is not visible. Memory 16006.5 MiB (16,784,056,320 bytes). Ubuntu 26.04.1 LTS, kernel 7.0.14, 100 clock ticks a second. The harness in cgroup `/docker/5845e2929bef138f7337e70bc7aa2edb372b6c02f534d10042f266e6b41ed8e2`, `cpu.max` `max 100000`. Database container limits: PostgreSQL none; SQL Server none.
- **Docker** 29.8.1 on Ubuntu 26.04.1 LTS (containerized), storage driver overlayfs, cgroup driver cgroupfs, 20 CPUs, 16006.5 MiB (16,784,056,320 bytes). **Node** v22.22.1.
- **Network:** the client sends HTTP/1.1, keep-alive, Node fetch to `127.0.0.1`, no TLS; HTTP_PROXY `http://gateway.docker.internal:3128`, HTTPS_PROXY `http://gateway.docker.internal:3128`, NO_PROXY `localhost,127.0.0.1,::1,gateway.docker.internal`, NODE_USE_ENV_PROXY `1`. PostgreSQL at `localhost` (resolved in the order `::1`, `127.0.0.1`), port 34104, through docker-proxy, no TLS; SQL Server at `localhost` (resolved in the order `::1`, `127.0.0.1`), port 34103, through docker-proxy, no TLS. The added-latency block holds every database answer 5 ms in a TCP hop.
- **Server:** `packages/data-server/dist/main.mjs` under Node v22.22.1, configured by `FORMANCY_DATA_ADMIN_ROLES`, `FORMANCY_DATA_ATTRIBUTES`, `FORMANCY_DATA_AUDIENCE`, `FORMANCY_DATA_AUDIT_KEY`, `FORMANCY_DATA_CONNECTIONS`, `FORMANCY_DATA_IDENTITY_SECRET`, `FORMANCY_DATA_ISSUER`, `FORMANCY_DATA_RATE_LIMIT`, `FORMANCY_DATA_STORE_DIR`, `MS_WRITER_PASSWORD`, `NODE_ENV`, `PERF_AUDIT_KEY`, `PERF_HOST_SECRET`, `PG_WRITER_PASSWORD`, `PORT`; rate limit 10,000,000 a minute; logger on; audit on, records named by a keyed hash. Account: `formancy_writer` on PostgreSQL, `formancy_writer` on SQL Server.
- **Quiet check:** no other container running; load average 0.940; busiest second 0.591 vCPUs; steal not reported by this hypervisor; calibration baseline 9.71 ms; over 10 s.

| Engine | Image | Image id | Digests | Version | Text order | Settings |
| --- | --- | --- | --- | --- | --- | --- |
| PostgreSQL | `postgres:17-alpine` | `sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24` | `postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24` | PostgreSQL 17.11 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit | code-point order (musl) | shared_buffers 128MB, work_mem 4MB, max_parallel_workers_per_gather 2, max_worker_processes 8, jit on, pg_jit_available true, datcollate en_US.utf8, datctype en_US.utf8 |
| SQL Server | `mcr.microsoft.com/mssql/server:2022-latest` | `sha256:4402d880dd4c34bfa7d8705e56a86cd6c88da80a1f6bbbe741f999e76264a090` | `mcr.microsoft.com/mssql/server@sha256:4402d880dd4c34bfa7d8705e56a86cd6c88da80a1f6bbbe741f999e76264a090` | 16.0.4295.3 Developer Edition (64-bit) CU27 | the collation in Settings | cost threshold for parallelism 5, max degree of parallelism 0, max server memory (MB) 2147483647, database collation SQL_Latin1_General_CP1_CI_AS, physical_memory_kb 13112320 |

Drivers and server libraries as installed: `@fastify/rate-limit@11.2.0`, `@formancy/spec@0.4.0`, `fastify@5.12.5`, `jose@6.2.12`, `mssql@12.7.4`, `pino@10.4.0`, `postgres@3.4.9`, `tedious@20.3.3`, and 115 other packages in the server's and the client's runtime closure, each version in `results.json`.

### Database size

`sales.customer` holds the generator's `sales.customer sized 1` (digest `27bf9c5f740f`), loaded in 36.1 s on PostgreSQL and 14.8 s on SQL Server. The measured clerk is tenant 1.

| Engine | `sales.customer` rows | Customer data | Customer indexes | `sales.order` rows, start → end | Database, start → end |
| --- | --- | --- | --- | --- | --- |
| PostgreSQL | 1,000,002 (100,001 in tenant 1, 900,001 in tenant 2) | 72.7 MiB (76,234,752 bytes) | 21.4 MiB (22,487,040 bytes) | 1 → 13,208 | 104.4 MiB (109,483,699 bytes) → 106.0 MiB (111,097,523 bytes) |
| SQL Server | 1,000,002 (100,001 in tenant 1, 900,001 in tenant 2) | 86.7 MiB (90,865,664 bytes) | 0 bytes | 1 → 13,204 | 336.0 MiB (352,321,536 bytes) → 336.0 MiB (352,321,536 bytes) |

| Form | Version file | Its snapshot | Snapshot objects |
| --- | --- | --- | --- |
| `ms-order` | 44.3 KiB (45,346 bytes) | 15.8 KiB (16,170 bytes) | 7 |
| `pg-order` | 44.6 KiB (45,626 bytes) | 16.0 KiB (16,392 bytes) | 7 |

### How it was measured

- Protocol `publish`: 3 rounds, engine order alternating; in each, every block warms up with up to 100 requests or 5 s, whichever ends first, and at least 10, then takes up to 1,000 requests or 60 s, whichever ends first, and at least 100.
- Closed loop at 1 and 8 in flight: a request starts when one finishes, so a slow answer delays the next and no arrival rate is modelled.
- A sample is the time from the client call to its parsed answer. Percentiles p50, p90, p99 by nearest rank over every round's samples, printed only when at least ten samples sit at or above the rank, otherwise "n too small".
- Added latency: 5 ms on every database answer, through a TCP hop, one request at a time, 1,000 samples per pass, undelayed first. The difference is the median of the rounds' differences of p50s.
- In-process components: 200 warm-up and 2,000 samples each.
- Before each block's warm-up and after its timed window, an idle gap of 2,000 ms with nothing in flight. Calibration: a fixed CPU-bound workload every 500 ms on a worker thread, read only in the gaps, because it slows under the run's own load too; a block with a gap whose median ran past 1.61 times the quiet baseline is run again once, and a second miss refuses the run. Contention during a block's own load is not seen.
- Database CPU per request is the database container's CPU over the timed window less its CPU per second in the gaps times the window's seconds, over the requests; what the engine did on its own during the window alone is in it. None is printed for a request that makes no round trip.
- Disturbances, read by the database's owner between blocks: PostgreSQL's autovacuum and autoanalyze runs on any table of the database, SQL Server's recompilations and statistics updated on any user table.

### One request at a time: PostgreSQL

| Operation | Rows the database reads | Rows answered | Database round trips | n | p50 (ms) | p90 (ms) | p99 (ms) | max (ms) | p50 by round (ms) | Server CPU per request (ms) | Database CPU per request, idle rate taken off (ms) | Database CPU when idle (ms a second) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Health check | — | 0 | 0 | 3,000 | 0.610 | 0.961 | 1.38 | 4.85 | 0.528–0.873 | 0.453 | — | 129 |
| Open the form | — | 0 | 2 | 3,000 | 10.1 | 10.9 | 12.5 | 19.7 | 9.71–10.4 | 4.14 | 5.53 | 132 |
| Open the customer lookup | 100,001 | 50 | 2 | 3,000 | 29.9 | 33.6 | 39.7 | 49.6 | 29.6–30.2 | 4.18 | 72.4 | 134 |
| Search many customers match | 100,001 | 50 | 2 | 3,000 | 37.8 | 42.3 | 49.1 | 59.7 | 37.5–38.2 | 4.03 | 97.0 | 131 |
| Search one customer matches | 100,001 | 1 | 2 | 3,000 | 42.6 | 47.1 | 55.1 | 60.0 | 42.4–42.8 | 3.62 | 112 | 133 |
| Search no customer matches | 100,001 | 0 | 2 | 3,000 | 36.1 | 41.0 | 48.1 | 59.8 | 35.9–36.2 | 3.94 | 93.0 | 126 |
| Open the customer lookup (no tenant row filter) | 1,000,002 | 50 | 2 | 2,124 | 83.1 | 90.8 | 106 | 120 | 83.0–83.2 | 3.78 | 234 | 125 |
| Search many customers match (no tenant row filter) | 1,000,002 | 50 | 2 | 1,827 | 94.5 | 110 | 157 | 193 | 93.4–98.2 | 3.77 | 274 | 126 |
| Search one customer matches (no tenant row filter) | 1,000,002 | 1 | 2 | 1,642 | 99.9 | 157 | 190 | 403 | 98.4–120 | 3.76 | 305 | 129 |
| Search no customer matches (no tenant row filter) | 1,000,002 | 0 | 2 | 1,772 | 93.9 | 121 | 173 | 228 | 91.4–111 | 3.75 | 282 | 133 |
| Resolve one stored customer | at most 1 | 1 | 2 | 3,000 | 4.44 | 5.42 | 7.21 | 17.9 | 4.24–4.84 | 3.32 | 0.482 | 133 |
| Resolve the most one request may ask | at most 100 | 100 | 2 | 3,000 | 6.74 | 7.51 | 9.19 | 14.3 | 6.67–6.89 | 4.13 | 2.07 | 129 |
| Read an order | — | 1 | 2 | 3,000 | 10.8 | 11.8 | 13.8 | 17.4 | 10.4–10.9 | 4.17 | 6.12 | 133 |
| Create an order | — | 1 | 6 | 3,000 | 17.8 | 19.6 | 25.7 | 38.0 | 17.6–18.4 | 5.57 | 11.3 | 130 |
| Update an order | — | 1 | 4 | 3,000 | 17.0 | 18.4 | 20.8 | 28.6 | 16.8–17.3 | 5.29 | 10.9 | 130 |

### One request at a time: SQL Server

| Operation | Rows the database reads | Rows answered | Database round trips | n | p50 (ms) | p90 (ms) | p99 (ms) | max (ms) | p50 by round (ms) | Server CPU per request (ms) | Database CPU per request, idle rate taken off (ms) | Database CPU when idle (ms a second) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Health check | — | 0 | 0 | 3,000 | 0.603 | 0.721 | 0.972 | 4.51 | 0.589–0.620 | 0.380 | — | 11.3 |
| Open the form | — | 0 | 2 | 3,000 | 7.43 | 8.47 | 10.3 | 16.2 | 7.25–7.63 | 4.93 | 2.80 | 9.58 |
| Open the customer lookup | 100,001 | 50 | 2 | 3,000 | 42.4 | 50.0 | 56.4 | 63.3 | 41.4–43.6 | 5.06 | 381 | 9.51 |
| Search many customers match | 100,001 | 50 | 2 | 3,000 | 38.8 | 46.9 | 53.9 | 68.4 | 37.2–39.8 | 4.91 | 341 | 9.63 |
| Search one customer matches | 100,001 | 1 | 2 | 3,000 | 30.6 | 37.9 | 43.9 | 54.9 | 30.2–30.9 | 4.35 | 310 | 9.45 |
| Search no customer matches | 100,001 | 0 | 2 | 3,000 | 29.4 | 36.8 | 43.3 | 55.1 | 28.9–29.9 | 4.21 | 306 | 10.8 |
| Open the customer lookup (no tenant row filter) | 1,000,002 | 50 | 2 | 2,626 | 66.4 | 81.9 | 90.4 | 99.7 | 66.2–66.6 | 4.86 | 392 | 10.4 |
| Search many customers match (no tenant row filter) | 1,000,002 | 50 | 2 | 2,912 | 60.5 | 71.1 | 77.9 | 102 | 60.4–60.6 | 4.86 | 373 | 11.1 |
| Search one customer matches (no tenant row filter) | 1,000,002 | 1 | 2 | 3,000 | 54.8 | 64.7 | 69.7 | 78.1 | 54.5–55.0 | 4.28 | 350 | 11.6 |
| Search no customer matches (no tenant row filter) | 1,000,002 | 0 | 2 | 3,000 | 54.6 | 64.1 | 69.2 | 80.7 | 54.1–54.8 | 4.27 | 349 | 10.6 |
| Resolve one stored customer | at most 1 | 1 | 2 | 3,000 | 5.21 | 6.19 | 7.65 | 14.7 | 4.94–5.58 | 3.93 | 0.942 | 11.0 |
| Resolve the most one request may ask | at most 100 | 100 | 2 | 3,000 | 7.96 | 9.10 | 10.6 | 14.1 | 7.90–7.99 | 5.52 | 2.72 | 10.5 |
| Read an order | — | 1 | 2 | 3,000 | 7.49 | 8.43 | 9.87 | 14.3 | 7.44–7.54 | 4.39 | 2.84 | 8.96 |
| Create an order | — | 1 | 6 | 3,000 | 17.2 | 18.7 | 21.3 | 50.0 | 17.1–17.2 | 7.25 | 9.52 | 10.3 |
| Update an order | — | 1 | 4 | 3,000 | 16.1 | 17.5 | 21.2 | 24.7 | 15.9–16.3 | 7.28 | 8.89 | 10.5 |

### 8 in flight: PostgreSQL

| Operation | n | Requests per second | p50 (ms) | p90 (ms) | p99 (ms) | max (ms) | Server CPU per request (ms) | Database CPU per request, idle rate taken off (ms) | Database CPU when idle (ms a second) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Health check | 3,000 | 3,285 | 2.23 | 2.87 | 6.57 | 9.08 | 0.260 | — | 131 |
| Open the form | 3,000 | 345 | 22.7 | 27.7 | 32.4 | 41.3 | 3.28 | 6.32 | 135 |
| Open the customer lookup | 3,000 | 121 | 54.7 | 102 | 114 | 123 | 4.62 | 101 | 133 |
| Search many customers match | 3,000 | 93.0 | 66.6 | 139 | 151 | 159 | 4.53 | 140 | 123 |
| Search one customer matches | 3,000 | 79.4 | 75.9 | 166 | 179 | 192 | 4.31 | 166 | 128 |
| Search no customer matches | 3,000 | 97.4 | 65.4 | 133 | 148 | 185 | 4.12 | 132 | 131 |
| Resolve one stored customer | 3,000 | 408 | 18.7 | 24.1 | 30.0 | 36.1 | 2.69 | 0.488 | 133 |
| Resolve the most one request may ask | 3,000 | 308 | 25.5 | 29.8 | 37.3 | 42.1 | 3.60 | 2.14 | 136 |
| Read an order | 3,000 | 320 | 24.1 | 29.6 | 37.4 | 61.3 | 3.40 | 7.03 | 131 |
| Create an order | 3,000 | 233 | 33.8 | 39.8 | 47.0 | 51.2 | 4.60 | 13.1 | 132 |
| Update an order | 3,000 | 243 | 32.2 | 38.4 | 46.2 | 54.6 | 4.42 | 12.8 | 134 |

### 8 in flight: SQL Server

| Operation | n | Requests per second | p50 (ms) | p90 (ms) | p99 (ms) | max (ms) | Server CPU per request (ms) | Database CPU per request, idle rate taken off (ms) | Database CPU when idle (ms a second) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Health check | 3,000 | 3,372 | 2.19 | 2.84 | 4.73 | 7.14 | 0.197 | — | 10.4 |
| Open the form | 3,000 | 298 | 25.6 | 32.9 | 42.1 | 46.9 | 3.75 | 2.93 | 9.87 |
| Open the customer lookup | 3,000 | 31.8 | 251 | 307 | 395 | 480 | 5.39 | 348 | 10.4 |
| Search many customers match | 3,000 | 34.1 | 234 | 278 | 365 | 466 | 5.23 | 321 | 11.9 |
| Search one customer matches | 3,000 | 40.7 | 194 | 259 | 350 | 422 | 4.75 | 282 | 9.94 |
| Search no customer matches | 3,000 | 40.3 | 195 | 266 | 361 | 536 | 4.84 | 285 | 9.67 |
| Resolve one stored customer | 3,000 | 357 | 21.9 | 24.9 | 31.1 | 41.5 | 3.09 | 0.822 | 15.8 |
| Resolve the most one request may ask | 3,000 | 241 | 32.6 | 36.7 | 43.1 | 51.0 | 4.55 | 2.57 | 10.1 |
| Read an order | 3,000 | 312 | 25.2 | 28.5 | 34.6 | 44.1 | 3.48 | 2.78 | 10.6 |
| Create an order | 3,000 | 192 | 41.0 | 47.3 | 55.7 | 63.1 | 5.62 | 9.78 | 9.58 |
| Update an order | 3,000 | 213 | 37.0 | 43.0 | 50.6 | 61.1 | 5.06 | 9.24 | 9.76 |

### Added database latency: PostgreSQL

| Operation | Database round trips | p50 direct (ms) | p50 through the hop, undelayed (ms) | p50 with 5 ms per answer (ms) | Difference (ms) | 5 ms × round trips | Ratio |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Health check | 0 | 0.610 | 0.547 | 0.533 | -0.0238 | 0 | — |
| Open the form | 2 | 10.1 | 10.2 | 20.9 | 10.6 | 10.0 | 1.06 |
| Open the customer lookup | 2 | 29.9 | 30.2 | 40.7 | 10.5 | 10.0 | 1.05 |
| Search many customers match | 2 | 37.8 | 38.1 | 48.7 | 10.4 | 10.0 | 1.04 |
| Search one customer matches | 2 | 42.6 | 42.9 | 53.5 | 10.6 | 10.0 | 1.06 |
| Search no customer matches | 2 | 36.1 | 36.3 | 47.0 | 11.0 | 10.0 | 1.10 |
| Resolve one stored customer | 2 | 4.44 | 4.69 | 15.6 | 10.9 | 10.0 | 1.09 |
| Resolve the most one request may ask | 2 | 6.74 | 7.05 | 17.7 | 10.6 | 10.0 | 1.06 |
| Read an order | 2 | 10.8 | 10.6 | 21.0 | 10.4 | 10.0 | 1.04 |
| Create an order | 6 | 17.8 | 18.9 | 50.4 | 31.5 | 30.0 | 1.05 |
| Update an order | 4 | 17.0 | 17.5 | 38.8 | 21.2 | 20.0 | 1.06 |

### Added database latency: SQL Server

| Operation | Database round trips | p50 direct (ms) | p50 through the hop, undelayed (ms) | p50 with 5 ms per answer (ms) | Difference (ms) | 5 ms × round trips | Ratio |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Health check | 0 | 0.603 | 0.569 | 0.558 | 0.00840 | 0 | — |
| Open the form | 2 | 7.43 | 8.08 | 18.4 | 10.3 | 10.0 | 1.03 |
| Open the customer lookup | 2 | 42.4 | 43.1 | 52.8 | 9.82 | 10.0 | 0.982 |
| Search many customers match | 2 | 38.8 | 38.7 | 49.9 | 11.2 | 10.0 | 1.12 |
| Search one customer matches | 2 | 30.6 | 30.5 | 41.8 | 11.2 | 10.0 | 1.12 |
| Search no customer matches | 2 | 29.4 | 30.0 | 42.1 | 11.9 | 10.0 | 1.19 |
| Resolve one stored customer | 2 | 5.21 | 5.34 | 16.5 | 11.2 | 10.0 | 1.12 |
| Resolve the most one request may ask | 2 | 7.96 | 8.24 | 19.1 | 10.9 | 10.0 | 1.09 |
| Read an order | 2 | 7.49 | 7.85 | 18.7 | 10.9 | 10.0 | 1.09 |
| Create an order | 6 | 17.2 | 18.4 | 50.6 | 32.2 | 30.0 | 1.07 |
| Update an order | 4 | 16.1 | 16.6 | 38.2 | 21.6 | 20.0 | 1.08 |

### Refused, counted and never timed

Each counted once through the hop after one request to warm it, its answer checked; a refusal is not timed.

| Operation | Answer | Database round trips, PostgreSQL | Database round trips, SQL Server |
| --- | --- | --- | --- |
| Create, on a form whose table narrowed after it was published | 409 `drift` | 2 | 2 |
| Update, on a form whose table narrowed after it was published | 409 `drift` | 2 | 2 |

### Fixed costs

| Component | n | p50 (ms) | p90 (ms) | p99 (ms) | max (ms) | Beside it |
| --- | --- | --- | --- | --- | --- | --- |
| Verify a host token | 2,000 | 0.225 | 0.291 | 0.546 | 1.89 |  |
| Read and check the published version, `pg-order` | 2,000 | 1.63 | 2.03 | 2.65 | 6.47 | a 44.6 KiB (45,626 bytes) version, its snapshot 16.0 KiB (16,392 bytes) in 7 objects |
| Read and check the published version, `ms-order` | 2,000 | 1.62 | 1.94 | 2.36 | 6.61 | a 44.3 KiB (45,346 bytes) version, its snapshot 15.8 KiB (16,170 bytes) in 7 objects |
| `GET /health` over loopback, PostgreSQL rounds | 3,000 | 0.610 | 0.961 | 1.38 | 4.85 | as in the one-at-a-time table |
| `GET /health` over loopback, SQL Server rounds | 3,000 | 0.603 | 0.721 | 0.972 | 4.51 | as in the one-at-a-time table |
| One parameterised select as the writer, PostgreSQL | 2,000 | 0.614 | 0.731 | 0.893 | 2.80 | 2 round trips: 0.307 ms each at p50 |
| One parameterised select as the writer, SQL Server | 2,000 | 1.45 | 1.73 | 2.38 | 6.42 | 2 round trips: 0.726 ms each at p50 |

### The run

| Engine | Block | Machine busy, mean (%) | Steal, most (%) | Generator lag p99, worst (ms) | Calibration, worst idle gap against the baseline | Repeated | Disturbances | Reconnects |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PostgreSQL | 1 in flight | 11.9 | not reported | 6.12 | 1.58 | no | autovacuum 0, autoanalyze 1 | 0 |
| PostgreSQL | 8 in flight | 37.1 | not reported | 5.81 | 1.17 | no | autovacuum 2, autoanalyze 2 | 0 |
| PostgreSQL | added latency | 8.96 | not reported | 2.13 | 1.12 | no | autovacuum 2, autoanalyze 9 | 0 |
| SQL Server | 1 in flight | 25.5 | not reported | 5.12 | 1.07 | no | recompiles 0, statistics updated 0 | 0 |
| SQL Server | 8 in flight | 31.2 | not reported | 4.70 | 1.09 | no | recompiles 0, statistics updated 0 | 0 |
| SQL Server | added latency | 19.9 | not reported | 5.19 | 1.12 | no | recompiles 0, statistics updated 0 | 0 |

The server wrote 3.00 log lines per runtime request. Its log holds 284,537 runtime audit events for the 284,537 runtime requests the harness sent, equal by operation, form and status, and 20 administrator events for 20 requests. 52,822 creates and updates were sent, all through one server's write-id cache (0031); that is a count, not a claim about the cache's bound. The run's orders reference 100 customers on PostgreSQL and 100 customers on SQL Server: creates rotate through them, so no one customer's row is locked by every create.
<!-- end generated -->
