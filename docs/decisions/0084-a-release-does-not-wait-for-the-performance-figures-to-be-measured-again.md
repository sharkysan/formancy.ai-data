# 0084 — A release does not wait for the performance figures to be measured again

- **Status:** accepted
- **Date:** 2026-10-18
- **Deciders:** Daniel Bacher
- **Verified by:**
  `scripts/performance-stale.test.mjs`, "is run by no workflow": every
  file in `.github/workflows/`, parsed, has no step whose command names
  `performance-stale`, `--describe` included, and `ci.yml`, `gates.yml` and
  `release.yml` are among the files read. Watched failing on 2026-10-18
  with the release's `check` step still in place (received
  `.github/workflows/release.yml: check`) and with the command planted in
  `cla.yml`, a workflow the guard before it did not read (received
  `cla.yml: signed`). The same file still holds the command itself: on a
  repository in miniature it exits 1 naming a changed file, however the
  script is reached (0034).

## Context

[0034](0034-performance-is-measured-through-the-shipped-server-and-held-without-a-clock.md)
publishes what each runtime request costs, measured through the shipped
server on one quiet machine, and refused a release whose measured product
-- the source files the measurement runs, the server's and the client's
installed runtime dependencies, the build inputs -- differed from what
`docs/performance/results.json` recorded: `release.yml`'s `check` job ran
`node scripts/performance-stale.mjs`, and publishing waited for it. CI did
not run it, so a pull request was never held; a release was, until
somebody measured again and committed the figures.

Measuring again is not a command a runner can make (0034: a time taken on a
shared runner is not a figure). It is `pnpm performance` on a machine with
nothing else running: the harness refuses while another container runs and
gives up when the load average does not fall below 1, with at most one busy
vCPU, within 180 s. The figures 0.1.0 shipped with took 9,756 s, from
2026-10-15T19:22:59Z to 22:05:37Z, in WSL 2 on the workstation the
repository is developed on, which is also where its other work runs.

On 2026-10-18, with every change since 0.1.0 merged, `node
scripts/performance-stale.mjs` on `main` (03de5c0) named 71 measured source
files (21 added, 49 changed, 1 removed), `tedious` measured at 20.3.3 and
installed at 20.3.7, and `sprintf-js` no longer installed. 0.2.0 could not
be cut until that workstation stood still for close to three hours. Among
what waited was tedious 20.3.7, which refuses a SQL login's unencrypted
answer itself (0081).

## Decision

**A release does not wait for the performance figures.** No workflow runs
`scripts/performance-stale.mjs`. `RELEASING.md`'s step 2b runs it before a
release, as it did, and when it names a difference the maintainer either
measures again or says, in the version's changelog section, that the
figures were measured on an earlier product and which. The command, what
it compares and what `results.json` records are unchanged.

## Consequences

**What it buys.** A release is held by its gates -- every suite on both
engines, the browsers, the install, the image, the guide -- and not by
whether one machine can stand still for three hours. A fix that waits on a
release, a dependency's included, waits for that alone.

**What it keeps.** What 0034 holds without a clock is held as before: rows
read and round trips are pinned on both engines in CI on every pull
request, and `scripts/performance-doc.test.mjs` holds the page to what
`results.json` renders. The page names the commit it was measured at, a
digest of the product and the drivers' versions, and `node
scripts/performance-stale.mjs` names every difference from the tree it is
run in.

**What it costs.**

- **A release can ship figures measured on an earlier product.** The times
  on `docs/performance.md` may describe a version before the one a reader
  runs. The page's *When and on what* and the version's changelog section
  are what say so; a reader who reads neither will not know.
- **That sentence is held by review.** Nothing fails when a version's
  section leaves it out, or names the wrong version.
- **The default lookup deadline stays what the older figures derived.**
  [0063](0063-the-default-lookup-deadline-is-outside-the-measured-product.md)
  derives it from the slowest lookup answer the committed results hold, so
  a release whose lookups became slower or faster since ships the deadline
  the earlier product earned, until somebody measures.
- **A regression in time is found later.** A change that makes a request
  slower without changing its rows or round trips was found at the latest
  by the release; now it is found at the next measurement, whenever that is.

## Alternatives considered

- **Keep refusing, and measure before every release.** Close to three hours
  of the development workstation with nothing else running, each time the
  measured product changes, which is nearly every release. It held 0.2.0,
  and it would hold a release whose only change is a dependency's fix.
- **Measure on a CI runner.** 0034 rejects it: a runner is shared, and a
  time taken on one is not a figure.
- **Keep the step and let it fail without failing the release**
  (`continue-on-error`), or print a warning. A line in a run's log nobody
  opens before tagging is a comment. The version's changelog section is
  read, which is why step 2b puts the sentence there.
- **Have the release body say it, derived by the report job.** Stronger
  than a sentence held by review, and not built here, which removes the
  refusal and nothing more. It is the way back if a section ever leaves the
  sentence out.
- **Keep the step behind an input a release can switch off.** A switch
  flipped for every release is this decision, with a step that says it
  checks.
