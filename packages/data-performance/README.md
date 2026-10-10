<!-- Part of Formancy Data: https://github.com/sharkysan/formancy.ai-data -->

# @formancy/data-performance

Private, never published. The harness that measures what each runtime-plane
request costs and renders [`docs/performance.md`](../../docs/performance.md)
from what it measured
([0034](../../docs/decisions/0034-performance-is-measured-through-the-shipped-server-and-held-without-a-clock.md)).
Nothing in it is a contract.

## What it measures

The shipped server, `@formancy/data-server`'s `dist/main.mjs`, started as a
child process and configured only through its environment, as an operator
configures it, with `FORMANCY_DATA_RATE_LIMIT` raised so the per-address limit
never answers inside a run. Its log goes to a file it is handed as its output,
not to a pipe, and stays on, audit included. In front of it, the requests a
host sends, through `@formancy/data-client` and Node's `fetch` over loopback:
the form, the customer lookup's first page and three searches, on the
tenant-filtered order form and on a form with no tenant row filter, resolving
one stored customer and the most one request may ask, and reading, creating
and updating an order. Behind it, both shared fixtures with the sized
customers of `@formancy/data-fixtures` loaded, reached as the order form's
writer, and a TCP hop in front of each database.

Beside them, counted and never timed, two refusals
([0041](../../docs/decisions/0041-the-runtime-refuses-what-drift-blocks.md)):
a create and an update on a form published over a table of its own, which
the table's owner then changes so that drift review stops both writes. The
table and its change are the shared `narrowed-decimal` case of `DRIFTING`,
granted to the writer (`src/drifted.ts`); each must be answered 409 `drift`
and ask the database for the description it was decided over and nothing
more.

`src/catalogue.ts` names every request, what the page calls it and the
database round trips it makes on each engine; `src/protocol.ts` holds the
publish protocol, every value with its reason, and the smoke protocol the
test runs.

## How a run goes

1. **Refuses to start** on anything but Linux, while any other container
   runs, while a file it measures or a build configuration it records is not
   committed, while a proxy would carry
   loopback requests, while a database image would have to be pulled, or
   while the protocol has no calibration tolerance (`src/quiet.ts`).
2. **Setup**: both databases, the sized load, the refusals' table, the hops,
   the server, eight forms published through the administrator's plane and
   the two the refusals use, the orders each update lane owns, the refusals'
   record read and then its table changed by the owner, and every expected
   answer computed from the generator before anything is timed.
3. **Quiet check**: load average and per-second busy time, with the
   calibration probe running; its median is the baseline every idle gap is
   compared with.
4. **Counting pass**: each request and each refusal once through the hop,
   after one to warm it, counted, and held to the catalogue's pins; a
   refusal must also answer as the catalogue says. A difference refuses the
   run.
5. **Fixed costs**, in this process: token verification, the store read and
   check every request makes, and the database floor.
6. **Rounds**, engine order alternating: every request one at a time, then
   several at once, then the added-latency block through the hop, undelayed
   and with every database answer held. Each block is warmed up, timed closed
   loop, its answers checked after the timer, and what went on around it read
   before and after: busy time, steal when reported, the server's and the
   database's CPU, the generator's event-loop delay, autovacuum or
   recompiles on any table, reconnects. Before the warm-up and after the
   timed window it waits an idle gap with nothing in flight, and reads the
   probe and the database's CPU there: the probe slows under the run's own
   load as well as under anybody else's, so it is read only where the run's
   load is absent, and the database's CPU per request is published with its
   idle rate taken off and beside it. A block with a gap the probe says ran
   on a slower machine runs once more; a second miss refuses the run.
   Contention during a block's own load is not seen.
7. **After**: the database sizes again, then the server stops and its log is
   read: every runtime request the harness sent must be an event in its audit
   trail, by operation, form and status.

## Running it

```bash
pnpm performance        # from the root: build, measure, render
```

On a quiet Linux machine with Docker and nothing else running. It writes
`docs/performance/results.json` only when the result validates as published,
then renders the page. Raw samples, the server's log and its store stay in
`runs/<stamp>/`, which git ignores.

Before the first run on a machine, `pnpm --filter @formancy/data-performance
run calibrate` runs the calibration probe for ten idle minutes and prints the
statistic the run judges at its worst: the slowest gap's median against the
fastest window as long as the quiet check's (P13). The tolerance written into
`src/protocol.ts`, with that output beside it, must clear it; the publish run
refuses to start until one is there.

`pnpm --filter @formancy/data-performance render` renders the page from
`results.json` again; `node dist/render-cli.mjs --check` exits 1 when the page
is not what the results render.

## Tests

`pnpm test` runs the pure suites -- percentiles, number format, the
validator, the renderer, the quiet-machine decisions, the `/proc` and `lscpu`
parsers, the server-log reader, the aggregation, the calibration spread, the
idle gap, the catalogue, the refusals' case -- and
`harness.integration.test.ts`, which runs the whole harness with the smoke
protocol on both engines in containers of its own: every answer checked,
every round trip counted against the pins, the refusals' included, the audit
reconciled, the result
valid as a smoke result and refused as a published one. It never asserts a
time. It needs Docker, and it loads the sized customers into both engines.

## Licence

Source-available, not open source. See [`LICENSE.md`](../../LICENSE.md).
