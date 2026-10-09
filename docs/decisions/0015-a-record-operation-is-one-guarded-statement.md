# 0015 — A record operation is one guarded statement, canonical in and out, never retried

- **Status:** accepted
- **Date:** 2026-10-09
- **Deciders:** Daniel Bacher
- **Verified by:** both adapters' record and lookup suites, against real
  servers: `packages/data-postgres/src/records.integration.test.ts` and
  `lookups.integration.test.ts` (0016), and
  `packages/data-sqlserver/src/records.integration.test.ts`,
  `records-failures.integration.test.ts` and `lookups.integration.test.ts`
  (0017). Each reads every fixture edge value back exactly, runs two concurrent
  updates with one expected version and gets one winner and one `stale`,
  returns `not-found` for another tenant's record exactly as for a missing
  one, translates each constraint the fixture can provoke, and never retries
  a write whose outcome is unknown. `discovery.integration.test.ts` in both
  checks that discovery through `DatabaseAdapter.discover` is the same
  snapshot, by fingerprint, as calling discovery directly. This line was
  written when the contract had no implementation and said it would be
  updated when the suites landed; it now is.

## Context

The spike (0006, 0007) answered the questions plan section 12 left open, and
each answer constrains the write path:

- Both drivers lose exact values by default somewhere. `tedious` returns
  `decimal(18,4)` as a JavaScript number and `date` as midnight UTC;
  `postgres.js` returns whatever the composition root configured. A `bigint`
  key bound as a JavaScript number addresses a different row on both engines.
- Optimistic concurrency holds on both: a stale `rowversion` or version-column
  update affects 0 rows. Under REPEATABLE READ PostgreSQL raises `40001`
  instead.
- `sql('a.b')` in `postgres.js` quotes a dotted name as two identifiers.
- A text length the codec accepted can still be refused: SQL Server's UTF-8
  `varchar(n)` counts bytes.

## Decision

`RecordAdapter` — `read`, `insert`, `update` — is a port of its own beside
`LookupAdapter`, not more methods on `DatabaseAdapter`, so the lookup and record
halves can be built and tested apart.

- **Canonical in, canonical out.** Values arrive as a codec returned them and
  are bound from that text; values leave converted to text in SQL, never
  through the driver's number or date handling.
- **One guarded statement per write.** An update names the key, the trusted
  filters and the expected version in one `WHERE`, and for a version column
  increments it in the same statement. Nothing can change between check and
  write.
- **Not found is not forbidden.** A record outside the filters does not exist
  for the call, so another tenant's row is never disclosed by a different answer.
- **Errors are values.** A database refusal is a `RecordFailure` with a stable
  code; `40001` is `stale`. Only a programming error throws.
- **An ambiguous write is never retried.** A connection lost after a write was
  sent is `unknown-outcome`, and the host reconciles (plan section 12).
- **Identifiers are quoted one part at a time** by the adapter, from the
  request, never with a helper that splits on dots.

## Consequences

**What it buys.** The server composes three ports per connection and can test
each against a fake; both adapters are held to one set of failure codes, so a
form shows the same message whichever engine refused.

**What it costs.** Every read converts every column to text in SQL, which is
slower than letting the driver parse and makes each adapter's SELECT list
engine-specific. A failed update costs a second query to tell `stale` from
`not-found`. `unknown-outcome` pushes real work onto the host, which must be
able to look a record up by something other than an identity it never received.

**What it forecloses.** Automatic retries of writes, and bulk writes, in this
port.

## Alternatives considered

**One `DatabaseAdapter` with every method.** Rejected: one interface with a
dozen methods for two implementations, and three parallel pieces of work forced
through one file.

**Pessimistic locking (`SELECT … FOR UPDATE` / `UPDLOCK`) between read and
write.** Rejected: a form is open for minutes, and a lock held across a person
thinking is a lock held across a lunch break.

**Let the driver parse values.** Rejected by the spike: on both engines the
default is lossy somewhere, and differently.
