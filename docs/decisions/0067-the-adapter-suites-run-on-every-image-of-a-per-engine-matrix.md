# 0067 — The adapter suites run on every image of a per-engine matrix, and what the versions disagree on is named

- **Status:** accepted
- **Date:** 2026-10-16
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-fixtures/src/images.test.ts` -- `MATRIX_IMAGES` leads each
  engine with its `DEFAULT_IMAGES` image, names each image once and gives no
  image to two engines; `FORMANCY_IMAGES` unset chooses every engine's
  default, an image it names is its engine's while the other engine keeps
  its default, and an image outside the matrix, two images for one engine,
  one image twice and the variable set to nothing are each refused, naming
  the variable and the matrix. `packages/data-fixtures/src/versions.test.ts`
  -- every row of `VERSION_FACTS` gives a value, a source that is not empty
  (watched failing with one left blank) and a measurement for the major of
  every image of its engine's matrix, and names a test file that exists and
  a title that file gives a test or a describe (watched failing with the
  parity case renamed and its row not); and `versionFact` answers by the
  major the server answered and refuses a major its row has no value for
  and a server of another engine.
  `packages/data-fixtures/src/fixtures.integration.test.ts` -- each fixture's
  server record, and its container's image as Docker holds it, are the image
  `selectedImage` gives for the run; and both adapters'
  `adapter.integration.test.ts`, *runs on the image this run chose* -- the bare
  `start…Container()` the ping runs against follows the variable, so a leg
  whose starts ignored it would run the default under its own image's name
  and fail there. `scripts/ci-test-jobs.test.mjs` (`pnpm test:repo`, which
  reads data-fixtures as built) -- the `test-images` job's legs are exactly
  data-fixtures and each engine's adapter on every image of `MATRIX_IMAGES`
  but the default, no leg twice (watched failing with a leg deleted), and
  turbo hashes `FORMANCY_IMAGES` for `test` and `test:coverage` (watched
  failing with the variable taken out of `turbo.json`), and no package or
  app outside the legs calls a starter of data-fixtures without naming its
  image (watched failing on the fourteen files that did: the data server's
  suites, the client's and the host's, the host's browser gate, the
  performance harness and the two snapshot captures).
  `scripts/release-report/workflows.test.mjs` -- a job keyed by a package and
  an image is read as its include pairs, and a list beside them or a pair
  missing a value is refused (watched failing against the reader before
  this record, which refused a package beside a variant); every leg leaves a
  key of its own; and each leg runs the test job's command with `--force`,
  on its image through `FORMANCY_IMAGES`, uploading no coverage.
  `scripts/release-report/matrix.test.mjs` -- a run in which every leg passed
  is green, with a column per image; a run in which an image of the matrix
  left no results fails and names the cases missing on it; a case counts for
  the image its file's server answered on, never for the leg's name; a file
  that started two images counts for both; an image of the matrix that only
  a file of another leg started answered no leg of its own, and fails the
  run (watched failing against the report before it, which took that file's
  server for the image's answer); a case that failed on one image
  alone fails the run, naming the leg's suite by its image; a declaration
  whose file no server record of its leg names fails; a suite has a row per
  leg, counted apart from the default legs in the summary; the report names
  every image of the matrix, what each answered and the suites that ran on
  it in its own legs, one that only another leg's file ran on, with that
  file, and one that nothing ran on; and a local run that allows the image legs
  missing holds only the images that ran. `collect.test.mjs` -- an image
  leg's suite and servers are kept under its key and its image, a leg
  whose suite started no server of its image is listed as missing one, and
  a server record whose compatibility level is missing or not a whole
  number is refused, whichever writer made it (watched failing against the
  check before it, which let a record without one through, as the
  getting-started journey then wrote them).
  `render.test.mjs` -- an image outside the matrix that one file names is
  said in a sentence of its own, after the one that says no other version
  was tested, as that file's, outside the matrix and not tested, never as a
  probe, and never named before that sentence (watched failing against the
  sentence before it, which named it there). `tested-on.test.mjs` -- the
  README's blocks name every image of each engine's matrix and the suites
  that run on the others, and say an image outside the matrix shows only
  what its file shows, where they said "unless a test names another image"
  (watched failing on that wording). `report.test.mjs`
  -- 0035's cases, with each shared case's cells keyed by image.
  **The version facts**, each held on every leg, as its server's major
  answers, by the test its row names:
  `packages/data-postgres/src/parity.integration.test.ts`
  (`transactionTimeout`), `packages/data-postgres/src/lookups-sized.integration.test.ts`
  (`notNullTestsRemoved`),
  `packages/data-postgres/src/discovery-access.integration.test.ts`
  (`membershipInherit`) and
  `packages/data-sqlserver/src/discovery-access.integration.test.ts`
  (`viewSecurityDefinition`); before their rows existed, the second failed on
  `postgres:16-alpine`, the third on `postgres:15-alpine` and the fourth on
  `mcr.microsoft.com/mssql/server:2019-latest`, as *Measured* says.
  `packages/data-sqlserver/src/discovery.integration.test.ts` holds a
  snapshot's `serverVersion` to the version the fixture recorded, where it
  held it to 2022's `/^16\./` and failed on 2019. **Held by the report**
  (0035): a run in which an image of the matrix answered no test in a leg of
  its own, or a shared case is missing or failed on one of them, fails.
  **Not mechanically enforced:** that a difference between versions which
  no test meets is named, which no table can hold; that a row's source
  still describes its versions, and that the test it names asserts its
  fact; that a start outside the legs names its image, beyond what a scan
  for the starters' names reads, which a starter called under another name
  would pass; and every figure for CI, which no leg of the job had made
  when this was written.

## Context

Until this record every suite ran on one image per engine,
`postgres:17-alpine` and `mcr.microsoft.com/mssql/server:2022-latest`, and
[0003](0003-real-databases-in-every-test-run.md) named the cost: "Passing
against `2022-latest` and `17-alpine` says nothing about SQL Server 2019 or
PostgreSQL 14; the supported matrix is whatever the tests name, and widening
it is adding images, not adding claims."
[0035](0035-a-release-report-is-derived-from-the-run-that-gated-it.md) made
that the report's rule: every image a test started is listed with the tests
that ran on it, and one file, `discovery-pg18.integration.test.ts`, started
PostgreSQL 18 for the catalog fact
[0026](0026-name-every-column-fact-the-engines-disagree-on.md) found it adds.
A database a design partner brings is not always on the newest release, and
no test ran on theirs.

The catalogs and the planners move between versions, and the first runs on
the older images showed where:

- PostgreSQL 15 and 16 have no `transaction_timeout`. The parity case that
  provokes one ([0028](0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md))
  opens a client that sends it, and 15 and 16 refuse that connection with
  42704 before the write is sent.
- PostgreSQL 17 plans away the `IS NOT NULL` tests a lookup puts on its key
  columns, which are declared NOT NULL; 15 and 16 keep them in the index
  condition, reading the same rows by the same scans. The sized lookup file
  pins plan shapes ([0034](0034-performance-is-measured-through-the-shipped-server-and-held-without-a-clock.md)),
  and eight of its cases failed on 16.
- PostgreSQL 16 made inheritance a property of each membership, granted
  `WITH INHERIT TRUE` or `FALSE`; 15 refuses that grant as a syntax error,
  and there a member inherits by its own role's `INHERIT` or `NOINHERIT`.
  The access discovery file grants both ways, for
  [0027](0027-a-snapshot-says-what-its-account-may-do.md)'s B4, and its
  setup failed on 15.
- `VIEW SECURITY DEFINITION` is a permission SQL Server 2022 added; 2019
  refuses the grant as a syntax error. And two discovery tests had 2022's
  major written into them.

Each was a test holding the default's behaviour, not a defect of an adapter.
That none of them was one is what these runs show, not a property of the
next difference.

The person decided the matrix on 2026-10-16: PostgreSQL 15, 16, 17 and 18,
and SQL Server 2019, 2022 and 2025, each with the whole adapter suite; only
the adapters and data-fixtures run per image; a shared case missing on an
image off the default fails the run, as one missing on an engine does; and
an image one file names for a fact of its own is named as what that file
showed, not as tested.

## Decision

- **The matrix is `MATRIX_IMAGES`**, in `packages/data-fixtures/src/images.ts`:
  for each engine the default first, then the images CI's legs run --
  PostgreSQL `17-alpine`, `15-alpine`, `16-alpine` and `18-alpine`, SQL
  Server `2022-latest`, `2019-latest` and `2025-latest` -- moving tags, as the
  defaults are (0035). `DEFAULT_IMAGES` stays one image per engine, which
  compose, the committed snapshots, the release report's default rule and
  every suite but those below run. PostgreSQL 14 and SQL Server 2017 are not
  images of the matrix; 2017 cannot be discovered
  ([0068](0068-a-snapshot-records-the-server-it-was-read-from-and-nothing-refuses-a-server-discovery-can-read.md)).
- **`FORMANCY_IMAGES` chooses**, as `FORMANCY_BROWSERS` chooses browsers
  ([0058](0058-the-browser-gates-run-in-chromium-firefox-and-webkit-and-each-fact-the-browsers-disagree-on-is-named-and-held.md)):
  unset, every engine's default; set, a comma list of at most one image per
  engine, each from the matrix, and the default for an engine it does not
  name. An image outside the matrix, two images for one engine and the
  variable set to no image are refused with the variable and the matrix, so a
  typo never runs the default under another image's name. Every start that
  names no image follows it -- the two fixtures, `startPostgresFixture(image?)`
  and `startSqlServerFixture(image?)`, which now take one, and
  `startPostgresContainer()` and `startSqlServerContainer()` called bare, as
  both adapters' ping files call them -- read when the start is made, so a
  bad value fails that start. A file that names its own image keeps it.
  turbo hashes the variable for `test` and `test:coverage`, so a cached run
  on one image is never replayed for another; `test:browser` and
  `test:pictures` are not given it and run the defaults.
- **CI: a `test-images` job** in `gates.yml`, beside `test`, with ten legs,
  the `{ package, image }` pairs of an include-only matrix:
  `@formancy/data-fixtures` and the engine's adapter on every image of the
  matrix but the default. Each runs the test job's command with
  `FORMANCY_IMAGES` set to its image, under `fail-fast: false` and the test
  job's limit of 25 minutes, which these legs have not been measured
  against, and uploads no coverage: an image leg covers the lines the default
  leg covers, and Codecov merges every upload of a commit. Each collects as
  `--job test-images --package … --variant <image>`, its artefact keyed by
  both, and `report` needs the job. `scripts/ci-test-jobs.test.mjs` holds the
  pairs to `MATRIX_IMAGES`. `ci.yml` only calls `gates.yml`, and is
  unchanged.
- **Only the adapters and data-fixtures run per image.** The server, client,
  host, studio and performance suites stay on the defaults: they test the
  server, not the database's semantics, and the host's test plane fills its
  tables with `GENERATE_SERIES`, which SQL Server has from 2022, at
  compatibility level 160. turbo gives `FORMANCY_IMAGES` to every
  package's `test`, so each start in those suites, the host's browser gate,
  the performance harness and the snapshot captures names the default image,
  `POSTGRES_IMAGE` or `SQLSERVER_IMAGE`: the variable set for a whole run
  moves none of them, and `scripts/ci-test-jobs.test.mjs` fails on a start
  without an image in any package no leg runs.
- **The report holds every shared case on every image of the matrix.** A
  test counts for each image that a server record in its own results file
  names, with the test's file as its caller and the engine its `covers()`
  declares; never for the leg's name or a tag. A file that started two images
  counts for both. An image of the matrix off the default is answered by its
  own legs alone, those whose variant it is: a file that names it in another
  leg, as `discovery-pg18.integration.test.ts` names 18 in every PostgreSQL
  leg, is said as that file's run, and its cases count in the image's cells,
  but it does not make the image answered. The run
  fails when an image of the matrix answered no test in a leg of its own,
  when a case is missing or failed on any image, and when a declaration's file
  is named by no server record of its leg, so that no image can be said for
  it. `collect.mjs` lists as missing a `test-images` leg that recorded no
  server of its image. A suite has a results row per leg, with that leg's
  engines and wall time, and the summary counts the default legs and says the
  image legs' counts in a sentence of their own, so no test is counted twice.
  A local report may pass `--allow-missing …,test-images`, which forgives the
  cells off the defaults and the images that did not run there, and still
  fails a case that failed on an image that did.
- **An image outside the matrix is what its file showed.** A file that names
  an image of its own runs it in every leg, and the report names the image
  as "outside the matrix" in a sentence of its own, after the one that says
  no other version was tested, with the files that name it and that the
  release was not tested on it; the README's *What it is tested on* says
  that such an image shows only what its file shows. This narrows 0003: the
  supported matrix is `MATRIX_IMAGES`, not every image a test names.
  `packages/data-server/src/routes/admin-untested.integration.test.ts`
  names `postgres:14-alpine`, to show that a server this release was not
  tested on is said to be untested and is still served (0068), and the
  report names 14 as outside the matrix, with that file.
  `discovery-pg18.integration.test.ts` still names 18, for the one catalog
  fact the others do not show, and 18 is now an image of the matrix.
- **What the versions disagree on is a table**, `VERSION_FACTS` in
  `packages/data-fixtures/src/versions.ts`: 0026's rule for the engines and
  0058's `FACTS` for the browsers, applied to the images of one engine. Each
  row has its engine, a sentence, a value per major, its source, how each
  value was measured, and the test that holds it. A test that meets a
  difference asks `versionFact(name, server)` for the value by the major the
  server answered, never by the image's tag, and asserts that value; a major
  the row has no value for throws, so a leg on a version nobody measured
  fails rather than asserting nothing. Nothing is skipped on a version. The
  rows are `transactionTimeout`, `notNullTestsRemoved`, `membershipInherit`
  and `viewSecurityDefinition`, as the context describes them, and a row is
  added when a leg shows a difference.
- **An assertion that a leg reaches names what its server answered.** The
  two SQL Server discovery tests that held `serverVersion` to 2022's
  `/^16\./` hold it to the version the fixture recorded.

## Measured

On 2026-10-16, on Windows 11 Pro with Docker Desktop (WSL 2), one database
suite at a time, with another workflow's containers running on the same
machine. None of it is a CI figure: no leg of `test-images` had run on CI
when this was written, and the Linux kernel Docker Desktop runs is not the
runner's, so a local pass of an image does not show that it starts there.

| Suite | Images, as they answered | Tests passed |
|---|---|---|
| data-fixtures | `postgres:17-alpine` (17.11), `2022-latest` | 147 of 150 |
| data-fixtures | `postgres:16-alpine` (16.15), `2019-latest` (15.0.4500.2) | 147 of 150 |
| data-postgres | `postgres:17-alpine` | 367 of 367 |
| data-postgres | `postgres:16-alpine` (16.15) | eight sized lookup cases failed before `notNullTestsRemoved`; 367 of 367 after |
| data-postgres | `postgres:15-alpine` (15.19) | the access discovery file's role setup failed before `membershipInherit`, so its case did not run, 374 of 375; 375 of 375 after |
| data-sqlserver | `2022-latest` | 289 of 289 |
| data-sqlserver | `2019-latest` (15.0.4500.2, CU32) | 286 of 289 before the fixes; then every test that ran passed, the sized lookup file's eleven skipped by its failed `beforeAll`, which passed alone, 11 of 11 |
| data-sqlserver | `2025-latest` (17.0.5015.4, CU9) | 301 of 301 |

The three data-fixtures failures are older than this record and fail on
`main` on the same machine: data-fixtures compares the stack frames it reads
its caller from, written with `/`, against a package path written with `\`,
so on Windows every server record names `packages/data-fixtures/src/servers.ts`
as its caller, and two `servers.test.ts` cases and *is the server that
answered, started by this file, and is on disk* fail. CI's runs, on Linux,
are not affected. It is fixed with this record: `servers.ts` compares both
as one platform's path, a `servers.test.ts` case writes a frame with `/`,
and the same day, on the same machine, data-fixtures passed 155 of 155 on
the defaults. The 2019 run's three were the `VIEW SECURITY DEFINITION`
grant, "Incorrect syntax near 'view'.", and the two discovery tests that
expected `/^16\./` and were answered 15.0.4500.2. The sized lookup file's `beforeAll` failed once,
on 2019, with mssql's "Failed to cancel request in 5000ms" while the machine
was loaded; it passed alone and in the run before.

The facts' values were measured then too. `transaction_timeout`: 15.19 and
16.15 threw PostgresError 42704, `unrecognized configuration parameter
"transaction_timeout"`, and 18.6 behaved as 17. The sized tenant lookup: on
15.19 and 16.15 the same Bitmap Heap Scan over `pk_customer`, reading the
tenant's 100,001 rows, with the index condition `((tenant_id IS NOT NULL) AND
(tenant_id = 1) AND (customer_no IS NOT NULL))`; on 18.6, as 17. A
membership's `INHERIT`: on 15.19, `GRANT … WITH INHERIT FALSE` failed with
PostgresError 42601, syntax error at or near "inherit", and a `NOINHERIT`
member's privilege functions answered false and its read 42501; 16.15 and
18.6 took the grant and answered as 17. `VIEW SECURITY DEFINITION`: 2025's
17.0.5015.4 granted it, as 2022 does. The whole PostgreSQL adapter suite ran
on 15 and 16, and on 18 only the parity, sized lookup and access discovery
files; the whole SQL Server adapter suite ran on 2019 and 2025.
data-fixtures did not run on 15, 18 or 2025.

The suites' wall times on that machine are not a cost of the job: data-postgres
on the defaults took 197.7 s in one run and 409 s in another the same day,
the second with seven more tests, on a machine other workflows shared
throughout. Each leg's time on CI, and how long it waits for a runner, is
measured by the first runs.

## Consequences

**What it buys.** A behaviour that passes on 17 and fails on 16, or passes on
2022 and fails on 2019, fails the pull request, and the red leg names its
package and its image. The differences the first runs found are named, and
the table is where the next one goes. The README's blocks and
every report name the matrix from the code. A leg that ran the default under
another image's name fails, and where depends on why. A start that ignored
the variable fails the ping file's image and the fixtures' records, which
compare against the image the variable selects. A leg whose variable never
reached the test process passes both, because each side is then the
default; it fails at `collect.mjs`, which lists a `test-images` leg with no
server of its image as missing one, and at the report's cells and its rule
for the image the leg should have answered. A `turbo.json` that does not
hash the variable fails `scripts/ci-test-jobs.test.mjs`, and a leg whose
YAML lost it fails `workflows.test.mjs`.

**What it costs.**

- Ten more jobs a run, each installing and pulling its image, which wait for
  runners beside the others. The queue time and the legs' own times are
  measured by the first runs and are not stated here.
- Some default work repeats. `fixtures.integration.test.ts` and
  `sized.integration.test.ts` load both fixtures, so every data-fixtures leg
  starts both engines: a PostgreSQL leg also pulls and starts the default SQL
  Server, and a SQL Server leg the default PostgreSQL.
- The data server's default leg pulls and starts a fourth PostgreSQL image,
  `postgres:14-alpine`, for one file of 0068; what that costs the leg is
  measured by its first runs.
- More moving tags, so two runs of one commit differ in more places (0035).
- A run goes red for a difference no user of the default meets, and a merge
  waits for 2019 as it waits for 2022.
- What the server's routes, the client, the host page, the studio and the
  performance figures do on another version is not seen: those suites, the
  browser gates, the pictures, the composed stack and the getting-started
  guide run the defaults only.
- PostgreSQL 14 is not tested, and PostgreSQL supports it until 2026-11-12.
  One file, `admin-untested.integration.test.ts`, runs on it, to show that
  a server of it is said to be untested and is served (0068); nothing in
  the adapters runs there.
- On 18 three files had run here when this was written, and data-fixtures
  had not run on 15, 18 or 2025; what those legs show is first shown on CI.
- `VERSION_FACTS` is not in the release report: each row is held only by its
  test passing on every leg, and a difference no test meets is named nowhere.
- A starter called under another name, outside the legs, would follow the
  variable and pass the scan that holds the other suites to the defaults.

**What it does not do.** It decides nothing about a server the product
meets: whether a release was tested on one is 0068's to say, and nothing
refuses one for being untested. It pins no digest (0035). It runs no
managed service: no image here is Azure SQL, RDS or any other managed
database.

## Alternatives considered

- **Every suite on every image.** The server, client and host suites would
  join each leg, and they test the server, not the database; the host's test
  plane would need its `GENERATE_SERIES` rewritten for 2019.
- **`include:` entries on the `test` job.** Its legs are one per package,
  which its guard and the report's keys rest on; image legs among them would
  have both tell a default leg from an image leg by an empty value, and the
  default legs' coverage upload would need a condition of its own.
- **A setup job that derives the legs from `MATRIX_IMAGES`.** Every leg
  would wait for an install and a build before it starts; the committed list,
  held to the constant by a guard, costs neither.
- **One job running every image in series.** One failure hides the next, a
  red job names no image, and its coverage would overwrite the default's.
- **One data-fixtures leg per pair of images**, 15 with 2019 and so on.
  Fewer legs, but a red leg no longer names one image.
- **Pinned digests.** 0035 chose moving tags and the report names the build;
  a pin is another decision.
- **Skipping a test on a version where it differs.** 0035's report fails a
  run with a skipped test, and a version that changed back would go unseen;
  a named fact asserted on each version shows both.
- **The image from the leg's name, or from the tag.** The name is CI's
  claim: a start that ignored the variable would run the default and report
  it as the leg's image. The servers' records are what answered.
- **Every image a test names is tested**, 0003's rule as it stood. One file's
  evidence would make a version tested, and 0035's sentence that no other
  version was tested would be true only of the matrix.
- **PostgreSQL 14 in the matrix.** Two more legs, for a version whose
  support ends weeks after this was written; the person left it out.

## Older records

Narrowed, not edited away: [0003](0003-real-databases-in-every-test-run.md)
(the supported matrix is `MATRIX_IMAGES`, not whatever the tests name, and
its Verified-by now names the matrix);
[0007](0007-sqlserver-discovery-and-what-it-hides.md) (the supported matrix
is no longer the one 2022 image its cost paragraph names);
[0028](0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md)
(its `transaction_timeout` case holds on PostgreSQL 17 and later; 15 and 16
refuse the setting). Extended: [0006](0006-postgres-discovery-reads-pg-catalog.md)
(the suites run 15 to 18, not 17 only; no test is about 18's NOT NULL
constraints or virtual generated columns) and
[0035](0035-a-release-report-is-derived-from-the-run-that-gated-it.md)
(shared cases per image, a row per leg, an image outside the matrix named as
such). 0035's rejected alternative, "a 'supported' list narrower than what
the tests start", which "would print 'no other version was tested' beside one
that was", is taken here, with an image outside the matrix named as that
in a sentence of its own after it, which says the release was not tested
on it. 0026 and 0058 are applied, not changed.
