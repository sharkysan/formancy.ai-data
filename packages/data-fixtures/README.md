<!-- Part of Formancy Data: https://github.com/sharkysan/formancy.ai-data -->

# @formancy/data-fixtures

Test support, private, never published. One business model written twice —
`fixtures/postgres.sql` and `fixtures/sqlserver.sql` — with the edge cases the
plan names: a composite key, a foreign key to a unique key that is not the
primary key, a reserved word as a table and a column name, a self-reference
added over a row that breaks it, an exact decimal at its limit, an integer past
2^53, an identity, a computed column, a view, and a type nobody supports. And
`sales.shipment`, the column facts the two engines disagree on (0026): a
by-default identity against a sequence default, a UTF-8 varchar, fixed and
variable binary, a real and a zoneless timestamp with a fraction, and a check
added unvalidated beside one SQL Server disables.

- `startPostgresFixture()` and `startSqlServerFixture()` start a container, load
  the fixture, create `formancy_reader` — who may read `sales.order` and nothing
  else — and `formancy_writer`, the order form's account (`WRITER`), and return
  connection settings for all three principals and the account the owner
  discovers as. A row-level security policy on `sales.customer` shows the
  writer tenant 1 only; it binds nobody else, though SQL Server applies it to
  `dbo` too (0027).
- `FIXTURE_MODEL` is the database-neutral truth. Where the engines genuinely
  differ, it says so per engine rather than smoothing it over.
- `snapshotDisagreements(snapshot)` reports every way a discovered snapshot
  differs from the model, the owner's every privilege and row security
  included, and `restrictedDisagreements(snapshot)` holds the reader's
  snapshot to one rule: the right answer, or a gap — never silence.
  `structuralDisagreements` compares the structure alone, for an account that
  sees everything and is not the owner, and `accessDisagreements(snapshot,
  READER_ACCESS | WRITER_ACCESS)` holds a restricted account to what the
  fixture grants it, column by column, with every column the model has: an
  adapter that left out what the account may not read, as a
  privilege-filtered catalog would, disagrees.
- Beside it, the `parity` schema (0028) — `fixtures/postgres.parity.sql` and
  `fixtures/sqlserver.parity.sql`, loaded last — which is outside
  `FIXTURE_SCOPE`, so no snapshot of `sales` sees it. A tenant column under a
  case-insensitive collation with four tenants that differ by case, a
  trailing space and an accent, beside 20,000 fillers, and a `char(3)` code
  that is `AB` for three of them and `ab` for the fourth; one row with a value
  of every kind a label shows, its floats ones whose text a session's
  `extra_float_digits` changes; and tables whose triggers refuse, decline,
  sleep and deadlock. `FILTER_PARITY`, `DISPLAY_PARITY` and `REFUSAL_PARITY`
  are what both adapters' parity suites expect of it, written once:
  `FILTER_PARITY` is checked against the stored rows on both engines by this
  package's own suite. `PARITY_SCOPE` is the scope that discovers it.
- `EDGE_VALUES` names each inserted edge value as the exact string it is, and
  `FIRST_SHIPMENT` and `SECOND_SHIPMENT` are the two shipments as both
  adapters' record reads must return them — one object, so neither engine can
  spell a real or a zoneless timestamp its own way.

- `startTcpHop({ host, port })` puts a TCP hop in front of a database that
  can lose an answer after the database has sent it (0031).
  `swallowAnswersFrom(marker)` drops a connection's answers from the read in
  which `marker` -- a text the write's answer echoes, in the driver's
  encoding, `answerBytes('postgres' | 'sqlserver', text)` -- completes,
  tolerating one 8-byte TDS packet header inside it; its `cut()` ends only the
  connections that swallowed. `countSent(marker)` counts the marker on its way
  to the database, which is how a suite shows a write was not sent again.
  `cut()` ends every connection. Every byte is the driver's and the server's,
  and a close is passed on only after every byte before it, so a suite behind
  it is not a mocked driver; only a cut loses what is in flight. The host
  page's browser gate puts one between Chromium and the page too. A matched answer is not proof
  of a commit -- PostgreSQL sends a deferred constraint's refusal after the
  row -- so a suite polls a connection of its own until the write is visible
  before it cuts.

Every adapter's suite asserts both lists are empty. That is how "both adapters
pass the same mandatory suite" is something a test checks.
