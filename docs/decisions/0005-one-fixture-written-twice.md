# 0005 — One business model, written twice, and one comparator both adapters answer to

- **Status:** accepted; the list of where the engines differ is extended by [0026](0026-name-every-column-fact-the-engines-disagree-on.md); the fixture, by a writer and a row-security policy, and the comparator, by what each account may do, extended by [0027](0027-a-snapshot-says-what-its-account-may-do.md)
- **Date:** 2026-10-08
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-fixtures/src/load.test.ts` — both SQL files
  name the same constraints, and every `CREATE SCHEMA` and `CREATE VIEW` opens
  its own T-SQL batch. `packages/data-fixtures/src/fixtures.integration.test.ts`
  — both files load into real servers, every value `EDGE_VALUES` names reads
  back exactly as text, and the restricted reader can read `sales.order` and is
  refused `sales.customer` (PostgreSQL `42501`, SQL Server `229`).
  `packages/data-fixtures/src/conformance.test.ts` — the comparator passes a
  perfect snapshot on both engines and names each kind of break, and the model
  cannot be edited by a test.

## Context

The plan's first release gate is that both adapters pass the same mandatory
behaviour suite. That needs three things to exist once rather than per adapter:
the database each suite runs against, what the right answer is, and how a
snapshot is compared with it. If each adapter suite wrote its own, they would
agree on day one and diverge on the first day somebody added a table to one of
them, and nothing would notice.

## Decision

`@formancy/data-fixtures`, a private workspace package that is never published,
holds:

- **One model in two dialects.** `fixtures/postgres.sql` and
  `fixtures/sqlserver.sql` describe the same tables, with identically named
  constraints and lower-case identifiers, covering the plan's required edge
  cases.
- **The neutral truth.** `FIXTURE_MODEL` says what discovery must report. Where
  the engines genuinely differ — today only the version column, which is
  `rowversion` on SQL Server and an application-maintained `bigint` on
  PostgreSQL — it says so per engine, in `byKind`, rather than smoothing it over.
  A property the model leaves out, like a timestamp's precision, is not
  compared.
- **One comparator, reporting.** `snapshotDisagreements` and
  `restrictedDisagreements` return every difference as a sentence, the shape
  `@formancy/conformance` takes upstream. Each adapter asserts the lists are
  empty.
- **One harness.** `startPostgresFixture` and `startSqlServerFixture` start the
  container, load the fixture and create the restricted reader, and both return
  settings for both principals.

## Consequences

**What it buys.** A behaviour that passes on one engine and fails on the other
fails a named sentence, in a suite both adapters run. A new edge case is one
table in two files and one entry in the model, and both adapters are held to it
from the next run.

**What it costs.** Every change to the business model is a change in three
places, two of them in different SQL dialects, and the person making it has to
know both. The constraint-name check catches the commonest slip — a constraint
added to one file — but not a column type changed in one file only; the
adapters' conformance runs catch that, one step later. Running the integration
test starts both servers, about a minute cold.

**What it forecloses.** An adapter suite with its own private fixture for
discovery. A test for something the shared model does not express is a reason to
extend the model.

## Alternatives considered

**Generate both SQL files from one description.** Rejected for now: the
interesting cases are precisely where the dialects differ — `NOT VALID` against
`WITH NOCHECK`, `overriding system value` against `identity_insert`, `GO` — and
a generator would have to know all of them, which is writing the two files with
extra steps. Worth revisiting if the model grows past what two people can read
side by side.

**Snapshot tests: record what each adapter returns and compare to the
recording.** Rejected: a recording is whatever the adapter did the first time,
including its bugs, and the review question becomes "is this diff fine" rather
than "is this right".
