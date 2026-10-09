# The release report

Every run of the gates ends in a report of what that run was tested on and
what it found ([0035](../decisions/0035-a-release-report-is-derived-from-the-run-that-gated-it.md)).
It is a build output of the run, never a committed document: a report typed
by hand would describe a run nobody can find.

- **On a pull request or a push to main**, it is the `release-report`
  artefact of the CI run and the run's summary page.
- **On a release**, it is attached to the GitHub release as
  `formancy-data-<tag>-release-report.md` and `.json`, each with a
  `.sigstore` bundle signed by the workflow that ran the gates, beside the
  SBOM; the release body carries its summary.

`.github/workflows/gates.yml` runs the gates for both, so a release's gate is
CI's. Each job collects what it found into one results file
(`scripts/release-report/collect.mjs`) and uploads it; the last job, `report`,
builds the report from all of them (`scripts/release-report/report.mjs`).

## What it holds

1. **Subject:** the version, the release (a tag, `dry-run` or none), the
   commit, the run, and each job's attempt, runner image, Node and Docker.
2. **Tested on:** every image any test started, the default first, with the
   version, update level and edition each server answered, its digest, and
   who started it, and the version each composed database of the
   getting-started job answered through the server's own adapter, which
   reports no edition; every runtime dependency of every published package, its
   published range, the version the suites loaded and what a clean
   `npm install` resolved; upstream `@formancy/*`; Node; the browsers and axe
   as launched; the tools; and each captured snapshot against what this run
   answered.
3. **Results:** a row per package with a suite -- files, tests, what did not
   pass, the task's wall time from turbo, vitest's span, the engines its run
   started, and coverage, reported and never gated -- then the repository's
   guards, each browser gate, the install gate and the container gate.
4. **Shared cases on both engines:** every case `sharedCases()` derives from
   data-fixtures' shared tables, `passed`, `failed` or `missing` on each
   engine, from the tests that declare it with `covers()`
   ([packages/data-fixtures](../../packages/data-fixtures/README.md) says how).
5. **The browser matrix:** each environment, app, renderer and engine as the
   run had them.
6. **Build identity:** each published package's tarball as the install gate
   packed, installed and ran it, by sha256, and the hash of its `dist/`
   against the `dist/` every job built.
7. **Release gates:** each of the plan's twelve, by number, from
   [`gates.json`](gates.json).
8. **Known limitations:** those the run shows, as fixed sentences with the
   run's facts, then those the decision records state, from
   [`limitations.json`](limitations.json).
9. **Observations on a shared runner:** what a browser gate measured on the
   way. Not a performance figure: a CI runner is shared, and published
   figures are 0034's, measured on a machine that is not.
10. **How this report was made:** where each section comes from.
11. **Problems:** what fails the run. Empty on a green run, and the report
    says so.

## What fails it

A job of the gates that ended other than success; a job's results missing,
twice, under another job's name, or from another commit or run; a package
with no results, no tests, a test that did not pass -- skipped is not passed
-- a file that failed, or vitest calling the run unsuccessful; a browser gate
missing, in error, with a failed check, or on another Chromium than
Playwright pins; the install gate failed, packing other than one tarball
per published package, or packing one at another version than data-core;
the container gate missing; the getting-started job recording no composed
database for a connection of its journey; a shared case missing or
failed on an engine, or declared under an unknown id; an engine's default
image never answering; a published package whose `dist/` no job recorded,
so its tarball is compared with nothing; two builds of one package that
differ; a gate whose
evidence did not pass, or a limitation whose `heldBy` test did not; either
register not holding; and, for a release, a tag that is not data-core's
version, a version with no changelog section, or a body longer than the
125,000 characters GitHub accepts.

## The two registers

Both are held by `pnpm test:repo` and read by every run.

**[`limitations.json`](limitations.json)** has an entry for every decision
record: the costs it states that a user, integrator or operator of a release
will meet, one sentence each in the record's own terms, or, in `none`, why it
has none. Each entry's `reviewed` is the sha256 of its record as it was read,
so any edit to a record -- a later record changing its Status line included
-- fails until somebody reads it again:

```bash
node scripts/release-report/limitations.mjs --changed     # records edited since they were read
node scripts/release-report/limitations.mjs --missing     # records with no entry
node scripts/release-report/limitations.mjs --stamp 0035  # after reading 0035 again
```

The fence detects change, not meaning: a stamp without a reading passes. A
line can outlive its truth until its record changes, which is why CLAUDE.md
asks for a record whenever a decision changes. Where a test already shows
that a line still holds, `heldBy` names it, and the report fails a run in
which it did not pass.

**[`gates.json`](gates.json)** names, for each of the plan's release gates by
number, the evidence a run must pass or why it has none. The plan is a working
document kept out of the repository, so no gate's wording is here. Evidence
is a test `file`, an app's `browserGate`, a gates.yml `job`, `sharedCases`,
or a `document`. A gate passes in a run when everything but its documents
passed; a document is shown as stated, with its last change and how many
commits it is behind, and never as passed in the run.

## Building one on a machine

```bash
since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
pnpm build && pnpm test:repo
pnpm exec turbo run test:coverage --force --summarize   # every package, fresh, with its wall time; needs Docker
pnpm test:browser
node scripts/install-test.mjs
node scripts/release-report/collect.mjs --local --since "$since"
node scripts/release-report/report.mjs --local --allow-missing container,getting-started
```

`--since` has no default. A results file left by an earlier run, read as this
one's, is the failure local mode has to rule out, and only the person running
it knows from when; a file that started before it is listed as stale and the
report fails. That holds for every file a suite's row is built from: its
`vitest.json`, its `coverage/coverage-summary.json` and turbo's run summary
of its task, which `--summarize` writes and a cache hit or a run without it
leaves behind from an earlier one. Getting-started allowed missing, any
record of a composed database on the machine is left out, so a leftover is
not reported as a compose run. A local report says "local" at the top, names
its commit "with uncommitted changes" when the tree held any, names what it
allowed missing when it is partial, and a release refuses it.
