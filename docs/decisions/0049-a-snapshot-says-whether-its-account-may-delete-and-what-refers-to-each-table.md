# 0049 — A snapshot says whether its account may delete from each table, and every foreign key that refers to it

- **Status:** accepted; narrowed by [0050](0050-a-record-is-deleted-one-at-a-time-by-its-token-and-the-version-its-person-read.md): between two snapshots that both record the facts, a `referenced-by` gap on the root stops delete, and a current snapshot without the facts its base had stops it too; extended by [0056](0056-a-key-the-database-fills-is-never-written-and-a-uuid-is-ordered-as-each-engine-orders-it.md): the writer may also delete deliveries and parcels, which a delete of an order now cascades into, and the comparators and both adapters' access suites hold its DELETE to `order`, `order_line`, `delivery` and `parcel`
- **Date:** 2026-10-11
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/snapshot.test.ts` — a snapshot taken before this
  record, with neither fact on any object, validates and hashes to the
  fingerprint the release before it made of the same objects, a literal
  computed by data-core at `0cf7ce8` (watched failing with the absent facts
  filled in as `delete: false` and no keys); one fact without the other, an
  object without them among objects with them, an `access.delete` that is
  not a boolean and a `referencedBy` that is not a list are refused naming
  the object; a key between two tables of the snapshot missing from the
  referenced table's `referencedBy`, listed there with no such foreign key
  on its own table, or said there otherwise -- another action, another
  enforcement -- is refused; a key from a table outside the snapshot is
  accepted, and so is a foreign key whose target is hidden, and
  `referencedBy` sorts by the referring table and the key's name in
  codepoint order; an inbound key named twice, with no columns, with
  two sides of different lengths, referring to a column the table does not
  have, with an action outside the five, without an enforced flag, without a
  name or with a malformed table is refused; so are referring columns that
  are not names, a referenced column named twice and a key onto a view,
  while a referring column named twice, which PostgreSQL accepts, is not; a
  revoked DELETE and a new key each move the fingerprint, and a
  `referenced-by` gap is an aspect the contract names. Each watched failing
  before the checks existed.
  `packages/data-core/src/drift/diff.test.ts` — a `referenced-by` gap is
  reported only between two snapshots that both record what refers to each
  table: against a base taken before this record it is no change, and
  between two that record it, one that appeared is `access-narrowed` at
  `info` (watched failing: against the base without the facts it was
  `access-narrowed`, "It could when the form was generated").
  `packages/data-fixtures/src/conformance.test.ts` — an owner that may not
  delete from a table, a snapshot that says nothing about deleting, a key
  missing from a table's `referencedBy`, one there from outside the fixture,
  one with another action, enforcement or column, and a `referenced-by` gap
  on the owner's snapshot are each a disagreement; structurally, object
  access is ignored and a `referenced-by` gap is beyond the account;
  `accessDisagreements` holds the writer to DELETE on `order` and
  `order_line` and on nothing else, and the reader to none; the restricted
  reader's rule holds `fk_order_line_order` reported right or behind a
  `referenced-by` gap. Watched failing against the comparators before they
  read the facts, but for the owner's `referenced-by` gap, which their rule
  for any gap on the owner's snapshot already refused. `rename.test.ts` — a
  column a key from outside the snapshot refers to is refused by
  `renamedColumn` rather than left to `createSnapshot`'s sentence about the
  key (watched failing with that sentence).
  `packages/data-postgres/src/discovery-access.integration.test.ts` and
  `discovery.integration.test.ts`, against `postgres:17-alpine` (17.11)
  loaded with the shared fixture — the owner may delete from every object,
  the reader from none, the writer from `order` and `order_line` only, and
  not from `sealed.inside`, whose table grant says DELETE and whose schema it
  has no USAGE on; every table's DELETE is the answer `delete … where false`
  gets, as the owner, the reader and the writer; the owner's snapshot agrees
  with the model, `referencedBy` included; a key from a schema outside the
  scope is named on `sales.order` as the owner and as the reader, with no
  USAGE on that schema, and its table is not described; a key between two
  partitioned tables is listed once, by the table it was declared on, and
  none of the two clones PostgreSQL makes on the referring table's
  partitions is, and disabling one referring partition's triggers makes it
  not enforced while a delete from the referenced table still cascades into
  that partition; a key declared onto a partition, a partition's partition
  in another schema, or a table that inherits is a `referenced-by` gap on
  the described table above it, as the owner and as the reader, and a
  delete from that table runs each key's action. Watched failing with the
  facts not assembled (13 tests), with DELETE asked as INSERT (the writer's
  `order_line`, three tests), without the USAGE check (two tests: the
  writer's `sealed.inside`), with the referring table held to the scope
  (the key from outside), with `DECLARED_FOREIGN_KEY` replaced by
  `contype = 'f'` (two clones listed), and without the keys below a table
  (no gap). Asking `has_table_privilege` by name, quoted, did not fail: the
  USAGE check before it is false for `sealed`, and the AND stops there. The
  oid stays, for the reason 0027 gives.
  `packages/data-sqlserver/src/discovery-access.integration.test.ts` and
  `discovery.integration.test.ts`, against
  `mcr.microsoft.com/mssql/server:2022-latest` (16.0.4295.3) — the same
  three accounts' DELETE, the writer's through its role, and every table's
  answer to `delete … where 1 = 0` as the owner, the writer, the reader and
  a schema viewer; the reader's `referenced-by` gap first among its exact
  gaps, with `sales.order`'s `referencedBy` empty; the same gap for a schema
  viewer, under each VIEW DEFINITION or CONTROL deny, and beside row
  security's in the policy cases; a key from another schema named on
  `sales.country` as the owner, and on `sales.order` under database VIEW
  DEFINITION with no gap, and not under VIEW DEFINITION on `sales` alone,
  where the gap says so; a disabled key is not enforced from the table it
  refers to either, and a delete there leaves the referring row as it was;
  an edge constraint that connects a node table in scope, from an edge
  table in another schema, is a `referenced-by` gap on the node, and a
  delete of a node removes the edges its CASCADE constraint connects and is
  refused 547 by a NO ACTION one. Watched failing with the facts not
  assembled (11 tests), with DELETE asked as INSERT (four), with no
  `referenced-by` gap (ten), with the referring table held to the scope
  (two), and without the edge constraints (no gap).
  `discovery/access.test.ts` — a NULL answer for an object's DELETE is
  refused naming the object (watched failing without the guard).
  `apps/studio/src/fixtures.test.ts` and `apps/examples/src/snapshot.test.ts`
  — the six captures, recaptured, are what `createSnapshot` makes and agree
  with the model and the grants (watched failing with the files captured
  before this record). `scripts/pictures` — the studio's Connect picture,
  retaken, shows the reader's new gap (`pnpm pictures --check` failed on it
  first).

## Context

A delete removes a row, and with it whatever foreign keys that refer to the
row's table do on delete: cascade, set NULL, set a default, or refuse. A
form may offer a delete only where two things can be known before
publication, and nothing in a snapshot said either:

- **Whether the account may delete.** A column's `access` said SELECT,
  INSERT and UPDATE (0027), and that record listed DELETE among what it did
  not describe.
- **What refers to the table.** A foreign key is recorded on the table it
  is on (`foreignKeys`). The keys that refer to a table are on other tables,
  some of them outside the approved schemas, which discovery never read.

SQL Server's catalog is filtered by permission (0007, 0027): a key is
listed only to an account that may see the table it is on.

Probed on 2026-10-11 against `postgres:17-alpine` (17.11) and
`mcr.microsoft.com/mssql/server:2022-latest` (16.0.4295.3), in containers
started by the fixture's own harness on a Linux host with 20 CPUs and
16 GB under Docker 29.8.1, with the fixture as committed plus DELETE on
`sales.order` and `sales.order_line` granted to `formancy_forms`; each
container was removed afterwards.

| Probe | What the server answered |
|---|---|
| P1, PostgreSQL | `has_schema_privilege(n.oid, 'USAGE') and has_table_privilege(c.oid, 'DELETE')` over every object of `sales`: the owner true everywhere, the reader false everywhere, the writer true for `order` and `order_line` only -- each the answer `delete from … where false` got (42501 where false), except the view `customer_summary`, refused 55000 (not updatable) for every account before any privilege. A role with DELETE alone runs `delete … where false`; `where id = 1`, with or without `returning id`, and `where v = 1` are refused 42501. Given SELECT on `id`, `where id = 1 returning id` runs and `returning v` and `where v = 1` are refused. DELETE alone takes `lock table only … in row exclusive mode`, `share row exclusive mode` and `access share mode`. |
| P1, SQL Server | `HAS_PERMS_BY_NAME(quotename(schema) + '.' + quotename(name), 'OBJECT', 'DELETE')`: the owner 1 everywhere, the reader 0 on `order` (the one object it sees), the writer 1 on `order` and `order_line` and 0 elsewhere -- each the answer `delete from … where 1 = 0` got (229 where 0), except the view, refused 4405 for every account. DELETE alone runs `where 1 = 0`; `where id = 1`, with or without `output deleted.id`, is refused 229. Given SELECT on `id`, `where id = 1` and `output deleted.id` run, and `output deleted.v` and `where v = 1` are refused 230. |
| P2, PostgreSQL | A table in a schema the reader and the writer have no USAGE on, with a key onto `sales."order"`: both read the key, its table's name and its column's from `pg_constraint`, `pg_class` and `pg_attribute`. |
| P2, SQL Server | The same key, from another schema: `sys.foreign_keys` lists it, and `fk_order_line_order`, to the owner, the writer and a grantee of database VIEW DEFINITION; only `fk_order_line_order` to a grantee of VIEW DEFINITION on `sales`, and to a database grantee denied VIEW DEFINITION on the other schema or on its table; neither to the reader, who may select from `sales.order` and sees no key that refers to it. |
| P2b, PostgreSQL | A key declared onto one partition of a partitioned table, or onto a table that inherits from another, is in `pg_constraint` with that partition or child as `confrelid`, and not a clone (`conparentid` 0); a delete from the parent runs its action -- a cascade emptied the referring table. Measured in review in a scratch container of the same image, and held by `discovery.integration.test.ts`. |
| P2b, SQL Server | A graph node table's edge constraints are in `sys.edge_constraints` and `sys.edge_constraint_clauses`, not `sys.foreign_keys`; a delete of a node removes the edges an ON DELETE CASCADE constraint connects and is refused 547 by a NO ACTION one. `sys.edge_constraints` lists a constraint on an edge table in another schema under VIEW DEFINITION on the database, not under VIEW DEFINITION on the node's schema. Measured in review and again in scratch containers of the same image; the delete actions are held by `discovery.integration.test.ts`. |
| P9 | data-core at `0cf7ce8`, the release before this record, given the snapshots recaptured here: the owners' and the PostgreSQL writer's are accepted, with the fingerprint they were taken with, the facts carried through, and the same form generated; the SQL Server reader's is refused, "a gap's aspect "referenced-by" is not one the contract names". |

## Decision

Discovery records, for every table and view in scope:

1. **Whether the account may DELETE from it** — `ObjectMeta.access:
   { delete }`, the database's own privilege check. PostgreSQL:
   `has_schema_privilege(n.oid, 'USAGE') and has_table_privilege(c.oid,
   'DELETE')`, by oid. SQL Server: `HAS_PERMS_BY_NAME` on the QUOTENAME'd
   object, in the objects query, where NULL is an error, as 0027 decided for
   columns. A DELETE that names a column in its WHERE, a RETURNING or an
   OUTPUT also needs SELECT on it (P1), which the column's `access` says.
2. **Every foreign key the catalog shows that refers to it, from a table in
   any schema** — `ObjectMeta.referencedBy: InboundKey[]`, each `{ table,
   name, columns, referencedColumns, onDelete, onUpdate, enforced }`, sorted
   by the referring table's schema and name and the key's name in codepoint
   order. Each adapter reads it under the conditions its referring side
   reads foreign keys by: on PostgreSQL `DECLARED_FOREIGN_KEY`, so the
   clones PostgreSQL makes on a partitioned table's partitions are not
   listed, and `TRIGGERS_ENABLED` for enforcement; on SQL Server
   `is_disabled`. A table outside the approved schemas is named there and
   nowhere else: nothing of it is read or written. A key is listed on the
   relation it names, and only there. `enforced` is the referring side's
   flag, and it does not say the same on both engines: on SQL Server a
   disabled key neither checks nor acts, so a delete leaves the rows that
   refer to the table; on PostgreSQL a key some of whose triggers are
   disabled reads not enforced, and when those are the referring table's
   checks a delete still acts through it. Nothing may read `enforced: false`
   as a key a delete does not reach through.
3. **One fact, made in one place (0004).** A key between two tables of a
   snapshot is in the referring table's `foreignKeys` and the referenced
   table's `referencedBy`, and `createSnapshot` refuses a snapshot where the
   two ends disagree, or where either is missing.
4. **When a snapshot may show only part of what refers to a table, a gap of
   a new aspect, `referenced-by`.** On SQL Server, by 0027's rule for
   row security, held in one function (`unseenDefinitions`) both read: the
   lists are complete only with VIEW DEFINITION on the database and no VIEW
   DEFINITION or CONTROL deny on any object or schema binding the account;
   otherwise one gap on the scope says why, when some object is described.
   On PostgreSQL `pg_catalog` answers every role (P2), so nothing is hidden
   from the account. On both engines, what a delete reaches through
   something this release does not list is a gap on the table, one per
   thing, naming it (P2b): on PostgreSQL a declared key that names one of
   the table's partitions, at any depth and in any schema, or a table that
   inherits from it; on SQL Server an edge constraint that connects a node
   table, whatever its delete action, since NO ACTION refuses a delete as a
   no-action key does and those are listed.
5. **Both facts are optional in the contract, and absent together.** A
   snapshot taken before this record has neither on any object, and
   validates with the fingerprint it was stored with (0019); one taken since
   has both on every object. One without the other, or a mix, is refused.
   Drift review compares a `referenced-by` gap only between two snapshots
   that both record the facts: a base without them never looked.

The fixture's `formancy_forms`, the order form's role, and so the composed
stack's writer, gains DELETE on `sales."order"` and `sales.order_line` on
both engines -- order_line because a delete of an order cascades into it,
and a delete that reaches a table is to be held to DELETE on it. The reader
keeps none. `WRITER_ACCESS` says so, and the comparators derive each table's
`referencedBy` from the model's foreign keys rather than writing it twice:
every key of the fixture is on a table in `sales`.

## Consequences

**What it buys.** Before anything deletes, a snapshot says whether its
account could, and what a delete of a row would do to other tables -- in or
out of the approved schemas -- or that it cannot tell. A delete can be
offered only where it can be made, and its reach reviewed, accepted and
compared in drift, from a fact recorded on the table itself.

**What it costs.**

- PostgreSQL discovery reads three more catalog queries: DELETE per
  relation, the keys onto each, and the keys onto what is below each. SQL
  Server reads two more, the keys onto each table and the edge constraints
  that connect one, and asks DELETE in the objects query. Neither is
  measured.
- A fresh snapshot hashes differently from one taken before this record, so
  drift review walks every family for a form published before it, where it
  took the fingerprint's fast path, until the form is republished from a
  fresh discovery. Against an unchanged database it still reports nothing
  (`drift/diff.test.ts`).
- Every captured snapshot was recaptured: the studio's five and the
  examples'. The studio's Connect step shows the SQL Server reader one gap
  more, and its README picture was retaken.
- A SQL Server account without database VIEW DEFINITION, or with a VIEW
  DEFINITION or CONTROL deny on any object or schema, gets a
  `referenced-by` gap, under the conditions that keep it from establishing
  row security: it cannot establish that it sees every key, whether or not
  one is hidden.
- A PostgreSQL table with a key onto one of its partitions or onto a table
  that inherits from it, and a SQL Server node table an edge constraint
  connects, carries a `referenced-by` gap for every account, the owner's
  included: what a delete of it reaches is "cannot tell" until a later
  record lists such keys.
- A table outside the approved schemas is named in a snapshot when its key
  refers to one in scope: its schema, its name, its key's name and columns.
- The fixture's writer, and the composed stack's, may delete orders and
  order lines.
- A server from before this record refuses a snapshot with a
  `referenced-by` gap (P9), and with it a bundle published from one, on
  every read (0019). It accepts one without, with its fingerprint.

**What it does not do.** It offers no delete: the generator, the policy, the
planner and the runtime plane are unchanged, and nothing decides by
`access.delete` or `referencedBy` yet; drift review only asks whether a
snapshot records them, to compare a `referenced-by` gap. Triggers and
rules that run on a delete are not recorded. REFERENCES and EXECUTE are
still not described. A key onto a partition or an inheriting table, and an
edge constraint, are not listed, only said by a gap; the record that offers
delete, if it guards the statement against a key added after publication,
has to look below the table as this record does, or its guard is short
where the snapshot says so.

**Forecloses:** nothing.

## Alternatives considered

**No privilege fact; let the database refuse at runtime.** Lost: a form
would offer a delete its account cannot make, and every attempt would be a
`permission-denied` nobody could have seen before publication -- 0027's
reason for column access, again.

**Required facts, as 0027 made column `access`.** Lost: every published
bundle would be refused on read (0019) until republished, for facts nothing
reads yet.

**Only the keys of tables in scope.** Lost: a key from another schema
cascades all the same, and a delete reviewed against in-scope keys would
reach a table nobody saw.

**A gap per object, or none on SQL Server when the referring table's schema
is visible.** Lost: a key on a table the account cannot see may refer to any
table in scope, and nothing places it (P2), exactly as for a security
policy.

**Write `referencedBy` into the fixture model by hand.** Lost: the model's
foreign keys already say every key, and a second list could disagree with
them unnoticed; derived, it cannot.

**List a key onto a partition, or onto an inheriting table, on the table
above it.** Lost here: an inbound key names the relation its key refers to,
and `createSnapshot` holds a key between two described tables alike at both
ends, so listed on the parent it would say it refers to a table it does
not, and the contract would need a field naming the relation below. A gap
says what is missing without that, and a later record can list it.

**A gap only for an edge constraint that cascades.** Lost: NO ACTION
refuses a delete of a node while an edge connects it (547), as a no-action
foreign key does, and `referencedBy` lists those so that review can say a
delete may be refused.

**Record triggers and rules too.** Lost here, and for the record that
offers delete to decide: a trigger is code, and the catalog says that it
fires, not what it does.

## Older records

Extended, not edited away: 0004 (a new aspect, `referenced-by`, and in
the fingerprint whether the account may delete from each object and what
refers to it); 0010, narrowed (a `referenced-by` gap is compared only
between two snapshots that both record the facts: against a base taken
before this record it is no change, where 0010's table says a new gap
stops what it puts in doubt); 0005 (the fixture's writer may delete orders
and their lines, and the comparators hold each table's `referencedBy` to the
model's keys and the accounts' DELETE to `READER_ACCESS` and
`WRITER_ACCESS`); 0006 (PostgreSQL discovery reads DELETE by oid and every
declared key onto a table in scope, from any schema, with no gap for what
the account cannot see, and a `referenced-by` gap for a key onto a
partition or an inheriting table below one); 0007 (SQL Server discovery
reads DELETE in the objects query and every key it can see onto a table in
scope, and says by a `referenced-by` gap when it may not see them all, and
by one on a node table for each edge constraint that connects it); and
0027 (one more capability, on the object, and
the gap rule for row security shared with what refers to a table, so the
two cannot disagree; its "DELETE, REFERENCES and EXECUTE are not described"
is now REFERENCES and EXECUTE).
