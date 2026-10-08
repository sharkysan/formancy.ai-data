# 0006 — Discover PostgreSQL from pg_catalog, and ask separately what the account may use

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-postgres/src/discovery.integration.test.ts`
  against `postgres:17-alpine` loaded with the shared fixture —
  *information_schema hides every constraint on sales.order from the reader;
  pg_catalog hides none* (the reason for the source), *sees sales.order exactly
  as the owner does* (fails the moment discovery reads a privilege-filtered
  view), *says the right thing about every foreign key of sales.order*
  (`restrictedDisagreements` is empty), *describes only what it may use, and
  names each of the rest as a gap*, *a table granted column by column is
  described, with a columns gap*, *a table in a schema the account has no
  USAGE on is a gap that says so*, *a revoked privilege changes the
  fingerprint and turns the object into a gap*, and *a schema name carrying a
  quote and SQL is bound*. `packages/data-postgres/src/discovery-shapes.integration.test.ts`
  holds the catalog details below: unique indexes as keys, one foreign key per
  declaration to a partitioned table, enforcement read from triggers
  including those of a partition on either side, a foreign table as a gap.
  That no discovery query reads `information_schema` is held by those
  behaviours, not by a search of the source: a query moved to it fails the
  reader tests above.

## Context

[0004](0004-a-snapshot-says-what-it-could-not-see.md) requires a snapshot to
say what the connection could not see, and names PostgreSQL's
`information_schema` as the permission-filtered view. Measured against the
fixture's `formancy_reader`, who may `SELECT` from `sales."order"` and nothing
else, the filtering is wider than the plan's citation suggests: the reader
sees **no** row in `information_schema.referential_constraints` for the
schema and **no** row in `information_schema.table_constraints` for
`sales.order` — not its foreign keys, not its primary key, not its check —
because that view lists constraints only on tables the account owns or holds
a privilege **other than SELECT** on. `pg_catalog.pg_constraint` shows the
same account all five.

The rest of `pg_catalog` behaves the same way. `pg_class`, `pg_attribute`,
`pg_constraint`, `pg_index`, `pg_trigger` and `pg_description` are readable by
every role, and `format_type` and `pg_get_expr` deparse for anyone. On
PostgreSQL, what the catalog shows is therefore never the question. What the
account may *use* is a separate question, and the catalog does not answer it
unless asked.

The fixture showed four more places where reading the catalog naively gives a
wrong answer that still looks plausible:

- a stored generated column has `atthasdef` set and its expression filed in
  `pg_attrdef`, like a default;
- a foreign key that references a partitioned table gets one cloned
  `pg_constraint` row per partition, on the same referencing table;
- `ALTER TABLE ... DISABLE TRIGGER ALL` stops a foreign key being checked and
  leaves `pg_constraint` exactly as it was — PostgreSQL 17 has no `NOT
  ENFORCED` foreign key, so this is the only way one stops being enforced —
  and when either side is partitioned, the triggers that matter sit on the
  partitions and belong to each partition's clone of the constraint, not to
  the one declared;
- `CREATE UNIQUE INDEX`, which most migration tools emit, is a key PostgreSQL
  accepts as a foreign key's target and is absent from `pg_constraint`.

## Decision

**Read `pg_catalog`, never `information_schema`**, in one `REPEATABLE READ`,
read-only transaction, one query per concern (objects, columns and types,
keys, foreign keys, checks, comments), with the schema names in scope bound as
a parameter.

**Describe an object only if the account can use it, and report every other
table or view in scope as a gap.** Usable means `USAGE` on the schema and at
least one of `SELECT`, `INSERT`, `UPDATE` or `DELETE` on the table or
`SELECT`, `INSERT` or `UPDATE` on one of its columns. An object in scope
without that is not described; it is named in an `objects` gap that says why.
A usable object the account cannot `SELECT` as a whole is described with a
`columns` gap. A foreign table is an `objects` gap. A partition is described
through its parent.

A foreign key keeps its target even when the target is an object the account
cannot use: `pg_class` names it, so `references` is never `null` on
PostgreSQL, and the target's own gap says it cannot be used.

## Consequences

**What it buys.** The restricted reader gets the right answer rather than a
gap: its description of `sales.order` is the owner's, field for field,
including `fk_order_customer`'s target in a table it cannot read. A revoked
privilege moves the fingerprint and shows up as a gap naming the object, so
drift review can report "access changed" instead of "table dropped", which is
what 0004 promised and what describing every visible object would have lost.
And the snapshot answers the question a form generator actually has, which is
"what may this connection bind", not "what exists".

**What it costs.** A snapshot now describes a database *as seen by one
account*. The owner's snapshot and the reader's differ, and so do their
fingerprints; comparing snapshots taken by two accounts reports an access
change, not drift. Discovery has to run as the account the forms will run as,
and the documentation has to say so. The privilege test is coarse: it does
not see row-level security, so a table whose policies hide every row is
described as usable, and a `columns` gap says the account cannot read every
column without saying which, because the contract has nowhere to put that.
`pg_catalog` is also version-specific in a way `information_schema` is not:
PostgreSQL 18 adds `conenforced`, `NOT NULL` constraints in `pg_constraint`
and virtual generated columns, and none of those is tested here, because the
suites run 17 only. Defaults and check expressions are kept as the server
deparses them, and they are inside the fingerprint, so a major upgrade that
deparses an expression differently will read as drift. The deparsing
functions read the catalog caches, not the transaction's snapshot, so the
"one moment" guarantee covers the rows and not those spellings. Finally,
`enforced` is read from triggers as they fire in an ordinary session; a
session with `session_replication_role = replica` skips them, and nothing in
the snapshot can say so.

**What it forecloses.** A reader-agnostic snapshot on PostgreSQL. If one is
ever wanted — a schema browser for an administrator, say — it is a different
operation with a different fingerprint, not a flag on this one.

## Alternatives considered

**`information_schema`.** Rejected on the measurement above: a SELECT-only
account sees none of the constraints on the table it reads, so the adapter
would report the most common restricted configuration as a table with no
key and no relationships, and nothing in the snapshot would say so.

**Describe everything `pg_catalog` shows, whatever the account's
privileges.** The simplest code, and the snapshot would be the same for every
account. Rejected: `sales.customer` would be offered to the reader as a form
or a lookup source that fails at its first read, a revoked privilege would
not change the fingerprint at all, and the PostgreSQL reader's snapshot would
list objects the SQL Server reader's cannot, for a reason that is the
engines' and not the database's.

**Leave out what the account cannot use, without a gap.** Rejected: that is
the silent answer. "There is no such table" and "this account may not use
it" become the same snapshot, and a revoked privilege reads as a dropped
table.

**Describe only what the account can `SELECT` as a whole.** Rejected: an
account narrowed for lookups is often granted `SELECT (id, name)` and nothing
more, and the lookup that grant was made for would vanish. The `columns` gap
is the honest version of that object.

**Keys from `pg_constraint` only.** Rejected: it reports no unique key on the
tables most migration tools build, and a foreign key could point at columns
that are not a key of their table.
