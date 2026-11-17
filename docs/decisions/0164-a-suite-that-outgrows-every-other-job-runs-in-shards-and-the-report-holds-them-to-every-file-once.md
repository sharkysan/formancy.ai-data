# 0164 — A suite that outgrows every other job runs in shards, and the report holds them to every file once

- **Status:** accepted
- **Date:** 2026-11-17
- **Deciders:** Daniel Bacher
- **Verified by:**
  `scripts/ci-test-jobs.test.mjs` (`pnpm test:repo`) -- every package with
  a suite has a leg of the `test` job, and each runs whole once or in
  shards 1/N to N/N, each once, which is the host's two today (watched
  failing with shard 2/2 deleted from the `include` list, with the host
  listed whole beside its shards, and with 2/2 typed as 2/3).
  `scripts/release-report/workflows.test.mjs` -- a job keyed by a package
  and a shard is read as its list, whole, and its `include` entries, and an
  entry for a listed package, an entry with no shard, a key crossed beside
  the list, a shard of 3/2 or 1/1 and `--shard` beside `--variant` are each
  refused (watched failing with the refusal of a listed package removed);
  the report expects `test-app-host-1of2` and `test-app-host-2of2` and no
  `test-app-host` (watched failing with 2/2's entry deleted, with the host
  listed whole as well, and with `--shard` dropped from the collect step);
  each shard's leg lists its suite's files after the install and before its
  run, and no other leg does (watched failing with the list's command
  replaced); and the test step hands the shard to vitest after turbo's
  `--`, which the image legs' identical command, given no shard, leaves out
  (watched failing with the shard dropped from the command).
  `scripts/release-report/collect.test.mjs` -- a shard's key is
  `test-<id>-<i>of<n>`, and 0/2, 3/2, 1/1, 1-2, 1/2/3 and nothing are
  refused (watched failing with the suffix dropped and with one shard of one
  accepted); a shard's results carry every file its suite resolves,
  repository-relative and sorted; a leg that wrote no list is listed as
  missing it, and `--shard` outside the test job is refused (each watched
  failing with its rule removed). `scripts/release-report/report.test.mjs`
  -- two shards of a green run are one row with no problems, every file and
  test counted once, the longer shard's wall time and no coverage (watched
  failing with the wall times added and with the first shard's coverage
  shown); one shard's results missing, on a machine and as a missing
  artefact in CI, fails the run naming the shard and the files nobody ran
  (watched failing with the absent-shard rule removed, and with the
  unrun-file rule removed); a file of the suite that no shard ran fails it;
  a file in two shards fails it (watched failing with that rule removed);
  shards of two counts, or a whole leg beside the shards, fail it (watched
  failing with that rule removed); and the list itself is held: a
  file a shard ran that no list names, every list empty while the shards
  ran files, and a file one shard's list names and another's does not each
  fail it (each watched failing with its rule removed, the empty list's
  also with the flag that sets it forced false).
  `scripts/release-report/render.test.mjs` -- the row names its shards and
  says its coverage is not merged (watched failing with each removed).
  **Not yet shown by GitHub:** that the two `include` entries make two legs
  and the step under `if: matrix.shard` runs in those alone, that the job's
  name renders as `test (@formancy/data-host, 1/2)`, and what each shard
  takes; the first run of the shards shows all of it, and its run id and
  times belong here when it has.

## Context

The host page's suite mounts both renderers against the real server on both
engines in nearly every file (0029, 0047), so it grows by minutes with a
feature. On main's run 44027383496 (2026-11-17) its job took 39 min 27 s
and its turbo task 2331 s: 91 files whose times, each file's start to its
end as vitest's JSON records them, added up to 6728 s over a span of
2303 s, about 2.92 files at a time. The run's next longest
jobs were the browser legs, WebKit's 23 min 16 s, Firefox's 20 min 37 s and
Chromium's 17 min 33 s; every other leg of the `test` job took under 8
minutes, and every image leg under 11. The job's limit was 40 minutes,
raised from 25 on 2026-10-29 (#129) with a note in
[§11.6](../architecture/11-risks-and-debt.md#116-people-and-process) that
splitting the suite across runners was the next step. Pull
request #202, the host page's actions (0162), added tests whose run passed
40 minutes the same day (run 44029572857, cancelled at the limit), and
raised the limit to 60 in its own change.

0035 gave each package's suite a runner of its own, after nine suites on one
runner timed a test that takes 2 s alone out past 60 s, and its report
expects one results artefact per leg of the `test` job.

vitest 5.0.3's `--shard=<i>/<n>`, as its source installed here reads
(`BaseSequencer.shard` and `calculateShardRange`): it globs the files the
suite resolves as a whole run does, sorts them by the sha1 of each path from
the package's root, and runs the i-th of n runs of them, their sizes
differing by one at most. It is file by file and the same on every machine
for one list, and every shard runs the suite's `globalSetup`, here both
databases. `vitest list --filesOnly` globs through the same function a run
starts with and runs nothing, `globalSetup` included: listed on 2026-11-17
on a Windows 11 workstation, it named the host's 91 files in 3.7 s and
started no container.

## Decision

A package's suite may run in shards. The `test` job's matrix names it in
`include`, an entry per shard as `<index>/<count>`, rather than in its
`package` list; each shard is a job of its own on a runner of its own,
starting its own databases, which first writes every file the suite
resolves with `vitest list --filesOnly` and then runs
`turbo run test:coverage … -- --shard=<index>/<count>`. The host's suite
runs in two.

Each shard leaves its results under `test-<id>-<index>of<count>`, with that
list. The report reads a package's shards as one suite: each file and test
once, its wall time and span the longest shard's, and no coverage. It fails
the run on a shard that left no results, on legs other than 1/N to N/N each
once, on a file of the list that no shard ran and on a file two shards ran,
beside everything it fails a whole suite on; and it holds the list those
rules read, failing the run on a file a shard ran that the list leaves out,
on a list that names no file while the shards ran some, and on shards whose
lists differ. The matrix is the one place a package's shards are declared:
`scripts/ci-test-jobs.test.mjs`, the report's expected artefacts and its
checks all read it.

## Consequences

**What it buys.** Predicted, not measured: shard 1/2's 46 files took 3626 s
of run 44027383496's file time and 2/2's 45 took 3101 s; at that run's 2.92
files at a time, their spans come near 1241 s and 1062 s, and their tasks,
with the 28 s that run's task spent outside its span, near 1270 s and
1090 s, about 21 and 18 minutes, so the run's longest job would be WebKit's
browser leg again. That run came before 0162 added its files, which the
split places wherever their paths hash. The first run of the shards
measures them.

**What it costs.** The host's suite takes two runners where it took one, and
each installs, builds what the host depends on, pulls SQL Server's image of
about a gigabyte and a half and starts both databases. On run 44027383496
the whole suite's job spent 36 s outside its task and its task 25 s before
its first file; the runner time the second set adds is not measured yet.

The split is vitest's, by a hash of each path and not by time: shard 1/2
holds both of that run's longest files, `page.test.tsx` at 784 s and
`drill.test.tsx` at 655 s, and is the longer by 525 s of file time. A file
added or renamed moves the split, and nothing here balances it; a third
shard is the next step when one nears the limit.

The report shows no coverage for a suite in shards: each shard's
`coverage-summary.json` counts only the lines its own files reached, and two
totals do not add up to the lines either reached. Each shard uploads its own
report to Codecov, which merges a commit's uploads; a release uploads none,
so a release's report has no coverage figure for the host's suite, and its
row says "not merged across its shards". A sharded row's wall time is its
longer shard's task, and vitest's span its longer shard's.

Each shard's leg runs `vitest list` before its suite and fails if it fails.
vitest 5.0.3 refuses a shard count larger than the suite's files unless
`passWithNoTests` is set (its `executeTests`), which the host's config
does not set; with it, a surplus shard would run nothing and pass, and the
report's list is what would hold the other shards to every file. The job
keeps the 60-minute limit #202 gave the whole suite; the first run of the
shards measures how much of it they take.

turbo hands what follows its `--` to the task the command names and not to
the builds `^build` runs first: watched on turbo 2.11.2 on 2026-11-17, where
`turbo run typecheck --filter=@formancy/data-client --force -- --pretty` ran
`tsc --noEmit "--pretty"` and `tsdown` with no argument in data-core and
data-identity. Its `--dry-run=json` names the arguments on every task all the
same, which is not what it runs. A turbo release that handed them to the
builds too would not show itself as a red build: tsdown 0.23.0's build
command accepts options it does not know (`allowUnknownOptions` in its
CLI), and nothing here has run one with `--shard`. vitest would still
divide the suite. A turbo that stopped handing `--shard` to vitest would
have each shard run every file, which the report fails as files run in two
shards.

The `test` job's check names become `test (@formancy/data-host, 1/2)` and
`(…, 2/2)`, and the artefact `release-results-test-app-host` becomes one per
shard. Nothing here requires a check by name (`GOVERNANCE.md`).

**Not held by anything:** that the shards stay near balanced, and that 60
minutes suits them, until the first run measures them.

**What it forecloses:** nothing. A package returns to one job by moving it
from `include` back to the list.

## Alternatives considered

- **Raising the limit**, as #202 did to 60. Every pull request still waits
  for the whole suite, which grows with each feature, and the limit chases
  it.
- **Three shards.** Predicted the same way, spans of 803 s, 843 s and
  656 s, about 13, 14 and 11 minutes; but a third runner with its own image
  pull and databases, when two already bring the host below the browser
  legs a run waits for.
- **Files divided by a list kept by hand.** A new file goes in no list until
  somebody notices, which is the failure the report now catches; vitest's
  hash divides them with no list to keep.
- **turbo's own splitting.** turbo divides work by package and task, not
  one task across machines, and the host is one package; two packages would
  be a workspace change for CI's sake.
- **vitest's blob reporter and `--merge-reports`** in a job after the
  shards: one merged JSON and one merged coverage, but another job with the
  host's dependencies, after both shards and adding its own time, where the
  report can read the shards' own results.
- **The shard count in the package's manifest.** A matrix cannot read a
  manifest without a job before it that computes the matrix, before every
  test leg; the workflow is already the list the report reads (0035).
- **Shards balanced by time**, with each file's last duration. Durations
  kept between runs are a cache, which a release does not restore.
- **One key for both shards.** An artefact holds exactly its own key's file
  (0035), and two uploads of one name replace each other.

## Older records

0035 is extended: a package's suite may run in shards, each on a runner of
its own, and its report reads them as one suite and fails on a shard
missing, legs of another shape, a file run in none or two, or a list of
the suite's files that leaves one out, names none or differs between
shards; its Status line says so. 0003 is applied unchanged: each shard
starts real databases.

0067 rejected `include:` entries on the `test` job because its legs were
one per package, which its guard and the report's keys rested on. That no
longer holds: the host's shards are such entries, and the guard and the
keys tell a shard from a whole leg by its `shard` value. 0067's decision,
a job of its own for the image legs, stands unchanged: image legs in the
`test` job would still need a condition on its coverage upload, which
shards, uploading as any leg does, do not.
