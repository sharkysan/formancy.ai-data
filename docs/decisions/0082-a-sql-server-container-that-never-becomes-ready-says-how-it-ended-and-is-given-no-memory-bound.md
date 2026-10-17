# 0082 — A SQL Server container that never becomes ready fails its start with how Docker says it ended, and is given no memory bound

- **Status:** accepted
- **Date:** 2026-10-17
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-fixtures/src/unready.integration.test.ts`, on the run's
  image of the matrix (0067): a SQL Server container started through
  `startSqlServerContainer`, found by the label naming that file and
  killed with SIGKILL once SQL Server has written a timestamped line of
  its own, fails its start with testcontainers' "Log stream ended and
  message ... was not received", then that the container of that image
  had stopped (exited) with exit code 137, not killed by the OOM killer,
  and every line it had written; and the report of a container Docker
  does not know keeps the strategy's error and adds Docker's 404 after it.
  `packages/data-fixtures/src/unready.test.ts`, pure: Docker's
  multiplexed log read as the lines of both streams in order, a line
  written in two frames joined, a frame the buffer ends inside read as far
  as it goes, the sentence for a stopped container, for one stopped by the
  OOM killer, with Docker's error, and for one still running, and the
  startup timeout passed on to the strategy that waits.
  `packages/data-fixtures/src/fixtures.integration.test.ts`, "the
  fixtures' containers": both fixtures' containers are labelled
  `ai.formancy.data.caller` with the absolute path of the file that
  started them. Each was watched failing on 2026-10-17 with what it holds
  removed: the label (expected undefined to be the test file's path); the
  report not wired into the start (the kill test received exactly CI's
  sentence, `Log stream ended and message "/.*Recovery is complete.*/"
  was not received`, and nothing after it); Docker's refusal thrown past
  the report (the 404 alone, the strategy's sentence lost); in the reader,
  the payload's length read little-endian, the header not skipped, each
  frame split on its own and a cut frame throwing; in the sentence, the
  OOM killer always named, Docker's error dropped, a running container
  read as stopped; and the timeout kept by the wrapper (the log strategy
  waited its default 60 s, not the module's 120 s).

## Context

Two SQL Server starts failed on GitHub's hosted runners on 2026-10-17 with
the same sentence and nothing after it: `Log stream ended and message
"/.*Recovery is complete.*/" was not received`. Read with `gh run view
--log-failed` over every failed attempt of every run the repository has
had, 585 runs and 39 failed attempts, they are the only two; the other
starts that failed failed otherwise, a pull from Docker Hub that timed out
(2026-10-14) and the refused logins `connectWhenAcceptingLogins` now
waits out (2026-10-09):

- **Run 39024938334**, `main`, the job `test-images
  (@formancy/data-fixtures, mcr.microsoft.com/mssql/server:2025-latest)`:
  `src/fixtures.integration.test.ts` failed after 21,195 ms. data-fixtures
  runs one file at a time (`fileParallelism: false`); that file was the
  first to start containers and starts one PostgreSQL and one SQL Server.
  The same job's `sized.integration.test.ts` then started SQL Server 2025
  and loaded a million rows into it.
- **Run 39059935690**, pull request #93, the job `test
  (@formancy/data-server)`: `src/routes/entra.integration.test.ts`, which
  starts `2025-latest` with a certificate, failed after 27,648 ms, and
  passed on the run's second attempt. vitest 5.0.3 runs a run's files on
  `availableParallelism() - 1` workers, three on the runner's four CPUs,
  and data-server's integration files start one SQL Server each, so at
  most three ran at once.

In both, the start that failed was its job's first of `2025-latest`, the
image pulled for it: the fixtures file is data-fixtures' first to start
containers, and in data-server's job only the Entra file starts 2025; in
the first job the next start of the same image passed. Every run since
the matrix gained 2025 makes such a first start in several jobs, and no
other failed. The jobs' release results record the 2025 build CI met as
17.0.5015.4, CU9, the build measured below.

"Log stream ended" is not a timeout: testcontainers follows the
container's log and gives up when Docker ends the stream, which it does
when the container stops. It does so too for a container Docker no longer
knows: following the log of one that is not there ends the stream the same
way (observed here, 2026-10-17, through the 404 test above). testcontainers
then stops and removes the container and rethrows the strategy's error, so
on CI, where the runner goes with the job, nothing was left to ask whether
the server was killed, crashed or was removed.

The suspicion was memory: SQL Server sizes itself to what it sees, by
default 80 % of the host's memory, and the containers set no limit, so
several starting at once on a 16 GB runner might exhaust it and the OOM
killer stop one; and SQL Server 2025 might need more than 2022. Measured on
2026-10-17 on Docker Desktop 28.3.3 on Windows 11, a WSL 2 kernel
5.15.167.4 with cgroup v1, its VM given 15.55 GiB and 20 logical CPUs,
images `2025-latest` 17.0.5015.4 and `2022-latest` 16.0.4295.3, the peak a
container's memory cgroup recorded (`memory.max_usage_in_bytes`) ten
seconds after it was ready:

| Started | Starts | Ready after | Peak per container |
|---|---|---|---|
| `2025-latest` through `startSqlServerContainer`, three at a time | 12 | 14.5 to 31.3 s | 1,094,393,856 to 1,103,081,472 bytes |
| `2022-latest` through `startSqlServerContainer`, three at a time | 6 | 14.6 to 25.4 s | 1,320,435,712 to 1,335,181,312 bytes |
| `2025-latest` by `docker run --cpuset-cpus=0-3`, three at a time on the same four CPUs, as on the runner | 12 | 12 to 20 s | 648,003,584 to 656,125,952 bytes |

So 2025 starts in less memory than 2022, not more, and on four CPUs in
about 0.6 GiB. data-server's whole suite, run once the same day with
`--maxWorkers=3` as on the runner, 49 files and 767 tests passing, had at
most three SQL Server containers at once, none past 1,407 MiB by `docker
stats` sampled every two seconds, and all of the run's containers
together at most 4,138 MiB. The first failure had one SQL Server.
Nothing measured comes near 16 GB, and every container measured here was
larger than it would be on the runner's four CPUs. None of the 30 starts in
the table stopped before it was ready. The two starts of `2025-latest`
before them, the session's first, each wrote nothing past the image's own
three lines for more than 100 s: the first, through
`startSqlServerContainer`, timed out at 120 s, and the second, by hand,
went on after 105 s, its parent `sqlservr` process having spent 98.5 s of
system time against 0.45 s of user time (by `/proc`). A timeout, which is
not what CI said, on this workstation alone, and not seen again.

Memory does not explain the first failure, and nothing measured makes it
the second's. What does is not established.

## Decision

**A SQL Server container that never says it is ready fails its start with
Docker's account of how it ended.** `launchSqlServer` waits for "Recovery
is complete", logged once, as the module does, through a wait strategy
(`unready.ts`'s `reportingUnready`) that, when the wait fails, asks Docker
before testcontainers removes the container: whether it is running, its
status, its exit code, whether the OOM killer stopped it, Docker's error,
when it started and finished, and the last 40 lines it wrote; and appends
that to the strategy's own error. A container Docker no longer knows is
reported with Docker's own answer, a 404, which is a container removed while
it started -- by Ryuk, which removes a session's containers once every
connection to it has closed, or by anything else that removes them. So the
next occurrence says more than the last two: a kill is exit code 137 and
whether Docker counts it an OOM kill, a crash its exit code and SQL
Server's last lines, a removal the 404, a log stream closed under a running
server "still running".

**Every container a starter starts names the file that asked for it**, in
the label `ai.formancy.data.caller`. testcontainers' session label is no
such name: every process on one daemon that finds the same running Ryuk
takes its session id, another worktree's suite on a workstation included.
The kill test finds its own container by this label and could find no
other's.

**No memory bound**, neither `MSSQL_MEMORY_LIMIT_MB` nor a Docker limit,
until a report names an OOM kill.

## Consequences

**What it buys.** A start that fails on CI says why in the job's log, with
the evidence the runner takes away with it, and a contributor who meets one
locally reads the same; `docker ps` names the test file of every
container a suite left running.

Run on 2026-10-17 on the machine above, with the change in place:
data-fixtures' whole suite, 16 files and 174 tests, on `2022-latest` and
on `2025-latest`; data-sqlserver's, 24 files and 360 tests, on each, with
`--maxWorkers=3`; data-server's, the run measured above; and the two
integration cases on `2019-latest`, the kill test there 46 s. All passed.

**What it costs.**

- **The flake is not fixed.** A start that fails so still fails its job,
  and is rerun as before; what changes is that it says how it ended. If it
  never happens again, nothing here said why it did.
- **The readiness sign is restated, not the module's.** "Recovery is
  complete", once, under the 120 s the module sets, is written in
  `containers.ts` as `@testcontainers/mssqlserver` 12.2.0 writes it in its
  constructor; a later module that changed its sign would not change this
  one, and nothing fails when they differ.
- **Written against testcontainers' wait strategy.** The report is made
  inside the strategy because testcontainers removes the container after
  the strategy fails; a release that removed it first, or stopped calling
  the strategy it is given, would leave the report Docker's 404 or nothing,
  which the kill test would show.
- **One more SQL Server start in data-fixtures' suite**, on every image of
  the matrix: the kill test's, killed at its first line, 5.5 s here on
  2026-10-17.
- **The label holds a path of the checkout** on the daemon, visible to
  anyone who can run `docker inspect` there.
- **PostgreSQL's start is not reported so.** Its module waits on a
  health check and the listening port; no PostgreSQL start has failed so in
  the runs read, and its strategy is not restated here.

**What it does not do.** Find the cause of the two failures; bound any
container's memory; retry a start. Nor show what Docker reports of an
OOM kill: no test provokes one, so that the host's OOM killer, rather than
a container's own limit, is reported as "killed by the OOM killer" is
Docker's to say and was not seen here; such a kill is exit code 137 either
way, which the report quotes.

**What it forecloses.** Nothing a later record cannot undo.

## Alternatives considered

**A memory bound per SQL Server container**, `MSSQL_MEMORY_LIMIT_MB` or a
Docker memory limit, as the suspicion suggested. The measurements above do
not make memory the cause, and the first failure ran one SQL Server on a
16 GB runner. A bound would change what the performance harness measures,
which records each database container's limits and has measured with none
(0034), and a bound too small for a suite -- the sized table's million rows
-- fails in a way of its own. Left until a report names an OOM kill.

**Retrying a start that fails so.** CI would be green and nothing would be
learned: a SQL Server 2025 that sometimes dies while it starts is a fact
about a release the matrix calls tested, and a retry hides it.

**`DEBUG=testcontainers:containers` on CI**, which logs every line of
every container. Every job's log would carry every SQL Server's whole
start, and still not Docker's exit code or the OOM killer.

**A log consumer** (`withLogConsumer`), keeping each container's lines as
they come. The lines, but not how the container ended, and a buffer per
container for every start that succeeds.

**Pulling the images in a step before the suites.** The pull is not where
it failed: testcontainers waits for the container's ports to be published
before it follows the log, so both containers had started.

**Finding the container by testcontainers' session label** in the kill
test. Shared by every process that found the same Ryuk, so on a
workstation the test could kill another suite's SQL Server.

## Older records

Consistent with, and not changed:
[0003](0003-real-databases-in-every-test-run.md), whose containers are
started as before; [0035](0035-a-release-report-is-derived-from-the-run-that-gated-it.md),
whose server records a start that fails before its server answers never
wrote, as before; and
[0067](0067-the-adapter-suites-run-on-every-image-of-a-per-engine-matrix.md),
on each of whose images the kill test runs.
