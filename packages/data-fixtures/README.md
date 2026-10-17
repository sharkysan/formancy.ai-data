<!-- Part of Formancy Data: https://github.com/sharkysan/formancy.ai-data -->

# @formancy/data-fixtures

Test support, private, never published. One business model written twice —
`fixtures/postgres.sql` and `fixtures/sqlserver.sql` — with the edge cases the
plan names: a composite key, a foreign key to a unique key that is not the
primary key, a reserved word as a table and a column name, a self-reference
added over a row that breaks it, an exact decimal at its limit, an integer past
2^53, an identity, a computed column, a view, a type nobody supports, and a
child table, `sales.order_line`, with no tenant of its own and a version
column, which a form can reach only through its order (0043). And
`sales.shipment`, the column facts the two engines disagree on (0026): a
by-default identity against a sequence default, a UTF-8 varchar, fixed and
variable binary, a real and a zoneless timestamp with a fraction, and a check
added unvalidated beside one SQL Server disables. And `sales.delivery`, keyed
by a uuid the database fills by its default -- `gen_random_uuid()` on
PostgreSQL, `newsequentialid()` on SQL Server -- a child of an order with a
tenant of its own and a version as the order's, and `sales.parcel`, whose
foreign key is onto that uuid (0056). On SQL Server the delivery's key is
nonclustered, so its rows are a heap as PostgreSQL's are, and a lookup that
dropped the key from the end of its order would show on both engines.

- `startPostgresFixture()` and `startSqlServerFixture()` start a container, load
  the fixture, create `formancy_reader` — who may read `sales.order` and nothing
  else — and `formancy_writer`, the order form's account (`WRITER`), and return
  connection settings for all three principals and the account the owner
  discovers as, and the container's `containerId`, which the performance
  harness reads CPU, memory and limits by (0034). A row-level security
  policy on `sales.customer` shows the writer tenant 1 only; it binds nobody
  else, though SQL Server applies it to `dbo` too (0027). The writer may
  delete orders and their lines, and the reader nothing (0049). The writer
  holds a delivery's and a parcel's grants as it holds an order's: it reads
  and inserts them, updates a delivery's carrier and shipping time (on
  PostgreSQL its version too) and a parcel's delivery and label, never a
  key, a tenant or an order, and deletes them, where a delete of an order
  cascades through its deliveries into their parcels (0056).
- `connectDocker()` reads Docker through testcontainers' own runtime client:
  the daemon's facts, the running containers, whether an image is present,
  a container's image, digests and limits, and its cumulative CPU and
  memory. It starts, stops and changes nothing. It is here, not in the
  performance harness that uses it (0034), because nothing else may declare
  testcontainers (below).
- `FIXTURE_MODEL` is the database-neutral truth. Where the engines genuinely
  differ, it says so per engine rather than smoothing it over. What refers
  to each table is derived from its foreign keys, not written twice: every
  key of the fixture is on a table in `sales` (0049).
- `snapshotDisagreements(snapshot)` reports every way a discovered snapshot
  differs from the model, the owner's every privilege, row security and
  what refers to each table included, and
  `restrictedDisagreements(snapshot)` holds the reader's snapshot to one
  rule: the right answer, or a gap — never silence — for the keys of
  `sales.order` and the keys that refer to it.
  `structuralDisagreements` compares the structure alone, for an account that
  sees everything and is not the owner, and `accessDisagreements(snapshot,
  READER_ACCESS | WRITER_ACCESS)` holds a restricted account to what the
  fixture grants it, column by column and DELETE by table, with every
  column the model has: an adapter that left out what the account may not
  read, as a privilege-filtered catalog would, disagrees.
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
- `DELIVERIES` names the fixture's three delivery keys in lower case, as every
  read spells them, and `UUID_PARITY` is what both adapters'
  `uuid.integration.test.ts` expect of a uuid key end to end (0056):
  discovered with its default, generated read-only, one token on both
  engines, created, updated and stale, another tenant's not found, listed
  under an order, paged, and offered by `sales.parcel`'s lookup; what a
  delete is allowed and does (0050, 0051, 0057): the delivery form offers
  one on both engines, by SQL Server's rowversion and over PostgreSQL's
  version column because `gen_random_uuid()` fills the whole key; a grant
  of it under a policy that names no key in `cascades` is refused for the
  parcels that cascade from a delivery, as one on the order form is for its
  deliveries, its lines and their parcels; named with their actions, those
  keys are accepted, and tenant 2's clerk deletes a delivery with its
  parcels, then its order with its line, its other delivery and that one's
  parcel; and which default makes a uuid key one a version column proves a
  record over (`defaults`, 0057): the
  engine's own that never repeats, filling the whole key, however the DDL
  writes it, and no other -- a constant, `uuid_generate_v4()` or `newid()`,
  a function of the suites' own schema named like the engine's, or the
  engine's own beside a pinned tenant or on a key that refers to another
  table's -- each spelled as discovery reports it. `UUID_ROWS`
  is what those suites insert first: three orders of tenant 2's, one
  delivery under the first, sixteen under the second, each keyed with one
  byte set and all of one carrier, so a lookup's options tie on it, and
  under the third, which the delete case deletes, a line and two deliveries
  with three parcels between them. The one
  answer the engines give differently is the order of uuid values, and
  `uuidOrder(kind, keys)` is each engine's: PostgreSQL's bytes in turn, SQL
  Server's byte groups, the last six bytes first. Measured on both servers
  on 2026-10-11 with the sixteen keys, the fixture's three and 1000 random
  ones, and held on every run by the sixteen, paged as a list and tied as a
  lookup's options, whose order is exactly the order an engine weighs the
  bytes in.
- `DELETE_PARITY` is what both adapters' `delete.integration.test.ts`
  expect of a delete of one record of the parity schema (0050): one answer
  for both engines, or one per engine where they differ, which
  `deleteAnswer(name, engine)` reads. `UPDATE_RECREATED` is the update an
  application's delete and insert again of a typed key lets land on the new
  record, characterised on both.
- `CASCADE_PARITY` is what both adapters' `cascade.integration.test.ts`, and
  their lost-answer suites for `lost-answer`, expect of a delete that
  reaches past its record (0051): a `removable_parent` row of the parity
  schema with its `removable_cascade` rows, their `removable_grandchild`
  rows, and the `removable_null` rows whose reference it clears, under a
  policy that names the three keys, `PARITY_CASCADES`, in `cascades`.
  `cascadeAnswer(name, engine)` reads it. `REACH_PRIVILEGE_LOSSES` is how
  `reach-privilege` takes DELETE away on both engines: from the
  grandchildren with no grant to write them kept, or with INSERT kept, and
  from the cleared table with UPDATE kept -- PostgreSQL's lock is taken with
  either.

- `startTcpHop({ kind, host, port })` puts a TCP hop in front of a database that
  can lose an answer after the database has sent it (0031). `kind` is what
  crosses it -- `'postgres'`, `'sqlserver'`, or `'http'` for the browser
  gate's hop in front of the page -- and a hop without one is refused.
  `swallowAnswersFrom(marker)` drops a connection's answers from the read in
  which `marker` -- a text the write's answer echoes, in the driver's
  encoding, `answerBytes('postgres' | 'sqlserver', text)` -- completes; its
  `cut()` ends only the connections that swallowed. `countSent(marker)`
  counts the marker on its way to the database, which is how a suite shows a
  write was not sent again, and `sentOn(marker)` says of each sending which
  connection carried it, how many requests that connection had carried
  before, a request being a client turn on it, and how many other
  connections stood idle -- answered, open on both sides, unused since --
  from before it opened until the marker crossed: whether a browser sends a
  lost POST again depends on whether its connection was reused, and whether
  it had an idle one to reuse
  ([0058](../../docs/decisions/0058-the-browser-gates-run-in-chromium-firefox-and-webkit-and-each-fact-the-browsers-disagree-on-is-named-and-held.md)). On SQL Server a match tolerates one 8-byte TDS
  packet header inside the marker, because a packet can cut it there.
  PostgreSQL sends a bound value whole inside one message and HTTP has no
  8-byte packet header, so on those a marker is matched only whole: the
  tolerance there counted a PostgreSQL insert twice whenever its marker
  ended in the `e` of the `sales` bound eight bytes on.
  `cut()` ends every connection. Every byte is the driver's and the server's,
  and a close is passed on only after every byte before it, so a suite behind
  it is not a mocked driver; only a cut loses what is in flight. The host
  page's browser gate puts one between the browser and the page too. A matched answer is not proof
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
  Since 0061 it can also hold and refuse new connections, for PostgreSQL's
  cancel request, which postgres.js sends on a connection of its own.
  `holdNewConnections()` holds what every connection opened after the call
  sends until `release()`, then forwards it in order, a close behind it, so
  a late cancel lands when a suite chooses; held bytes are counted when they
  are released, and `held()` says how many connections the hold holds, so a
  suite says how many cancel requests it made late. `refuseNewConnections()` resets every connection opened
  after the call before it reaches the database, until `release()`, as a
  database whose listener went away while its open sessions still answer;
  `refused()` counts them. Connections opened before either call flow as
  before.

- `blockTable(database, table)` (0061) holds a table behind its owner's
  lock, on a connection of its own -- access exclusive mode in a
  transaction on PostgreSQL, an exclusive table lock held to the end on SQL
  Server -- so a statement that reads it waits in the database.
  `waiting()` counts the statements waiting on that lock, from every client
  of the database, and `release()` rolls back. A statement "stopped" is then
  one that stopped waiting while the lock was still held, read from the
  database, never from a rejected promise.

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

## Which images

`DEFAULT_IMAGES` is the image each engine's suites run on unless told
otherwise, the one compose and the committed snapshots name.
`MATRIX_IMAGES` is every image the adapter suites and this package's run
on, the default first ([0067](../../docs/decisions/0067-the-adapter-suites-run-on-every-image-of-a-per-engine-matrix.md)): CI's `test-images` job runs this package and
that engine's adapter suite once on each of the others, and
`scripts/ci-test-jobs.test.mjs` fails when the job's legs and this list
disagree. `FORMANCY_IMAGES` chooses for a run,
one image per engine, each from the matrix; an engine it does not name keeps
its default, and an image outside the matrix, two for one engine, or the
variable set to nothing, is refused with the list:

```bash
FORMANCY_IMAGES=postgres:16-alpine pnpm exec turbo run test --filter=@formancy/data-postgres
```

turbo hashes the variable for `test` and `test:coverage`, so a run on one
image is never replayed from another's cache. `selectedImage(engine)` is
what a start without an image of its own runs, and only this package's
suite and the adapters' make one: every other suite and script names the
default image, `POSTGRES_IMAGE` or `SQLSERVER_IMAGE`, at each start, so
the variable moves no other suite, and `scripts/ci-test-jobs.test.mjs`
fails on a start without an image in any of them.

`imageMajor(engine, image)` is the major an image's tag names: PostgreSQL's
names it, SQL Server's names a year, which data-core's `SQLSERVER_RELEASES`
turns into the major the server answers (`2019-latest` is 15). data-core's
`TESTED_SERVERS`, the servers the release calls tested ([0068](../../docs/decisions/0068-a-snapshot-records-the-server-it-was-read-from-and-nothing-refuses-a-server-discovery-can-read.md)), cannot read
this package, so `images.test.ts` holds its majors to the matrix's, both
ways, and each adapter's `server.integration.test.ts` holds every leg's
server to the major its image names and to a standing of tested.

`VERSION_FACTS` names what the versions of one engine disagree on, as 0026
names what the engines disagree on: each row's value per major, its source,
how each value was measured, and the test that asserts it.
`versionFact(name, server)` gives the value for the major the server
answered -- never its image's tag -- and refuses a major the row has no
value for, so a leg on a version nobody measured fails rather than
asserting nothing. No test is skipped on a version.

## What a run records

Every container a suite or a gate starts goes through here:
`startPostgresContainer(image?)` and `startSqlServerContainer(image?)` start
an empty server -- the image `FORMANCY_IMAGES` chooses for its engine, which
unset is the default, unless its caller names another -- and the two fixtures,
`startPostgresFixture(image?)` and `startSqlServerFixture(image?)`, start
theirs the same way. Each asks the
server what it is (`server_version`, or `ProductVersion` -- what the adapters'
pings read, and both adapters' ping tests hold them to it -- with
`ProductUpdateLevel` and `Edition`) and writes that, the image and the file
that asked -- and for the SQL Server fixture the `compatibility_level` of the
database it loaded, which data-core's compatibility floor is held to on
every leg ([0068](../../docs/decisions/0068-a-snapshot-records-the-server-it-was-read-from-and-nothing-refuses-a-server-discovery-can-read.md)); a bare container and PostgreSQL record none -- to
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
value, the two shipments, each change of `DRIFTING` both engines run, and
each of `THROUGH_CASES`, what a form reached through a parent shows (0043),
the one where the engines answer differently, `moved-parent`, included, each
`LIST_PARITY` case (0044), each `DELETE_PARITY` case and
`update: recreated` (0050), each `CASCADE_PARITY` case (0051), and each
`UUID_PARITY` case (0056), `order` included, whose expectation is each
engine's own order.
The ids are derived from the shared data --
`filterCase(entry)`, `displayCase(column)`, `temporalCase(column)`,
`refusalCase(name)`, `edgeCase(name)`,
`shipmentCase('first')`, `driftingCase(name)`, `throughCase(name)`,
`listCase(name)`, `deleteCase(name)`, `UPDATE_RECREATED_CASE`,
`cascadeCase(name)`, `uuidCase(name)`, `MODEL_CASES.owner` -- so no test
types one.

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

The release report shows every case on every image of every engine's
matrix as passed, failed or missing, from the tests' declarations in that
run, each test counting for the images its own leg's servers answered on
for its file ([0067](../../docs/decisions/0067-the-adapter-suites-run-on-every-image-of-a-per-engine-matrix.md)), and a case that passed on one engine or one image only
fails the run. What it cannot show is that a test which
declares a case asserts it; review holds that. `src/cases.test.ts` fails when
this package exports a table of shared expectations that is no family of
cases, and gives no reason why.
