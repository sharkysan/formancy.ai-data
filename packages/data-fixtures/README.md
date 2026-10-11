<!-- Part of Formancy Data: https://github.com/sharkysan/formancy.ai-data -->

# @formancy/data-fixtures

Test support, private, never published. One business model written twice —
`fixtures/postgres.sql` and `fixtures/sqlserver.sql` — with the edge cases the
plan names: a composite key, a foreign key to a unique key that is not the
primary key, a reserved word as a table and a column name, a self-reference
added over a row that breaks it, an exact decimal at its limit, an integer past
2^53, an identity, a computed column, a view, and a type nobody supports. And
`sales.shipment`, the column facts the two engines disagree on (0026): a
by-default identity against a sequence default, a UTF-8 varchar, fixed and
variable binary, a real and a zoneless timestamp with a fraction, and a check
added unvalidated beside one SQL Server disables.

- `startPostgresFixture()` and `startSqlServerFixture()` start a container, load
  the fixture, create `formancy_reader` — who may read `sales.order` and nothing
  else — and `formancy_writer`, the order form's account (`WRITER`), and return
  connection settings for all three principals and the account the owner
  discovers as, and the container's `containerId`, which the performance
  harness reads CPU, memory and limits by (0034). A row-level security
  policy on `sales.customer` shows the writer tenant 1 only; it binds nobody
  else, though SQL Server applies it to `dbo` too (0027).
- `connectDocker()` reads Docker through testcontainers' own runtime client:
  the daemon's facts, the running containers, whether an image is present,
  a container's image, digests and limits, and its cumulative CPU and
  memory. It starts, stops and changes nothing. It is here, not in the
  performance harness that uses it (0034), because nothing else may declare
  testcontainers (below).
- `FIXTURE_MODEL` is the database-neutral truth. Where the engines genuinely
  differ, it says so per engine rather than smoothing it over.
- `snapshotDisagreements(snapshot)` reports every way a discovered snapshot
  differs from the model, the owner's every privilege and row security
  included, and `restrictedDisagreements(snapshot)` holds the reader's
  snapshot to one rule: the right answer, or a gap — never silence.
  `structuralDisagreements` compares the structure alone, for an account that
  sees everything and is not the owner, and `accessDisagreements(snapshot,
  READER_ACCESS | WRITER_ACCESS)` holds a restricted account to what the
  fixture grants it, column by column, with every column the model has: an
  adapter that left out what the account may not read, as a
  privilege-filtered catalog would, disagrees.
- Beside it, the `parity` schema (0028) — `fixtures/postgres.parity.sql` and
  `fixtures/sqlserver.parity.sql`, loaded last — which is outside
  `FIXTURE_SCOPE`, so no snapshot of `sales` sees it. A tenant column under a
  case-insensitive collation with four tenants that differ by case, a
  trailing space and an accent, beside 20,000 fillers, and a `char(3)` code
  that is `AB` for three of them and `ab` for the fourth; one row with a value
  of every kind a label shows, its floats ones whose text a session's
  `extra_float_digits` changes; and tables whose triggers refuse, decline,
  sleep and deadlock. `FILTER_PARITY`, `DISPLAY_PARITY`, `TEMPORAL_PARITY`
  -- that row's time and instant as the record reader returns them, cut to
  the minute and the second (0040) -- and `REFUSAL_PARITY` are what both
  adapters' parity suites expect of it, written once:
  `FILTER_PARITY` is checked against the stored rows on both engines by this
  package's own suite. `PARITY_SCOPE` is the scope that discovers it.
- `renamedColumn(snapshot, table, from, to)` is a snapshot as discovery
  reports it once a column has been renamed in the database: the same column
  — ordinal, type, default, comment and access — under its new name, made
  through `createSnapshot`, so the fingerprint follows. Both adapters'
  discovery suites rename `sales.order.notes` for real and hold what the
  writer then discovers to it, which is what lets the studio's browser gate
  stand it for a rename. It refuses a column that a key, a foreign key or a
  check names — a check by its text, or one whose text the account could not
  read — because no suite compares that case with a real rename.
- `EDGE_VALUES` names each inserted edge value as the exact string it is, and
  `FIRST_SHIPMENT` and `SECOND_SHIPMENT` are the two shipments as both
  adapters' record reads must return them — one object, so neither engine can
  spell a real or a zoneless timestamp its own way.

- `startTcpHop({ host, port })` puts a TCP hop in front of a database that
  can lose an answer after the database has sent it (0031).
  `swallowAnswersFrom(marker)` drops a connection's answers from the read in
  which `marker` -- a text the write's answer echoes, in the driver's
  encoding, `answerBytes('postgres' | 'sqlserver', text)` -- completes,
  tolerating one 8-byte TDS packet header inside it; its `cut()` ends only the
  connections that swallowed. `countSent(marker)` counts the marker on its way
  to the database, which is how a suite shows a write was not sent again.
  `cut()` ends every connection. Every byte is the driver's and the server's,
  and a close is passed on only after every byte before it, so a suite behind
  it is not a mocked driver; only a cut loses what is in flight. The host
  page's browser gate puts one between Chromium and the page too. A matched answer is not proof
  of a commit -- PostgreSQL sends a deferred constraint's refusal after the
  row -- so a suite polls a connection of its own until the write is visible
  before it cuts.
  Since 0034 it also counts and delays. `countRoundTrips()` counts turns
  from the call on, on every connection: each time the client speaks again
  after it last heard the server, so two writes before an answer are one turn
  and an answer in several reads is one. That is what a network's latency
  multiplies, and the measurement's added-latency block is what shows it
  does. `delayAnswers(ms, schedule)` holds every answer for `ms` before
  passing it on, in order, a close from the server behind it; 0 passes them
  on at once. The scheduler is injectable, so its tests need no clock. One
  fixed wait per answer after loopback: no bandwidth, loss or congestion
  window. Nagle's algorithm is off on both of its sockets, as tedious and
  docker-proxy turn it off on theirs: left on, a SQL Server answer of
  several packets waited on a delayed acknowledgement through the hop that
  it never waits for directly, and the hop measured itself.

- **The sized customers** (0034), opt-in: `loadSizedCustomers({ kind, admin })`
  fills `sales.customer` with a million generated customers beside the
  fixture's own two, in key order, a tenth of them in tenant 1, as the
  database's owner. Both engines are fed the same JSON text per chunk, from
  one generator (`jsonb_to_recordset` and `openjson`), so the two cannot
  be loaded with different data and agree by accident; then statistics are
  maintained, the database checkpoints, and every row is read back and
  compared with the generator, refusing at the first difference by its key
  (`sizedReadBack`, `verifySizedCustomers`). The start functions never call
  it, so a suite that does not ask never waits for it: this package's own
  sized suite, both adapters' `lookups-sized.integration.test.ts` and the
  performance harness each load it into containers of their own. On the
  Docker Sandbox VM on a Windows 11 workstation (2026-10-09), a load took
  about 35 s on PostgreSQL and 15 s on SQL Server, read-back included; on
  GitHub's hosted runner, in this package's CI job (2026-10-10), 19.9 s and
  9.5 s.
  `sized.ts` is the generator and every expectation, pure: names unique
  case-insensitively, in an alphabet whose code-point order and
  case-insensitive order agree, so PostgreSQL on musl and SQL Server's CI
  collation order them alike; `sizedTerms()`, a search many customers match,
  one matches and none matches; `sizedLookupPage()`, the page both engines
  must answer; `sizedRowsRead()`, the rows a lookup reads, which both
  adapters' sized suites pin and the performance page prints;
  `sizedResolveKeys()`; and `sizedDigest()` of what was loaded.

Every adapter's suite asserts both lists are empty. That is how "both adapters
pass the same mandatory suite" is something a test checks.

## What a run records

Every container a suite or a gate starts goes through here:
`startPostgresContainer(image?)` and `startSqlServerContainer(image?)` start
an empty server -- the image `DEFAULT_IMAGES` names for its engine, unless a
test names another -- and the two fixtures are built on them. Each asks the
server what it is (`server_version`, or `ProductVersion` -- what the adapters'
pings read, and both adapters' ping tests hold them to it -- with
`ProductUpdateLevel` and `Edition`) and writes that, the image and the file
that asked to
`test-results/servers/<script>-<engine>-<pid>-<n>.json` in the working
directory, and returns it as `server`. The release report reads those files
from every job and lists every image a run started, with what each server
answered and which tests ran on it (0035). A suite that started a container
any other way would leave no record, so nothing else in the workspace
declares testcontainers, and `scripts/release-report/tested-on.test.mjs`
fails when something does; a package that only reads Docker, as the
performance harness does, uses `connectDocker()`. The adapters' own typed variables take
`StartedPostgreSqlContainer` and `StartedMSSQLServerContainer` from here.

## Shared cases

`sharedCases()` is every case both adapters are held to, by id: the model's
comparators, each `FILTER_PARITY` entry, each `DISPLAY_PARITY` column, each
`TEMPORAL_PARITY` column, each `REFUSAL_PARITY` refusal, each `EDGE_VALUES`
value, the two shipments, and each change of `DRIFTING` both engines run.
The ids are derived from the shared data --
`filterCase(entry)`, `displayCase(column)`, `temporalCase(column)`,
`refusalCase(name)`, `edgeCase(name)`,
`shipmentCase('first')`, `driftingCase(name)`, `MODEL_CASES.owner` -- so no
test types one.

`DRIFTING` is the table of changes to a form's own table after it was
published ([0041](../../docs/decisions/0041-the-runtime-refuses-what-drift-blocks.md)):
each a table of its own in schema `drifting`, its DDL on each engine, the
ALTER its owner makes, whether the table's definition must move, drift
review's verdict by operation and the runtime's where it differs, and what
a person sends after it. Both adapters' `records-definition` suites and the
server's `runtime-drift` suite run it, so the three cannot hold the same
change to different expectations; a change only one engine has stays that
adapter's own test and is no shared case. A case can hold a limitation
rather than a refusal -- a column dropped and added again, the table
dropped and created again, SQL Server's masking -- each saying so beside
it. `defined(records)` is the record port as the suites written before 0041
call it, each write given the definition `describe` reads just before it,
unless it carries one of its own: a test whose subject is the write itself
on a table or a pool that cannot be described passes one, so that the write
is what is sent.

An adapter test that asserts a case through its adapter says so with
`covers()`: `test(title, covers('sqlserver', filterCase(entry)), async () =>
...)`, or the same on a `describe`, whose tests inherit it. `covers()` fails
the file while it is collected on an id that is no shared case, on no case,
and inside a suite that already declares cases: vitest merges `meta`
shallowly, so the inner declaration would replace the outer one instead of
adding to it. The fixture-load test declares nothing: it reads the values
through raw drivers, which shows the database holds them and is not either
adapter passing anything.

The release report shows every case on every engine as passed, failed or
missing, from the tests' declarations in that run, and a case that passed on
one engine only fails the run. What it cannot show is that a test which
declares a case asserts it; review holds that. `src/cases.test.ts` fails when
this package exports a table of shared expectations that is no family of
cases, and gives no reason why.
