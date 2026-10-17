# 0068 — A snapshot records the server it was read from, data-core says whether this release was tested on it, and nothing refuses a server discovery can read

- **Status:** accepted
- **Date:** 2026-10-16
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/server.test.ts` -- `serverStanding` calls each
  PostgreSQL major the release was tested on tested and another major not,
  naming the ones that were; a server that does not call itself PostgreSQL,
  or names no major, not tested; each tested SQL Server release tested at the
  compatibility floor and above and not one level below it; a release
  outside the matrix not tested, named by its year; Azure SQL Managed
  Instance not tested though it answers a tested major; Azure SQL Database
  named as itself, never as the release its major would be on a boxed
  server; a server with no major, or a database with no level, not tested;
  and a snapshot without `server` never tested, saying that it does not
  record its server. `serverName` names each product, a SQL Server release
  by its year and major and a major without a year by its number, and
  `TESTED_SERVERS` lists each engine's majors once and ascending, with a year
  for every SQL Server one. `packages/data-core/src/snapshot.test.ts` -- the
  server is carried outside the fingerprint, which a major or a level does
  not move, and a snapshot that names none gains none; facts no adapter
  could answer are refused. `packages/data-postgres/src/server.test.ts` --
  the major is read from `server_version_num`, on an alpine build, a Debian
  build and a 9.6, and never from `server_version`'s text (watched failing
  with the major read from the text); a number that is not an integer is no
  major; a server is PostgreSQL only when `version()` begins "PostgreSQL ";
  and one built elsewhere whose `version()` begins so is PostgreSQL of the
  major it states, and on a tested major called tested, the cost below
  (watched failing with the product read from an alpine build's `version()`
  alone). `packages/data-sqlserver/src/server.test.ts` -- a boxed server's product,
  major and the connected database's level; Azure SQL Database and Managed
  Instance read by `EngineEdition` whatever major they answer (watched
  failing with `EngineEdition` ignored); any other edition, or none, is
  `other`; the major from `ProductMajorVersion` and none when it names none;
  a level the server did not answer left out; and `discoveryRefusal` refuses
  a server without `sys.edge_constraints`, naming the release it answered,
  and refuses nothing that has it, whatever major it answers (watched
  failing with the refusal decided by the major). On every leg of 0067's
  matrix, against the leg's fixture:
  `packages/data-postgres/src/server.integration.test.ts` -- the server is
  PostgreSQL of the major the leg's image names, what discovery records for
  the owner and for an account that may read one table is what ping
  reports, and it is tested;
  `packages/data-sqlserver/src/server.integration.test.ts` -- the server is
  SQL Server of the major the image's year names, at the compatibility level
  the fixture recorded for its database; a database set to 140 is read at
  140, master's level being asserted to differ, and is below the floor
  (watched failing with the level read from master); an account that may
  read one table is not refused at discovery, and discovery records what
  ping reports; the server is tested; and the floor is at or below the level
  this leg's fixture database answered, and equal to it on the leg of the
  lowest tested release (watched failing with a floor of 170).
  `packages/data-fixtures/src/images.test.ts` -- `TESTED_SERVERS` names,
  image by image, exactly the majors `MATRIX_IMAGES`' tags name, both ways
  and without a run (watched failing with 18 dropped from `TESTED_SERVERS`),
  and `imageMajor` reads PostgreSQL's major from its tag and SQL Server's
  from its year, through `SQLSERVER_RELEASES`, and refuses a tag that names
  neither. `packages/data-fixtures/src/fixtures.integration.test.ts` -- the
  SQL Server fixture's record names the compatibility level of the database
  it loaded, asked by name from master; it would pass with the record read
  from master's own row, which in a fresh container has the level a new
  database takes from `model`, so the connected database's level is held
  by the adapter's case at 140 above.
  `packages/data-core/src/drift/server.test.ts` -- a review's current
  snapshot from a server this release was not tested on gives one
  `server-untested` change, for review, on the whole scope, affecting
  nothing, naming the server in the standing's sentence, and leaving the
  verdict, the runtime's included, as it is without it; the change is said
  on a review of a snapshot against itself and beside a root that is gone;
  nothing is said of a tested server, of an upgrade onto one, or of a
  snapshot that records no server; and only the current snapshot decides
  (watched failing with the change never raised, and with the
  equal-fingerprint path not asking for it).
  `packages/data-server/src/routes/admin-untested.integration.test.ts`, on
  `postgres:14-alpine` and on a database at compatibility level 140 on the
  default SQL Server -- the connection test answers the server with a
  standing of not tested, naming why; discovery records the server the test
  answered; and a form over it is proposed, published (201), reviewed for
  drift, exported and imported, the review saying `server-untested` once,
  for review, and nothing else, and the import saying it once too (watched failing on
  both engines without the connection test's standing, at the first case,
  and without drift's change, at the third, after the publish was answered
  201). `apps/studio/src/connect.test.tsx` and `metadata.test.tsx` -- the
  connection test's status and the metadata pane say the standing's
  sentence, naming the server, when the release was not tested on it, the
  pane also when the snapshot records no server, and nothing when it was
  (watched failing with each sentence taken out);
  `apps/studio/src/drift.test.tsx` -- the change is listed under Review,
  and the published form stays usable as published (watched failing with
  the change never raised). The studio's browser gate reaches the two
  sentences, as the state *Connect, a server this release was not tested
  on*, on its in-memory plane, where each browser's colour contrast and
  width down to 320 pixels are checked as in every other state.
  **Not held by anything:** the refusal against a real server -- its
  sentence and the condition that decides it are `discoveryRefusal`'s, held
  by the unit test; that `discoverSqlServer` throws it before any catalog
  query is reached by no test, because no committed test starts a SQL
  Server without `sys.edge_constraints`, and the one 2017 *Measured* names
  ran on a workstation, not the runner; and that a managed PostgreSQL is
  PostgreSQL in what a form relies on, which nothing here can ask.

## Context

[0035](0035-a-release-report-is-derived-from-the-run-that-gated-it.md)
said, of what a release names: "nothing in the product refuses an untested
server version: 'tested on' is not 'accepted by'."
[0067](0067-the-adapter-suites-run-on-every-image-of-a-per-engine-matrix.md)
names what a release is tested on. The product knew nothing of a server but
the text its ping and a snapshot's `serverVersion` carry, which
`ServerIdentity`'s comment left to "the metadata layer", and that text cannot
be read for a version safely:

- PostgreSQL's `server_version` is what the build made of it: a bare
  version such as `17.11` on the alpine images, `16.4 (Debian
  16.4-1.pgdg120+1)` from a packager.
  `server_version_num` is the version as a number, and `version()` says
  whether the server calls itself PostgreSQL.
- SQL Server's major means a release only on a boxed server. Azure SQL
  Database answers 12, which a boxed server answers as 2014, and Managed
  Instance can answer 16. `EngineEdition` tells them apart, and no container
  answers anything but 3.
- A SQL Server database restored from an older server keeps its
  compatibility level after the server is upgraded, and the level, not the
  server, decides what much of T-SQL means: the host's test plane fills its
  tables with `GENERATE_SERIES`, which needs 160.
- SQL Server discovery's referenced-by query, and every delete, read
  `sys.edge_constraints`, which SQL Server has from 2019
  ([0049](0049-a-snapshot-says-whether-its-account-may-delete-and-what-refers-to-each-table.md)).
  On a 2017, discovery failed as "Invalid object name
  'sys.edge_constraints'." and said nothing of the version.

The person decided on 2026-10-16 that a server outside the matrix is
flagged and not refused: a refusal would turn away the Azure SQL, the
PostgreSQL 14 and the databases below the level the matrix runs that a
design partner may bring.

## Decision

- **The adapter translates.** PostgreSQL's `readServer` reads
  `server_version`, `server_version_num` and `version()` in one query; the
  major is `server_version_num` divided by 10000, rounded down, when it is an
  integer and none otherwise, and the product is `postgresql` only when
  `version()` begins "PostgreSQL ", `other` otherwise. SQL Server's reads
  `ProductVersion`, then `EngineEdition` first -- 2, 3 and 4 are SQL Server,
  5 Azure SQL Database, 8 Azure SQL Managed Instance, anything else `other`
  -- then `ProductMajorVersion`, the `compatibility_level` of the database
  the connection is in (`sys.databases` for `db_id()`, never master's), and
  whether `object_id(N'sys.edge_constraints')` is null. Each adapter's ping
  and discovery share that query, so a ping and a snapshot cannot disagree,
  and each translation is a pure function with a test of its own, because no
  container answers what it must tell apart.
- **`ServerIdentity` extends `ServerFacts`**: a ping reports `product`,
  `major` and, for SQL Server, `compatibility` beside `kind` and `version`.
- **The snapshot carries `server`**, the same facts, outside the fingerprint
  as `serverVersion` is: a major upgrade or a change of level is not a
  change to anything a form binds to, and two servers holding one catalog
  are one catalog. `createSnapshot` keeps the product, the major and the
  level alone, and refuses a product no adapter answers, a major that is
  neither a whole number nor null and a level that is not a whole number. A
  snapshot taken before this record has none.
- **data-core decides.** `TESTED_SERVERS`, in `packages/data-core/src/server.ts`,
  names each engine's product, the majors of 0067's matrix and SQL Server's
  compatibility floor. `serverStanding(kind, facts)` answers tested or not
  tested, with a sentence a person reads: tested when the product is the
  engine's, the major one of its majors, and for SQL Server the level at the
  floor or above. Anything unknown -- no facts, no major, no level -- is not
  tested, and the sentence says what is missing. `SQLSERVER_RELEASES` is the
  one table of the years SQL Server's majors are sold as, from 2012's 11 to
  2025's 17, and `serverName` names a server by it -- "SQL Server 2019 (15)",
  "Azure SQL Database" -- never by the release a boxed server of its major
  would be.
- **The list is held to the matrix.** data-core cannot read data-fixtures, so
  `TESTED_SERVERS` is typed, and `images.test.ts` holds its majors to the
  majors `MATRIX_IMAGES`' tags name, both ways, through `imageMajor`, without
  a run; each adapter's `server.integration.test.ts` holds every leg's server
  to the major its image names and to a standing of tested.
- **The floor is not chosen.** It is the lowest compatibility level a matrix
  leg's fixture database answered: the SQL Server fixture records the level
  of the database it loaded in its server record, `compatibility`, and every
  leg holds the floor at or below it, the leg of the lowest tested release
  equal to it. On 2026-10-16 that leg's database, on 2019, answered 150.
- **Nothing refuses a server for being untested.** A form is generated,
  published and served on one as on a server the release was tested on.
- **The connection test says it.** `POST /v1/connections/:id/test` answers
  what the ping reported and its `standing`, data-core's `{ tested, says }`,
  as `ConnectionTest`, which `@formancy/data-server` exports. A server this
  release was not tested on is answered 200 as any other, and no log line
  changes.
- **Drift review says it, and stops nothing.** A new review change,
  `server-untested`, about the scope and affecting nothing, carries the
  standing's sentence when the current snapshot records a server
  `serverStanding` calls not tested. It is raised on every path of
  `diffSnapshots` -- equal fingerprints, a root that is gone, and the whole
  walk -- because the server is outside the fingerprint and an upgrade in
  place keeps it: two identical snapshots of such a server are a report of
  that one change. It is decided by the current snapshot alone, since a
  review is of the database as it is now: a form published from an untested
  server and reviewed on a tested one says nothing, and the reverse says it.
  A snapshot that records no server decides nothing here, so a form
  published before this record is not reported on every review. Every
  review lists it with the rest -- the drift route, a regeneration's, and
  `servable()`, which a restore, an import and a draft's submit and
  approval pass (0062, 0065) and which admits the bundle beside it. The
  runtime, which compares the
  root's definition alone
  ([0041](0041-the-runtime-refuses-what-drift-blocks.md)), is not told.
- **The studio shows it.** The Connect step says the standing's sentence
  after "… answered." in the test's status, and the metadata pane under its
  line naming the server, each only when the release was not tested on that
  server; the pane also says when the snapshot records no server. A tested
  server's pane is as it was, so no README picture moves.
- **The one refusal a version meets** is SQL Server discovery on a catalog
  without `sys.edge_constraints`: every SQL Server before 2019. It is decided
  by the view and not by the major, so Azure SQL Database's 12 is never
  refused, and made before any catalog query, naming the release the server
  answered: "SQL Server 2017 (14) cannot be discovered: this adapter reads
  sys.edge_constraints, which SQL Server has from 2019 (15)." The
  administrator's plane answers it as it answers any discovery that fails,
  503 `unavailable`, "Connection … could not be read.", and logs the sentence.

## Measured

On 2026-10-16, on Windows 11 Pro with Docker Desktop (WSL 2, kernel
5.15.167.4), with another workflow's containers running; not CI figures.
Each leg's server, through its adapter: PostgreSQL 15.19, 16.15, 17.11 and
18.6 each answered `postgresql`, its tag's major, and tested;
`2019-latest` answered 15.0.4500.2 (CU32) and its fixture database
compatibility level 150; `2022-latest` 16.0.4295.3, at 160; and, in a later
run that day, `2025-latest` 17.0.5015.4 (CU9), at 170, its adapter suite
passing 301 of 301.

`mcr.microsoft.com/mssql/server:2017-latest` was started once, on that
machine, to see the refusal. It reached ready in 15.9 s; ping said
14.0.3560.2 (CU31), major 14, at compatibility 140 (master's: no fixture was
loaded), and not tested; a query of `sys.edge_constraints` answered "Invalid
object name 'sys.edge_constraints'."; and discovery refused, with the
sentence above, in 11 ms. microsoft/mssql-docker#868 reports 2017 images
aborting at startup on Linux kernels from 6.7, and this machine's kernel is
older than that and is not the runner's, so this says nothing of whether one
starts on CI; the file that started it is not committed.

`admin-untested.integration.test.ts` was run the same day on that machine:
`postgres:14-alpine` answered 14.24, and the database it sets to
compatibility level 140, on `2022-latest` (16.0.4295.3, CU27), was answered
at 140; its six cases passed. The studio's browser gate passed its state
for an untested server in Chromium on that machine too, which is not the
runner's platform.

## Consequences

**What it buys.** A snapshot says what it was read from in terms data-core
can decide on, and the two engines cannot disagree about what "tested" means,
because one function says it. Azure SQL Database is never taken for 2014, a
Managed Instance never for a tested 2022, and a database left at an old
level on a new server is not called tested. A SQL Server that discovery
cannot read says which release it is and why, where it said "Invalid object
name".

**What it costs.**

- A form is generated, published and served on a server this release was
  not tested on, as on one it was. The runtime plane never discovers again,
  so a server upgraded in place is seen only by the next discovery, and a
  person filling a form is never told: the connection test, the studio's
  two sentences and drift review are where it is said, to an administrator.
- Drift review lists `server-untested` on every review of every form whose
  current snapshot names an untested server, for as long as that server, or
  this release, stays as it is: a change that is not a change of the
  database, and that a reviewer learns to read past.
- A managed PostgreSQL, or anything else whose `version()` begins
  "PostgreSQL ", reads as PostgreSQL of its major, and tested, whatever it
  changed; no query here tells them apart.
- A SQL Server database is called tested at any level from the floor
  upward on any tested release -- a 2022 database at 150 among them -- though
  each leg's fixture runs at its release's own default level.
- A posted bundle's `server` is the client's: outside the fingerprint, it is
  checked for its shape alone, and only a fresh discovery speaks for the
  server.
- A snapshot taken before this record records no server, so its standing
  says so and decides nothing until it is discovered again: drift review
  says nothing of its server, while the studio's metadata pane says that it
  does not record one.
- `ServerIdentity` gains `product`, `major` and `compatibility`: an
  embedder's own `DatabaseAdapter.ping` must report them, a breaking change
  for an implementer, and additive for a reader. `DriftKind` gains
  `server-untested`, which breaks an embedder's exhaustive `switch` over it.
- The refusal's sentence and condition are a unit test's; that discovery
  throws it before reading the catalog is reached by no server in any
  committed test, and no 2017 answered on CI.
- The data server's default CI leg pulls and starts `postgres:14-alpine`
  for `admin-untested.integration.test.ts`, an image outside 0067's matrix;
  what that costs the leg is measured by its first runs.
- The floor's equality was measured on 2019 alone; every other leg checks
  only that the floor is at or below its own level. 2025's level was
  measured on a workstation only, not on CI.
- Nothing in the release report reads the recorded level or `TESTED_SERVERS`:
  each is held by its leg's tests.
- The SQL Server fixture uses a UTF-8 collation, which Microsoft documents
  from 2019, so on 2017 its load would fail without saying the version; no
  test loads it there.

**What it does not do.** It refuses nothing that discovery can read. It does
not make 2017 or an older release discoverable: that needs a probe in
discovery and in delete, a fixture without a UTF-8 column, which would be a
second model against [0005](0005-one-fixture-written-twice.md), and a 2017
that starts on the runner. It tests no Azure SQL: an Azure SQL product is named, and called
not tested. It does not name a server tested by its build or its cumulative
update.

## Alternatives considered

- **Refuse an untested server in the publish gate**, on the fresh
  discovery. It needs an acceptance per connection in the allowlist
  ([0019](0019-a-published-form-is-checked-every-time-it-is-read.md)) and a
  discovery on a direct publish, so a database that is down answers 503
  where publishing succeeds today; and it turns away every Azure SQL estate,
  every PostgreSQL 14 and every database below the floor a partner brings.
  The person chose to flag.
- **Refuse at connection open.** After an upgrade in place, nothing serves.
- **A `CoverageGap`.** Gaps are inside the fingerprint (0004, 0027), so every
  upgrade would be drift, which drift reads as an access problem; the gap
  aspects are a closed list, so a data server older than the new aspect
  would refuse a snapshot carrying it, and every form published from one, as
  0049's cost says of its own; and every snapshot of an untested server
  would stop being complete.
- **Comparing full builds.** Every cumulative update would be untested.
- **A list derived from data-fixtures.** data-fixtures is private test
  support, which a published package cannot depend on; the typed list is
  held to it by a test instead.
- **The major from `server_version`'s text, or `ProductVersion`'s.** A
  packager's suffix, a development build and a fork's numbering each read
  wrong, and the number each server states is there to read.
- **Refusing SQL Server below 15 by its major.** It refuses Azure SQL
  Database, which answers 12 and has `sys.edge_constraints`.
- **The compatibility level of master.** It is the server's default, not the
  level of the database the forms run in.

## Older records

Extended, not edited away:
[0007](0007-sqlserver-discovery-and-what-it-hides.md) (discovery refuses,
naming its release, a server whose catalog has no `sys.edge_constraints`,
before it reads anything else),
[0010](0010-drift-is-classified-against-the-bindings.md) (a review change,
`server-untested`, raised on every path, the equal-fingerprint one
included, so two identical snapshots of an untested server are a report of
that one change, which stops nothing) and
[0035](0035-a-release-report-is-derived-from-the-run-that-gated-it.md) (the
SQL Server fixture records its database's compatibility level beside the
server, and "tested on" is now something the product can say of a server --
the connection test, the studio and drift review say it -- still not what
it accepts). 0004's and 0027's fingerprint is unchanged:
`server` is outside it, as `serverVersion` is. 0049's read of
`sys.edge_constraints` is unchanged; it is why a release before 2019 is
refused.
