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

<!-- generated by packages/data-performance/src/render-cli.ts; do not edit -->
No measurement has been published yet: the first run of `pnpm performance` fills this region.
<!-- end generated -->
