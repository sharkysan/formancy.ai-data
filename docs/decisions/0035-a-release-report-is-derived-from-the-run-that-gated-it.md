# 0035 — A release report is derived from the run that gated the release, and says what it did not test

- **Status:** accepted
- **Date:** 2026-10-09
- **Deciders:** Daniel Bacher
- **Verified by:**
  the `report` job in `.github/workflows/gates.yml`, which `ci.yml` runs on
  every pull request and every push to main and `release.yml` runs before its
  `check` and `publish` jobs: it builds the report from every other job's
  results and fails the run on anything in its problems. Proved locally on
  2026-10-09 against the real suites: with `covers()` commented out of
  data-sqlserver's `FILTER_PARITY` loop and that suite run again, the report
  failed with all eight `filter: … passed on postgres, missing on sqlserver`
  lines, and was green again once it was restored. Not yet proved by a CI
  run: the first pull request run is the first time GitHub runs it, and the
  run id of it going red on that same change is not recorded here yet.
  In `pnpm test:repo`, each case watched failing first:
  `scripts/release-report/workflows.test.mjs` — `ci.yml` is one job calling
  `gates.yml` with `CODECOV_TOKEN` by name; `release.yml` has exactly `tag`,
  `npm-token`, `gates`, `check` and `publish`, decides once whether it
  publishes, reads `NPM_TOKEN` only in the two jobs behind that condition,
  gives only `publish` more than `contents: read`, passes the gates no
  secret, and names no file from a ref; `publish` needs `check`, holds no
  step with an `if` of its own, and runs `sign-sbom`, `sign-report`, `image`,
  `sign-image`, `attest-sbom`, `npm-publish` and `github-release` in that
  order; every gates job collects and uploads under collect's key, `report`
  needs all of them, the test step runs with `--force` and `--summarize`, no
  script holds an expression, every third-party action is pinned to a
  commit, every upload overwrites and no two jobs share a key, the
  downloads are not merged, no cache is restored in a release, `check` pins
  the report and the tarballs before cdxgen runs and the SBOM after, and
  `publish` checks what it downloads against those pins before signing,
  and names the `npm` environment, as `npm-token` does, and every script a
  job that installs nothing runs -- `publish.mjs` and `verify-publish.mjs`
  in `publish` among them -- imports only Node's built-ins (watched failing with `check`
  removed from publish's `needs`, `npm-publish` moved above `image`,
  `if: always()` on a publish step, `id-token: write` on `check`, a job
  `extra` in gates.yml, `--force` dropped, `codecov/codecov-action@v7`
  restored, the SBOM named from `GITHUB_REF_NAME`, `${{ matrix.compose }}`
  back in a script, `getting-started` out of the report's `needs`,
  `secrets: inherit` in ci.yml, `merge-multiple: true`, a second
  `compose: runner`, an upload without `overwrite`, a cache step without
  its condition, cdxgen moved above `report-checked`, the pin step dropped,
  the environment missing and `yaml` imported into `verify-publish.mjs`,
  each failing its own case); `scripts/release-report/report.test.mjs` — a green run, local and
  in CI, has no problems, and each defect gives exactly its sentence: a
  package's results removed, a test skipped, a test failed, a file failed
  with every test passed, vitest's `success: false`, a missing file, a
  shared case declared on one engine only, an unknown case id, a browser
  other than the pin, a default image that never answered, a server whose
  record names no caller, two jobs' `dist/` differing, a tarball's `dist/`
  differing, a published package whose `dist/` no job recorded, a tarball
  at another version than data-core, a `heldBy` test that failed, a job of the gates that ended
  `failure`, a job the needs do not name, an artefact twice, an artefact no
  job leaves, an artefact holding another job's results, results of another
  run and of another commit, a gate's evidence file that did not run, a
  gate's job that failed, a register that does not hold, a tag that is not
  data-core's version, a version with no changelog section, a rehearsal with
  neither its version's section nor Unreleased, and a body past 125,000
  characters on a release but not in CI, and, locally with getting-started
  allowed missing, a composed database's record left out (each watched
  failing with its rule removed); `scripts/release-report/gates.test.mjs` — the committed register
  holds; twelve gates in order, exactly one of evidence and a reason, file
  evidence a test of a package with a suite, a browser gate an app's, a job
  one of gates.yml's, a document committed, and no `says`; a gate whose only
  evidence is a document is `stated`, never `passed` (watched failing with
  gate 7 deleted, gate 8 given evidence, `in-flight.test.tsx` misspelt and a
  `says` sentence in the real file, and with document evidence returning
  passed); `scripts/release-report/render.test.mjs` — the derived
  limitations, each fixed sentence present with its facts, open and stated
  gates among them, the jobs that built every published package and no
  other in the build-identity sentence, what the tests ran on when the
  default image never answered, a wall time or a coverage without a file
  of the run said to be not measured, a local run's uncommitted changes, the
  subject, the observations kept out of the summary, and a line per section
  saying where it comes from (each watched failing with its template
  deleted, and the build-identity sentence with the jobs of every package
  joined); `scripts/release-report/verify-publish.test.mjs`
  — a report with problems, partial, local, or of another commit, run,
  release or version; a tarball one byte different from the install gate's,
  missing, of no published package, or at another version than the
  release's; a tarball without `NOTICE` or with another licence field; an
  SBOM naming another `mssql`, `tedious`, `fastify` or `@formancy/spec`, or
  no `postgres`; a body missing or too long; and, in the publish job, a
  downloaded file `check` did not pin, pinned otherwise or pinned and did
  not hand over, an empty pin, and a report of another run (watched failing
  with the sha256 comparison, the licence checks, the version check, the
  SBOM comparison over drivers only, the partial check, the run check and
  the pin check each removed);
  `scripts/release-report/publish.test.mjs` — data-core first and
  data-server last, a version npm holds with these bytes skipped and with
  other bytes refused, the integrity in npm's form, and nothing handed to
  npm that `check` did not pin or whose report is another run's (watched
  failing with the order reversed, a skip on the version alone, a hex
  digest, and the pin check removed);
  `scripts/release-notes.test.mjs` — the body is the section and the
  summary, refused past 125,000 characters and accepted at them, and a
  rehearsal uses the version's section when there is one (watched failing
  with the limit at 200,000 and with a rehearsal always on Unreleased);
  `scripts/ci-test-jobs.test.mjs` reads the matrix from gates.yml with
  `yaml` (watched failing with `@formancy/data-host` dropped);
  `scripts/getting-started/steps.test.mjs` reads the Compose pin from the
  one getting-started job (watched failing with the pin moved without the
  guide); `scripts/release-report/{tested-on,collect,limitations,tarball,gate-results}.test.mjs`,
  `scripts/generated-block.test.mjs` and
  `scripts/getting-started/journey.test.mjs`, which hold the README's
  generated blocks, pnpm's version among them, compose's databases to the
  engines' default images (watched failing with compose's SQL Server on
  `mcr.microsoft.com/azure-sql-edge:latest`), what collect reads and refuses
  -- a turbo or coverage summary older than `--since`, and a getting-started
  run that recorded no composed database for a connection of its journey,
  each watched failing first -- the limitations register by hash, the
  built-in tarball reader, the browser gates' recorder, every generated
  region's marker and the composed servers' records;
  `packages/data-fixtures/src/{cases,servers}.test.ts`, which hold the
  universe of shared cases, `covers()` refusing an unknown id, none or a
  nested declaration, and what a server record holds; and both adapters'
  `adapter.integration.test.ts`, whose ping equals the version the server
  answered when it was started (watched failing with `version + '.0'`).
  **Not mechanically enforced, and said:** that a test declaring `covers()`
  asserts that case -- one did not: SQL Server's declaration of
  `filter: fixed_code = "AB "` checked only data-core's refusal, where
  PostgreSQL's also checks its adapter; it now checks the adapter's lookups
  and records too, watched failing with the adapter's check removed; that a register line is a fair summary of its record
  and still true — each held by review, and a line can outlive its truth
  until its record changes; and the publish job's behaviour, which has never
  run: the workflows test holds its shape until the first tag.

## Context

Plan item DATA-17 is done when a "release report identifies versions,
limitations and results". At 4536125, before this:

- `release.yml` ran every suite with `pnpm test` on one runner, the
  contention #32 measured on main (run 37940021594); it ran 0032's
  getting-started job and no browser, install or container gate; it published
  to npm before its SBOM, its image and its GitHub release; and it held write
  permissions and an OIDC identity in the one job that installed and built.
- The versions a run met existed only in prose and in job logs: moving image
  tags with no digest recorded, runtime dependencies published as ranges,
  and a hand-typed changelog line for upstream.
- The shared parity, model and edge-value cases were asserted per adapter
  under different test names, so "both adapters pass the same suite" could
  not be checked by anything.
- The records' cost paragraphs came in three shapes, and some had been
  answered by later records.

It rests on 0003 (what is tested is what the tests name), 0005 and 0028 (one
expectation per case), 0021 (Chromium only), 0025 (one suite, both engines),
0032 (the clean-install gate, which CI and a release both run) and
formancy.ai 0022 (fail closed).

## Decision

One gates workflow serves CI and the release, and its last job builds the
report from every job's own results. The report is a build output of that
run, never a committed document: a CI artefact and job summary on every pull
request, and, on a release, an asset signed by the workflow that ran the
gates.

It contains:

- **Which run it is:** version, release, commit, run and each job's attempt,
  runner image, Node and Docker.
- **Versions:** every image any test started, with the version and edition
  each server answered and its digest; every runtime dependency's published
  range, the version the suites loaded and what a clean `npm install`
  resolved; upstream `@formancy/*`; Node, the browser and axe as launched.
- **Results:** per package, with wall time and coverage reported and never
  gated; the browser, install and container gates; and a matrix of every
  shared case on both engines, keyed by ids derived from data-fixtures and
  declared with `covers()` on the adapter tests that assert them.
- **Build identity:** the tarballs the install gate packed, installed and
  ran, by sha256, and their `dist/` against every job's.
- **The release gates**, by number from `docs/release/gates.json`: evidence
  passed in this run, stated in a document, or open. The plan's wording of
  them stays out of the repository.
- **Limitations:** derived from the run, then a register,
  `docs/release/limitations.json`, held to the records by hash.

A release checks the report, the tarballs, the SBOM and the body in a job
with read-only permissions and no secret, which pins by sha256 what it
checked, then publishes exactly those tarballs, signs the report and attaches
it, all in one job that runs only on the push of a version tag and refuses
anything it downloaded that is not what was pinned. A `workflow_dispatch`
rehearses everything but that job. A release restores no Actions cache, and
the npm token is read only by the jobs that name the `npm` environment.

## Consequences

**What it buys.** A release names what it was tested on, from the run that
tested it. Gate 1 is a check on every pull request: a shared case that passes
through one adapter only fails the run. The release's gate is CI's, each
package's suite on a runner of its own, and it now runs the browser, install,
container and getting-started gates. npm receives the tarballs the install
gate installed and ran; two clean builds on 2026-10-09 in a Docker Sandbox
VM (Linux x86_64, Docker 29.8.1, Node v22.22.1) gave byte-identical `dist/`
for every published package, equal to the install gate's tarballs' `dist/`.
A changed record cannot leave a stale limitation unread.

**What it costs.** Measured on 2026-10-09 in that VM, not on CI, on this
change's code, three times each with bash's `time` and `stat`, over one
machine's results of every package's suite, the browser gates and the
install gate: collecting them took 0.52 to 0.58 s and building the report
from them 1.12 to 1.50 s; the collected results were 429,778 bytes, the
report's JSON 204,495 bytes and its Markdown 144,728 bytes, most of it the
register's links; and the body a rehearsal builds, from the Unreleased
section with this change's own entry in it, was 66,268 characters of
GitHub's 125,000. The report job's wall
time on CI, the artefacts' sizes there and the seconds each collect step adds
are not measured yet: the job's limit is verify's fifteen minutes, whose
install and build it shares, until three green runs give a slowest time to
triple. A release now installs every job from the registry, restoring no
cache, which costs each of its jobs time CI's do not spend; how much is not
measured.

The SBOM is what cdxgen finds, not what the report names. cdxgen 12.8.4 with
`--required-only`, run on this checkout on 2026-10-09 in that VM as `check`
runs it, named 61 components: both drivers, every other runtime dependency
and every upstream package at the version the suites loaded, so the check
`check` makes passed on it; and not tedious, which speaks TDS to SQL Server
and which every install of data-sqlserver resolves. Nothing here fails on an
SBOM that leaves out a package the report names under a facade.

Every vitest config gains a reporter and every suite writes `test-results/`;
the CI test step always runs with `--force`, so a cached result is never
replayed as this run's. data-fixtures writes a file per container it starts.
A dependency or image bump must regenerate three README blocks
(`node scripts/release-report/readme.mjs --write`). `test:repo` needs
`pnpm build` first. Every new record needs a register entry, and any edit to
a record, a typo included, needs a re-read and a stamp; the fence detects
change, not meaning, and a rubber-stamped hash passes. `covers()` is the test
author's claim. Moving image tags mean two runs of one commit can report
different server builds: reported, not prevented. The published ranges accept
dependency versions no suite ran — a clean install on 2026-10-09 resolved
`@fastify/rate-limit` 11.2.1 where the suites ran 11.2.0 — and nothing in the
product refuses an untested server version: "tested on" is not "accepted by".
A package's own suites run its source, not its `dist/`. Chromium only, and the
host page's gate on PostgreSQL only, are derived and now stated by every
report.

After `npm-publish`, only the GitHub release is left to do. The image, its
signatures and the report's signatures come before it, and their Rekor entries
are permanent even if the release never happens. A re-run of `publish`
resumes, skipping what npm already holds with the same bytes. The publish job
has never run: the workflows test holds its shape, not its behaviour, until
the first tag, and a rehearsal exercises everything else. A non-deterministic
build fails the run closed.

A job run again is meant to replace its own earlier attempt's artefact:
every upload sets `overwrite: true`, because `upload-artifact@v4` refuses a
name the run already holds, and no two jobs share a key, which the workflows
test holds, so an upload of this workflow replaces only its own job's. The
report names each job's attempt. That is the intended behaviour, not yet
shown: the first job run again on GitHub will show it, and its run id goes
here when it does. Every job of a run can write to the run's artefacts all
the same, which is why `check` pins what it checked and `publish` refuses
anything else.

**What only GitHub can show, and has not yet.** The first pull request run:
that `toJSON(needs)` in a reusable workflow gives the test matrix's one
aggregate result; that the download puts each artefact in a directory of
its own; and that separate runners build byte-identical `dist/` for each
published package -- only two builds on one machine were compared, and a
build that differs between runners fails the run closed, so the first run
can go red for that reason alone. The first job run again: that
`overwrite: true` replaces that job's earlier artefact and nothing else. A rehearsal: that the caller's `check` job can download what the
gates uploaded; that cdxgen on the runner names what it named here (below);
and that `check`'s outputs reach `publish` as its pins. The first tag: that
`publish` can download them too, again on a re-run; that
`npm publish <file.tgz> --provenance` records provenance for a tarball and
npm's `dist.integrity` for it is that file's sha512, which a re-run's skip
relies on; that the release action updates the release for the tag on a
re-run; and that the `npm` environment admits the tag, which its deployment
policy, a repository setting, decides.

**Not held by anything:** a job that starts a database outside data-fixtures,
other than the getting-started job's composed servers, which it records and
whose records collect requires, one per connection of the journey; the
composed databases' edition, which the server's connection test does not
report; the `npm` environment's deployment policy, which is the
repository's setting;
data-postgres' prose naming `postgres:18-alpine`; the dated version
observations in the package READMEs; the decisions index; and whether
"Verified by" paths resolve.

**What it forecloses:** publishing on evidence another workflow produced;
publishing bytes no gate installed; and a release body or report typed by
hand.

## Alternatives considered

- **A committed per-version report.** It cannot hold its own run's results,
  and a typed copy of a CI log is the drift this repository forbids.
- **The tagged commit's CI artefacts.** It depends on another workflow's run
  existing, being green and not having expired; the release would publish on
  evidence it did not produce; and a tag can be pushed on a commit CI never
  ran.
- **Keeping `pnpm test` in release.yml.** The contention is measured, and that
  run has no browser, install or container results.
- **Copying CI's jobs into release.yml.** Two definitions of the gate drift
  apart.
- **An `if:` on each permanent step.** A step added later without one runs on
  a rehearsal, and the job would still hold write permissions and an OIDC
  identity while it installs and builds a dispatched branch.
- **A negated dry-run input.** It fails open when the input is missing.
- **A separate rehearsal workflow.** Two copies of the publish steps.
- **Rebuilding in the publish job.** npm would receive a manifest, licence
  files and a README no gate installed, whatever the `dist/` hashes said.
- **Pinning images by digest.** No update bot is configured, so pins would
  age silently while customers run current minors; the report names the exact
  build, and a pin can be added later without changing it.
- **Image metadata as the version source.** It is the publisher's claim and
  says nothing about which tests started what.
- **A "supported" list narrower than what the tests start.** It changes
  0003's rule, and it would print "no other version was tested" beside one
  that was.
- **Parsing pnpm-lock.yaml, or `pnpm ls -r`.** An internal format that
  changes with pnpm's majors, and a listing that omits nested dependencies.
- **A typed list of drivers.** A dependency added later would go unreported,
  with nothing failing.
- **A custom vitest reporter, or junit.** One re-implements counts vitest
  derives; the other carries no `meta`.
- **vitest tags.** Names, not structure.
- **One generic cross-engine runner.** It rewrites both adapters' suites, and
  their per-engine differences are deliberate (0028).
- **Counting the fixture-load test as adapter conformance.** It reads through
  raw drivers, and gate 1 is about the adapters.
- **Firefox and WebKit now.** Each gate's contrast, target-size and keyboard
  checks need validating per engine, and the host's resend observation is
  Chromium's; it is a record of its own.
- **Extracting the cost paragraphs verbatim, markers inside records, or titles
  only.** Three shapes and answered costs reported as current; edits to every
  accepted record and wording a check matches; and no limitation identified.
- **A required test per limitation.** Most limitations are an absence, and a
  test asserting an absence per line is ceremony; `heldBy` is there for the
  lines where such a test already exists.
- **The plan's gate sentences in the register.** The plan is a working
  document kept out of the repository; the report prints the gate's number
  with its evidence, and a `says` key fails the register's guard.

## Older records

None is narrowed or superseded. 0003 is applied: its "the supported matrix is
whatever the tests name" is computed per run, and every image a test started
is listed with the tests that ran on it. 0001's and 0003's Verified-by lines
name `ci.yml` and `release.yml`, which still run those gates, now through
`gates.yml`, and `verify-licenses.mjs` still runs before anything is
published. 0032's CI jobs, `getting-started` and `container`, moved into
`gates.yml`, which CI and the release both run, and `getting-started` records
the composed servers it talked to; its status line says so. 0034 is to supply gate 11's evidence, which the report will show
as stated, never as passed in a run.
