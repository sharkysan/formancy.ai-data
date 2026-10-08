# 0003 — Database behaviour is proved against real servers, on both engines, in every run

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-postgres/src/adapter.integration.test.ts`
  and `packages/data-sqlserver/src/adapter.integration.test.ts` start
  `postgres:17-alpine` and `mcr.microsoft.com/mssql/server:2022-latest` through
  testcontainers and run against them; `ci.yml` runs `pnpm test:coverage` on
  every pull request, on a runner with Docker, with no step that skips a suite
  when a database is absent. That no mocked driver exists is **not
  mechanically enforced** — nothing fails if somebody adds one — and is held
  by review and by `CLAUDE.md` saying so in as many words.

## Context

The product's job is to translate one intent into two databases' operations
without silently losing precision, time semantics or relationship behaviour.
Every hard problem in the plan is a database-semantics problem: what a
restricted account cannot see in `referential_constraints`, what `rowversion`
is and is not, what a composite foreign key to a unique candidate key looks like
in each catalog, how each engine reports a unique-violation or a stale version.
None of it is visible to a mock, and a mock of a catalog view is a transcription
of what the author believed the catalog returns — which is the belief under
test.

formancy.ai's server suite made the same call for its one database: "versioning
and submission bugs only manifest under real SQL semantics, so mocks are
explicitly not welcome here" ([formancy.ai 0024](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0024-postgres-over-mongodb.md)).
This repository has two databases and the argument is twice as strong.

## Decision

Every adapter behaviour is tested against a real server of each kind, through
testcontainers, against the exact images the tests name, on every pull request.
There is no mocked driver, no `--skip-db` flag and no environment variable that
turns a suite into a no-op. Pure logic in `data-core` is unit-tested where it
lives; that does not excuse an adapter from proving what the database does with
the result.

## Consequences

**What it buys.** A green run means both engines did what the adapter claims.
A behaviour that passes on PostgreSQL and fails on SQL Server fails the pull
request, which is the whole promise of database neutrality made checkable.

**What it costs.** Time and a dependency. SQL Server's image is about a
gigabyte and a half and takes tens of seconds to accept a connection, so a cold
run is minutes, not seconds, and the `verify` job's timeout is longer than
upstream's for exactly this. A developer without Docker cannot run the adapter
suites at all, and the repository says so rather than offering a mode that
pretends otherwise. Passing against `2022-latest` and `17-alpine` says nothing
about SQL Server 2019 or PostgreSQL 14; the supported matrix is whatever the
tests name, and widening it is adding images, not adding claims.

**What it forecloses.** A fast, database-free adapter suite. There will be
pressure for one on the first slow day, and the answer is in this record.

## Alternatives considered

**Mock the drivers, run integration tests nightly.** Rejected: the nightly run
finds the defect after the pull request that introduced it was merged, and a
mock that passes is a statement about the mock.

**One database in CI, the other on demand.** Rejected: it makes one engine the
real one and the other a port, which is the divergence the product exists to
prevent, and the plan's release gate requires both adapters to pass the same
mandatory suite.

**A shared, long-running test database instead of containers.** Rejected:
state leaks between runs, a developer's run collides with CI's, and the exact
server version under test becomes whatever the shared instance happens to be.
