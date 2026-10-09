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
- `EDGE_VALUES` names each inserted edge value as the exact string it is, and
  `FIRST_SHIPMENT` and `SECOND_SHIPMENT` are the two shipments as both
  adapters' record reads must return them — one object, so neither engine can
  spell a real or a zoneless timestamp its own way.

Every adapter's suite asserts both lists are empty. That is how "both adapters
pass the same mandatory suite" is something a test checks.
