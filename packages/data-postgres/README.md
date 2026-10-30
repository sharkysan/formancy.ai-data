<!-- Part of Formancy Data: https://github.com/sharkysan/formancy.ai-data -->

# @formancy/data-postgres

The PostgreSQL adapter for Formancy Data, behind the port
`@formancy/data-core` defines. Built on [`postgres`](https://github.com/porsager/postgres),
the same driver `@formancy/server` uses upstream.

## What is here today

An adapter that reaches a real server and says which version answered,
discovery of the schemas an administrator approved, and both halves of the
operations port: lookups and records.

```ts
import { connectPostgres, createPostgresAdapter, createPostgresLookups, createPostgresRecords } from '@formancy/data-postgres'

const sql = connectPostgres({ host, port, database, user, password, tls: { enabled: true, rejectUnauthorized: true } })
const adapter = createPostgresAdapter(sql)
await adapter.ping() // { kind: 'postgres', version: '17.6', product: 'postgresql', major: 17 }

const snapshot = await adapter.discover({ schemas: ['sales'] })
snapshot.account // { user, login }: current_user and session_user
snapshot.objects // tables and views, with columns, keys, foreign keys, checks, comments,
//                  what the account may do with each column, and whether row security applies to it
snapshot.gaps // what this release could not describe: a foreign table
snapshot.fingerprint // changes when the structure, the account's privileges, or the account changes

// Lookups on a client of their own, which no record statement uses (0061, below).
const lookupSql = connectPostgres({ host, port, database, user, password, tls: { enabled: true, rejectUnauthorized: true }, applicationName: 'formancy-data lookups' })
const lookups = createPostgresLookups(lookupSql) // LookupAdapter: search, resolve, rejects, each with the caller's signal
const records = createPostgresRecords(sql) // RecordAdapter: describe, read, list, insert, update, delete
await adapter.close()
```

Each takes a connected driver rather than a connection string: opening the
connection is where a secret is handled, and that happens once, in the
composition root. Nothing in this package reads configuration, and nothing
assumes how the driver was configured (below). `discoverPostgres(sql, scope)`
is the same discovery as a function of its own.

`adapter.close()` ends the driver it was given, and gives a statement still
running five seconds to answer before it destroys the connections. Unbounded,
it never returned once a connection had been cut in the middle of a
statement: postgres.js 3.4.9, as observed on 2026-10-09, keeps that
statement as the connection's current one, and `end()` waits for it. A
statement destroyed by the bound is told CONNECTION_DESTROYED, which is
`unknown-outcome` for a write. Five is a choice, half of `docker stop`'s
default grace, not a measurement.

`connectPostgres` opens the client from this package's own copy of
postgres.js, and is how `@formancy/data-server` opens every connection: a
driver object built by one copy of a driver and used by another is a defect no
unit test sees
([0025](../../docs/decisions/0025-each-adapter-owns-its-driver.md)). A client
built elsewhere still works, as long as it is the same copy.

### Lookups and records: what the server converts, and what the driver never touches

[0016](../../docs/decisions/0016-postgres-operations.md) has the reasoning;
in short:

- **Values are read as text the server wrote, by position.** Every column is
  converted in SQL to the text `codecFor(column).parse` would return: a
  decimal padded to its scale, a `bigint` as its digits, a date as
  `YYYY-MM-DD` from `to_char`, an instant as `YYYY-MM-DDTHH:MM:SSZ` in UTC, a
  zoneless timestamp as `YYYY-MM-DDTHH:MM:SS` with its fraction, trailing
  zeros dropped, a time as `HH:MM`, a float from its IEEE 754 bits, a `real`
  then given the canonical value `canonicalFloat32` names (`0.1`, not
  `0.10000000149011612`). The last two are the spellings SQL Server's adapter
  gives too ([0026](../../docs/decisions/0026-name-every-column-fact-the-engines-disagree-on.md)),
  held by the shared fixture's `sales.shipment` rows. Rows are read with `raw()`,
  so neither the driver's parsers nor its `transform` option (which renames
  columns and rewrites values, text included) is involved, and neither
  DateStyle, TimeZone nor `extra_float_digits` changes a value.
- **A statement's rows are collected as the driver reads them**, with
  postgres.js's `forEach`, never taken from the array it resolves with
  ([0078](../../docs/decisions/0078-a-postgresql-statements-rows-are-collected-as-the-driver-reads-them.md)).
  postgres.js 3.4.9 places each row in that array at an index it counts per
  connection and resets only when a statement completes, so after a
  statement that ended part-way -- a lookup its cancel stopped while its
  rows were on their way, or a statement failing in a later row -- the next
  one's rows came after that many empty slots: a search or a resolve threw,
  and a record read of one row counted more than one
  (porsager/postgres#1119, #1253). The slots held nothing of the earlier
  statement. Discovery's catalog reads still take the driver's array.
- **An instant is read to the second and a time to the minute, as SQL Server
  reads them**
  ([0040](../../docs/decisions/0040-instants-and-times-are-read-to-the-shape-and-an-unedited-one-is-never-written.md)).
  A fraction — anything `now()` wrote — and a time's seconds are cut, never
  rounded: `12:34:56.789012+02` reads `2026-10-08T10:34:56Z`, `10:30:59.999999`
  reads `10:30`. `planUpdate` in `@formancy/data-core`, given the record as
  read, removes an unedited echo of either from an update and refuses to
  plan one without that read, so a save planned by it never writes the
  stored fraction and seconds over; a caller that builds an update request
  itself must set only the fields a person changed. What no shape can name
  is read in a spelling the codec refuses, never cut and never NULL: an
  infinite or BC date or instant as `infinity` or `0044-03-15 BC`, a
  five-digit year with its era, `24:00:00` as `24:00`, a NaN as `NaN`.
  Neither renderer submits such a record until the value is changed; sent
  back unedited, an instant or a time of these is an echo the planner
  removes and keeps, and a date or a number is refused by the codec.
- **Values are bound as text and converted by the server.** Every parameter
  is `$n::pg_catalog.text`, then cast to the column's exact type. postgres.js
  would otherwise serialise an untyped parameter through its serializer for
  the type the server inferred, and its boolean serializer turns the text
  `'true'` into false. A row filter term carries its column's type, so it is
  bound the same way.
- **A row filter compares the canonical value exactly**
  ([0028](../../docs/decisions/0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md)):
  case, accents and trailing spaces all count, and the column's collation is
  not consulted. Text is compared twice from one parameter — `"c" = $n::text`
  (`::bpchar` for `char(n)`) in the column's own type and collation, which
  keeps its index, and `("c"::text collate "C") = ($n::text collate "C")`,
  which is exact; the collation and `bpchar` are named in `pg_catalog`, and
  the parity suite plants a case-blind `public."C"` and a `public.bpchar` to
  hold that. On the parity schema, sized so that a scan would show, the
  lookup reads `pk_tenant_item` with the first as its index condition and the
  second as a filter, which `parity.integration.test.ts` reads from EXPLAIN.
  A `numeric` with no scale — PostgreSQL's alone — keeps the scale each value
  was given, and numeric equality calls `12.5` and `12.50` equal, so it is
  compared twice too: as a number, and as its text under `"C"`.
  Before, a term was a parameter declared `unknown`, compared in the
  column's collation: under a case-insensitive one, tenant `acme` read
  `ACME`'s rows.
  A boolean, float, time or timestamp filter, and a value not spelled as the
  column holds it (`'042'`, `'AB '` for `char(3)`), is thrown before
  anything is sent.
- **A label is spelled once, in the core.** A display column is read by the
  record reader above and decoded by its type, and `displayText` spells it:
  `true`, an instant in UTC to the second, a time to the minute. Not
  `to_jsonb`, which this used before and which follows the session's
  TimeZone and `extra_float_digits`.
- **Every name is PostgreSQL's own.** Each function, operator
  (`operator(pg_catalog.=)`), type and collation the SQL names is qualified
  with `pg_catalog`, so nothing a role creates in a schema on the search
  path — `public`, for every login role up to PostgreSQL 14 — can stand in
  for it, whether the composition root's `search_path` names pg_catalog
  first or last. Without it a planted `=(bigint, numeric)` let a stale write
  through and a planted `jsonb_populate_record` crossed the tenant filter.
- **Identifiers are quoted one part at a time**, never with the driver's
  `sql(name)`, which splits on dots. A name over 63 bytes is refused: the
  server would truncate it and address another table.
- **The search is literal**: `ILIKE` with `%`, `_` and the escape character
  escaped, over the configured search columns only — text as itself, an
  integer as its digits — through the database's
  default collation — PostgreSQL 17 refuses ILIKE on a nondeterministic
  collation outright. It folds case as that collation does and **does not fold
  accents**: `uber` does not find `Über`, where formancy's own narrowing would.
- **A person's filter is spelled as a row filter and a search are**
  ([0104](../../docs/decisions/0104-a-list-and-a-browse-are-filtered-by-conditions-on-their-columns.md)). Each condition of a list's or a browse's `filter` is one more
  conjunct of the page's WHERE, beside the parent, the row filters, the
  throughs and the search (`records/filter.ts`). An equals on text, an
  integer, a decimal, a uuid or a date is a row filter's comparison above,
  so it is exact under any collation, the parity schema's nondeterministic
  one included; on a boolean it is the column's equality with
  `$n::text::bool`. A contains is the search's ILIKE through the default
  collation, so it runs on a column PostgreSQL refuses LIKE on. `null` and
  `not-null` are `is null` and `is not null`, and text of no characters is a
  value. A range's `from`, `to` and `before` are `>=`, `<=` and `<`,
  pg_catalog's operators, against a bound cast to the column's own type,
  so an index on the column can serve it; its plan is not measured. A
  timestamp's bounds are midnights, an instant's ending in `Z` and cast to
  `timestamptz`, a zoneless one cast to `timestamp`, each written year
  first: neither TimeZone nor DateStyle moves a day, which the list suite
  holds in a session on Pacific/Chatham with `SQL, DMY`.
- **The order is the config's**, NULL placement spelled for every column. Text
  sorts in the column's collation; on `postgres:17-alpine`, whose libc is
  musl, as observed on 2026-10-09, the default `en_US.utf8` orders by code
  point, exactly like `"C"`.
- **A key with a NULL is never offered**, and a key too long for a token is
  counted in `omitted`. Membership is decided from the keys as the rows hold
  them, so a case-insensitive collation or `char(n)` padding cannot admit a
  token the lookup never offered.
- **An update is one statement**: key, filters, every through and expected
  version in one WHERE, the version column incremented in the same SET. Zero
  rows, or 40001 under REPEATABLE READ, is followed by one read that tells
  `stale` from `not-found`, inside the same filters and throughs, so another
  tenant's record is `not-found` too, whatever version was sent. A through
  ([0043](../../docs/decisions/0043-a-child-forms-rows-are-reached-only-through-a-parent-its-policy-admits.md))
  is `exists (select from <target> as "p" where "p".<key>
  operator(pg_catalog.=) "r".<foreign key> and <filters on "p">)`, in the
  read too, every column qualified; its plan is not measured. Under
  concurrency it is weaker than a row filter: the parent is read from the
  statement's snapshot, so an update that waited for its row is written
  though another transaction moved the parent out of the scope and
  committed during the wait, under READ COMMITTED and REPEATABLE READ,
  where a row filter on the record is checked again and SQL Server answers
  `not-found` (the shared case `through: moved-parent`). A record still at
  the version sent was declined by the
  database itself — a BEFORE trigger returning NULL, a rule, a row security
  policy — and is `refused`, not `stale`; so is an insert the server
  completed as `INSERT 0 0`.
- **Errors are values.** By SQLSTATE: 23505 and 23P01 `unique-violation`,
  23503 and 23001 `foreign-key-violation`, 23502 `not-null-violation`, other class 23
  `check-violation`, 22001 and 54000 `too-long`, other class 22
  `out-of-range`, 42501 `permission-denied`, a missing table or column, one
  whose type changed, or a generated column named in a write (428C9)
  `schema-changed`. What passes is `unavailable`, an allowlist: classes 08,
  40, 53, 57, 58 and 28, and 55P03, 55006, 25006 and 3D000. The suites
  provoke 40P01, 57014, 55P03 and 25006; the rest are by PostgreSQL's
  documentation. Of class 57 only 57014, a cancelled or timed-out statement,
  arrives as a SQLSTATE: a terminated backend, a shutdown and a
  `transaction_timeout` (25P04) are FATAL, close the connection, and reach
  the adapter as postgres.js's CONNECTION_CLOSED — `unknown-outcome` for a
  write, as the parity suite shows by terminating one mid-write. Anything else the server refuses — a trigger's `RAISE`, an
  error code only a function knows (38000) — is `refused`: it certainly rolled
  back, and the same request will be refused again. A connection that fails
  before a statement is sent is `unavailable`; after a write was sent it is
  `unknown-outcome` — the tests show such a write committing after the client
  gave up — and it is never retried. A malformed request, filters that say
  nothing, or a syntax error in this adapter's own SQL is thrown.

### Every write holds the table to the definition it was decided over

[0041](../../docs/decisions/0041-the-runtime-refuses-what-drift-blocks.md).
`describe(table)` reads the root's definition in one statement, and every
read returns it from the statement that read the record. The facts are one
jsonb of what no session setting changes -- the relation's kind and oid,
each column's attnum, name, type oid, typmod, type name and schema, NOT
NULL, identity and generation flags and stored default tree (`adbin`), the
keys and the foreign keys with their actions, validation and trigger state
-- read by discovery's own conditions (`DESCRIBED_RELATION`,
`DECLARED_COLUMN`, `KEY_CONSTRAINT`, `UNIQUE_INDEX_KEY`,
`DECLARED_FOREIGN_KEY`, `TRIGGERS_ENABLED`) and made metadata by discovery's
own functions, the kind through `kindOf`. The oid is what tells a table
dropped and created again under the same definition from the one a write
was decided over. The definition is their SHA-256, with the isolation they
were read under.
`format_type` and `pg_get_expr`, which follow `search_path` and DateStyle,
travel beside the facts for the description and are never digested: the
digest was the same under every setting 0016's suites vary (the settings
test). A describe and a read compute the facts once, in a derived table the
planner is kept from pulling up (`offset 0`), and digest that one text:
pulled up, the walk was planned and run twice, eleven scans of pg_attribute
where six, which the definition suite counts.

- **What it costs.** Measured on 2026-10-10 outside the suites, on one
  shared machine against `postgres:17-alpine`: a describe or a read takes
  4.3 to 6.2 ms of the server's planning and execution where the read
  without the description took 0.14 to 0.17 ms, a guarded write 3.3 to 5
  ms where it took 0.14 to 0.25 ms, more than half of it planning, which
  an unnamed statement does every time
  ([0041](../../docs/decisions/0041-the-runtime-refuses-what-drift-blocks.md)
  has the method).

- **Under READ COMMITTED**, which takes a statement's snapshot after the
  table's lock, an update's one WHERE gains the digest and a requirement
  that the connection's isolation is read committed, and an insert is
  `insert … select … where` the same. A write that wrote nothing, or failed
  -- a value the moved column refuses fails while the statement is planned,
  before its WHERE runs -- asks the definition in one more statement, which
  answers `schema-changed` when it moved and `unavailable` when this
  connection's isolation is not read committed, before `not-found`,
  `stale` or the failure. That statement runs on any connection of the
  pool: a reserved one never answers once its backend is gone, and
  postgres.js 3.4.9 then throws outside any promise (measured).
- **Under another isolation**, whose statements take their snapshot before
  they wait for the lock, a read that reports one is set aside and asked
  again in a transaction that takes `access share` first, and a write
  decided over such a definition runs in one that takes `row exclusive`
  first; `LOCK` takes no snapshot, so the statement's follows it. Counted
  on this adapter on 2026-10-10: a read is then seven round trips and a
  write five, where both are two under READ COMMITTED. A describe, which
  has no guard, takes no lock. An account granted columns of the table and
  nothing on the table is refused the lock, `permission-denied`.
- **The lock-first transaction is kept from settling once its connection is
  lost.** postgres.js 3.4.9 rejects `sql.begin` when the transaction's
  connection closes and then writes its ROLLBACK or COMMIT to the closed
  connection: a TypeError outside any promise, which ends the process, and
  a pool whose next query never answers (measured). Every step inside the
  transaction therefore never settles on a lost connection, so nothing more
  is sent, and `begin`'s rejection is the answer: `unknown-outcome` once the
  write was sent, `unavailable` before. Each step waits on a promise of its
  own that nothing holds, so the abandoned transaction is collected; one
  promise shared by every lost step kept their values for the life of the
  process. `records-lost-answer` holds all three.
- **A refused write still fires the table's statement-level triggers**, and
  in autocommit what they did is kept.

### A delete

`records.delete(request)` deletes one record in one statement on 0041's
paths
([0050](../../docs/decisions/0050-a-record-is-deleted-one-at-a-time-by-its-token-and-the-version-its-person-read.md)):
a CTE that deletes the row its key, the filters and every through locate,
at the version sent, while the definition holds, no declared foreign key
that cascades, sets NULL or sets a default refers to the table or to a
relation below it -- a partition, a table that inherits from it -- read
whether or not its triggers are enabled, and no rule acts on a delete from
the table; selected with a scalar subquery over its own rows, so a second
row fails the statement (21000) and nothing is deleted, which the adapter
throws. On the locked path, under an isolation other than READ COMMITTED,
the transaction first locks the table with every relation below it: the
statement takes its snapshot before it locks the partitions it plans, and
a key added onto a partition while it waited would otherwise act unseen.
After no row, one statement tells a moved definition or reach
(`schema-changed`), a rule (`refused`), another isolation (`unavailable`),
not found, stale, and a row found at the version sent -- a BEFORE DELETE
trigger that returned NULL, a row security policy for DELETE stricter than
the one for SELECT -- `refused`. A foreign key's refusal is 23503 under
NO ACTION, and under RESTRICT on 15 to 17; 18 refuses RESTRICT with 23001,
`restrict_violation`, and both are `foreign-key-violation` with the key
named (`VERSION_FACTS.restrictViolation`). A table a rule acts on
refuses every delete: PostgreSQL itself refuses the CTE (0A000) under a DO
ALSO rule, a DO INSTEAD NOTHING rule, and a DO INSTEAD rule without
RETURNING or with several actions, and the statement's own guard refuses
the one it would run, an unconditional DO INSTEAD rule that returns a row,
whose action would otherwise be answered as the deletion.
`delete.integration.test.ts` holds every case `DELETE_PARITY` names, a DO
ALSO and a DO INSTEAD rule, and a key onto a partition on both paths.

A delete that reaches past its record, through the keys its policy names in
`cascades` ([0051](../../docs/decisions/0051-a-delete-reaches-other-tables-only-through-foreign-keys-the-policy-names.md)), takes the locked path whatever the isolation: `begin`,
one `lock table` of every table it removes rows of or clears, in codepoint
order, ROW EXCLUSIVE and with every relation below each, the statement,
`commit`. The lock is what lets the guard see every key onto the reach --
a cascade opens each table only after the statement's snapshot. It is
refused (42501, `permission-denied`) to an account with no grant to write
one of those tables, but any grant to write takes it, INSERT or UPDATE as
well as DELETE, and the cascade itself runs as the referring table's owner
and asks the account nothing; so the statement asks `has_table_privilege`
for DELETE on every table past the root, under the lock, and deletes
nothing where one is refused, which the follow-up answers
`permission-denied`. The guard accepts exactly the keys the request names,
by the table each is on, its name, the table it refers to and its action,
and refuses a key that follows a cleared column by an ON UPDATE that acts.
A cascaded table's BEFORE DELETE triggers and its rules run as that table's
owner; its AFTER DELETE triggers run as the deleting account on 15 to 17,
and as the owner on 18, which runs an AFTER trigger as the role that queued
it. So a delete whose cascaded table's AFTER trigger writes where only the
owner may is `permission-denied` on 15 to 17 and done on 18
(`VERSION_FACTS.afterTriggerAsQueuer`); this module governs neither.
`cascade.integration.test.ts` holds every case `CASCADE_PARITY` names but
`lost-answer`, which `records-lost-answer.integration.test.ts` holds.

### What a lookup reads

[0034](../../docs/decisions/0034-performance-is-measured-through-the-shipped-server-and-held-without-a-clock.md)
holds this without a clock, on the sized `sales.customer` of
`@formancy/data-fixtures`: `lookups-sized.integration.test.ts` captures the
statement the adapter actually sent, through postgres.js's `debug` hook, and
replays it under `EXPLAIN (ANALYZE)` as the writer. The counts it pins are
`sizedRowsRead()` of `@formancy/data-fixtures`, which the SQL Server suite
and the performance page read too. What it pins:

- **Rows sent.** A search asks for the page and one more row, `limit …
  offset` in SQL, and `lookups.ts` trims to the page: the server never
  receives more.
- **Rows read.** With the order form's tenant row filter, `tenant_id = $n`
  is an index condition on `pk_customer`, so a search reads exactly that
  tenant's rows -- and every one of them, for every search and for the first
  page, because a leading-wildcard `~~*` and an order by `name` have no
  index to use. On a form with no tenant row filter it reads the whole
  table: row-level security's predicate, `current_user <> … or tenant_id =
  1`, is not an index condition. A resolve and the membership check read at
  most one row per key, through `pk_customer`.
- **What the plans were** (P3, P9; 2026-10-09, PostgreSQL 17.11 on musl, a
  Docker Sandbox VM on a Windows 11 workstation): a tenant's search is a
  Bitmap Heap Scan over a Bitmap Index Scan of `pk_customer` on
  `tenant_id`, parallel under the default settings; an unfiltered search is
  a sequential scan, parallel too. JIT never fired: no plan cost reached
  `jit_above_cost`. The searches' exact counts come from a session with
  parallel workers off, where each search's scan runs once; under the
  defaults the test holds the plan shape and the count within PostgreSQL
  17's per-loop rounding. A resolve probes the index once per key, so its
  scan runs once per key in either session, and resolving 100 keys or one
  and checking one are held to at most a row per key in both.
- **What an index would change** (P5, an index on `(tenant_id, name,
  customer_no)` created and dropped by the probe, never shipped): the first
  page and a search many customers match become an ordered index-only scan
  that stops early; a search that matches one customer or none still reads
  the whole tenant, and an unfiltered search the whole table.

Every statement is two round trips: `sql.unsafe` sends an unprepared
statement with parameters as Parse, Describe and Flush, waits for the
server's description of the parameters, then binds and executes. The
measurement's counting pass counts it through a TCP hop on every run, and
[`docs/performance.md`](../../docs/performance.md) has the figures.

A page of records deep in key order is held the same way (0108): tenant
1's page after its 50,001st customer reads 52 rows of the table, an Index
Only Scan of `pk_customer` finding the row it continues after and an Index
Scan from that row for the page and its extra row, where the same request
at an offset of 50,001 reads 50,052; serially, the counts `sizedListPage()`
of `@formancy/data-fixtures`, which the SQL Server suite pins too. Measured
on 2026-10-30; a count, not a time.

### When a lookup is abandoned, or its deadline passes

[0061](../../docs/decisions/0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md)
has the decision; the server aborts a lookup's signal when the browser
abandons the request or the lookup deadline passes. What this adapter does
with it, in `lookups/cancel.ts`:

- **The statement is stopped in the database.** The method rejects with the
  signal's own reason at once, never translated, and postgres.js sends
  PostgreSQL a cancel request for the statement, on a connection of its own.
  An already-aborted signal sends nothing. Nothing is added to a lookup that
  completes: no transaction, no `SET`, no `statement_timeout`, so it is still
  two round trips and answers exactly as before.
- **Only a statement the driver has sent is cancelled.** postgres.js 3.4.9
  loses a pooled connection to a query cancelled before it was sent -- in the
  microtask after the query is first awaited, or while the connection it
  will run on is being opened: the next lookup on a pool of one never
  answered. Nothing public tells a query waiting in the pool's queue, which
  would be safe to cancel, from one a connection is being opened for. So the
  adapter cancels once the driver has sent the statement, which postgres.js
  marks only by setting the query's `state`; this reads that property and
  watches it on a query not yet sent. A lookup abandoned while it waited for
  a connection is therefore still sent, and then stopped.
- **And cancelled again once its execute is sent.** postgres.js has
  PostgreSQL parse and describe every lookup before it sends its parameters
  and execute, and in between the backend waits for the client: PostgreSQL
  drops a cancel request that arrives then, and the scan starts after it and
  runs to its end. A cancel sent with the statement stops one that waits in
  its parse, for a lock; over a network it can arrive in that wait instead
  (10 of 10 with answers held 5 or 20 ms, 2026-10-15 review). So a statement
  still unsettled once its execute is written is sent a second cancel
  request, which postgres.js marks only by clearing the query's
  `describeFirst`. The cost: when the first cancel also stopped the
  execute, the second can arrive after it and stop the next lookup on that
  backend, which then runs once more (below); and when both arrive after
  the statement ended, the first stops the next lookup and the second its
  one run more, and that lookup is refused.
- **A cancel request that fails stops nothing, and is not an error.**
  postgres.js reports a cancel's own connection failing -- a database that
  stopped accepting while its open sessions still answer -- on a promise
  `query.cancel()` never returns, and Node ends the process on it. The
  adapter calls the driver's canceller itself and handles that promise; the
  statement then finishes as it would have.
- **A client of the lookups' own.** PostgreSQL stops whatever a backend runs
  when a cancel arrives, so a cancel that arrives after its own statement
  finished stops the next statement on that backend. `createPostgresLookups`
  must be given a client no record statement uses, which the server opens with
  `connectPostgres({ …, applicationName })` so the two tell apart in
  `pg_stat_activity`. There a late cancel can stop only another lookup, which
  fails with 57014 while its own signal has not aborted and is run once more;
  a second such failure is thrown. That is not 0015's retry: a lookup is a
  read, the same statement under the same filters. An operator's role-level
  `statement_timeout` ends in 57014 too, so a lookup it stops runs twice.
- **The connection comes back when the driver settles the statement,** as for
  every other, so a cancelled statement still on its way out holds it.

Measured on 2026-10-14 by a throwaway copy of `lookups-limits.integration.test.ts`
on a Windows 11 workstation (Intel i9-10900K, Docker 28.3.3, Node 24.21.0)
against `postgres:17-alpine` (17.11) through the fixtures' TCP hop, with a
search, a resolve or a rejects waiting on a table lock, n=30: the method
rejected 0.15 / 0.20 / 0.65 ms (min / median / max) after the abort, and
`pg_locks` stopped counting the statement 4.00 / 4.54 / 5.67 ms after it,
read by polling from a second connection whose own round trip took a median
of 0.60 ms. A deadline of 200 ms (`AbortSignal.timeout`, n=10) rejected after
203.6 to 215.6 ms and the statement was gone by 208.2 to 219.2 ms. One
machine's figures, which say how the mechanism behaves, not what a
deployment's lookups cost.

What postgres.js does when a connection goes, characterised in the same
suite because a lookup meets it: a backend an operator ends with
`pg_terminate_backend` fails its running statement as CONNECTION_CLOSED, and
the driver gives the FATAL it kept to the first statement on the connection
it opens next, unsent; the one after that answers.

### An answer lost after a write

[0031](../../docs/decisions/0031-an-answer-lost-after-a-write-is-unknown.md)
has the whole chain, from this adapter to the host page. What PostgreSQL does,
proved through the shared TCP hop from `@formancy/data-fixtures`, which drops
the server's answer after it was sent:

- **A write that committed and whose answer was lost is `unknown-outcome`,**
  CONNECTION_CLOSED from postgres.js. The insert was sent once, at the wire,
  and exactly one row exists; an update's change is stored and its version
  moved by exactly one.
- **A refusal at commit follows the rows.** A deferred constraint is checked
  when the implicit transaction commits, after the statement's row and its
  command tag have been sent. The adapter answers the refusal —
  `unique-violation` naming the constraint — and nothing is stored. So the
  row coming back is not proof of a commit: a test that sees it, and cuts,
  has to look for the row from a connection of its own first.
- **A write cut while it waits can still commit** once the lock is released:
  with `client_connection_check_interval` at its default of 0, the server
  does not look for a client that has gone while a statement waits. It is
  `unknown-outcome`, and it does commit. A write cut while the server is
  still parsing it writes nothing and is `unknown-outcome` all the same, and
  so is a backend terminated mid-write (the parity suite). Those over-report;
  the adapter cannot tell them apart.
- **A `statement_timeout` is the server's own answer:** 57014, rolled back,
  `unavailable` — while the statement runs and while it waits on a lock.

Measured once, on 2026-10-09 for 0031, and not held by a test here: a pooled
connection given a statement within about a millisecond of a network drop
fails CONNECTION_CLOSED, before the pool has seen the close; from 10 ms on,
the pool had reconnected. A write sent in that window is reported
`unknown-outcome` though nothing reached the server.

### Discovery reads pg_catalog, as the account the forms will run as

`information_schema` is filtered by privilege: an account that may only
`SELECT` from a table sees none of that table's constraints in it. Discovery
reads `pg_catalog` instead, which every role can read whole
([0006](../../docs/decisions/0006-postgres-discovery-reads-pg-catalog.md)),
and asks the server what the connecting account may do
([0027](../../docs/decisions/0027-a-snapshot-says-what-its-account-may-do.md)):

- **Every table and view in scope is described**, the ones the account may
  not use included. A column says whether the account may `SELECT` it, name
  it in an `INSERT`, and name it in an `UPDATE`'s `SET`, as
  `has_column_privilege` answers — the table's grant, the column's, `PUBLIC`
  and inherited roles all counted — and each is false without `USAGE` on the
  schema, which every statement needs. A membership granted `WITH INHERIT
  FALSE` counts as nothing, as it does for every statement this module runs:
  it never issues `SET ROLE`.
- **Row security** is `applies` when `row_security_active` says so for this
  account — RLS enabled, and the account neither a superuser, nor a
  `BYPASSRLS` role, nor the owner of a table without `FORCE ROW LEVEL
  SECURITY` — and `none` otherwise. It needs no privilege on the table, so it
  is never `unknown` here. Which rows a policy allows is not described, and a
  view is not followed to its tables: a view owned by a superuser reads past
  their policies, a `security_invoker` one does not.
- **The account** is `current_user`, the principal privileges and policies
  are evaluated for, and `session_user`, who logged in. They differ under a
  session role (postgres.js `connection: { role }`), and only the first is
  in the fingerprint.
- A foreign key keeps its target even when the account cannot use the
  target: PostgreSQL's catalog names it, so a target is never unknown here.
- **Deleting** ([0049](../../docs/decisions/0049-a-snapshot-says-whether-its-account-may-delete-and-what-refers-to-each-table.md)):
  each table and view says whether the account may `DELETE` from it, as
  `has_table_privilege` answers, ANDed with `USAGE` on the schema, and lists
  every declared foreign key that refers to it — from a table in any schema,
  which is named and not described — read under the same two conditions as
  the referring side's keys, so a partition's clones are not listed. Every
  role reads every such key, so nothing is hidden from the account. A key
  is listed on the relation it names; one declared onto a partition of a
  table, at any depth and in any schema, or onto a table that inherits
  from it, is a `referenced-by` gap on that table instead, because a
  delete from it reaches those rows and fires the key. `enforced: false`
  on such a key says some trigger of it is disabled, which may be the
  referring table's checks alone: a delete still acts through it then. A
  `DELETE` that names a column in its `WHERE` or `RETURNING` also needs
  `SELECT` on it.
- The gaps a PostgreSQL snapshot carries are what this release does not
  describe: a **foreign table**, named as the gap's subject, and a key onto
  a partition or an inheriting table, as above.

What a snapshot cannot say, and the operations then report as
`permission-denied`: a `serial` or `nextval()` default needs `USAGE` on its
sequence, which is not described, so an account may hold `INSERT` on every
column and still fail to create a row; an identity column needs no sequence
privilege. A view's columns say what its own grants allow, but a read
through it also needs privileges on the tables behind it — the view owner's,
or the reader's for a `security_invoker` view — and without them every read
is refused while the snapshot says `SELECT` (pinned in
`discovery-access.integration.test.ts`); the generator's note on every view
says a read may be refused. And a privilege is what was true at discovery:
the privilege functions and `row_security_active` read live catalog state,
not the transaction's snapshot, so a grant or an `ALTER TABLE` committed
mid-discovery may show in them and not in the catalog rows beside them.

So a snapshot describes the database **as one account sees it**. Discover as
the account the forms will use; an owner's snapshot and a narrow account's
differ, and so do their fingerprints. The privilege checks are not free:
measured on 2026-10-09 (Docker Desktop, 20 CPUs), the four checks per column
over 10,000 columns took about 200 ms, against 8 ms for the same
`pg_attribute` read alone.

Every catalog query runs in one `REPEATABLE READ`, read-only transaction, and
every schema name is a bound parameter. The transaction searches
`pg_catalog` first, before the connection's own `search_path`, so
`format_type` and `pg_get_expr` spell PostgreSQL's own types and functions
without their schema and anything a schema on the path holds under the same
name with it: a key's default is told apart by that spelling, whole
([0057](../../docs/decisions/0057-a-key-of-one-column-filled-by-a-never-repeating-default-counts-as-numbered.md)).
Under a path that does not name `pg_catalog` -- the default among them --
it is searched first already, and nothing is spelled otherwise.

### What the catalog is read as

| PostgreSQL | Normalised |
|---|---|
| `smallint`, `integer`, `bigint` | `integer` with the exact range, as decimal strings |
| `numeric(p,s)`; `numeric` | `decimal` with `p` and `s`; both `null` when unconstrained. A negative scale, or one above the precision, is reported as declared |
| `varchar(n)`, `char(n)`, `text`, `varchar` | `text`, `fixedLength` for `char`. The length's unit is the database encoding's: characters in a UTF8 database (`code-points`, so `varchar(4)` holds four emoji), bytes of UTF-8 in a SQL_ASCII one (`utf8-bytes`), and characters of a non-Unicode encoding such as LATIN1 (`code-page-bytes`), which refuses a character it lacks |
| `boolean`, `date`, `uuid` | `boolean`, `date`, `uuid` |
| `bytea` | `binary`, unbounded and never padded (`fixedLength: false`) |
| `time(p)`, `timestamp(p)`, `timestamptz(p)` | `time`, `timestamp` with or without a zone; precision `null` when not declared |
| `real`, `double precision` | `float` of 32 or 64 bits |
| anything else — `timetz`, `interval`, `money`, `json`, arrays, enums, domains, bare `bpchar` | `unsupported`, with the type as PostgreSQL spells it |

`GENERATED ALWAYS AS IDENTITY` is `identity-always` and `GENERATED BY DEFAULT
AS IDENTITY` is `identity-by-default`: the first refuses a value without
`OVERRIDING SYSTEM VALUE`, the second takes one, and a form writes neither,
because a number chosen by hand is one the sequence hands out again later. A
default that is exactly `nextval('…'::regclass)` — `serial`, or written by
hand — behaves the same way and is `identity-by-default` too, keeping its
default; one that computes with `nextval()` is an ordinary default. An
`attidentity` code PostgreSQL does not have yet is read as `identity-always`.
A check's `enforced` is `pg_constraint.conenforced` where the server has it
(PostgreSQL 18's `NOT ENFORCED`) and true where it does not (17, which checks
every new row against each one); `validated` is `convalidated`: NOT VALID
skips only the rows already there. NOT NULL is read from `attnotnull`: 18
files each NOT NULL in `pg_constraint` too, as type `n`
(`VERSION_FACTS.notNullConstraints`), and a validated one is not read as a
check. A NOT NULL added NOT VALID, which only 18 has, sets `attnotnull`
though rows older than it may hold NULL, so it is read as the same rule
spelled `CHECK (column IS NOT NULL) NOT VALID` is on every version: the
column nullable, and a check by the constraint's name, `(column IS NOT
NULL)`, enforced and not validated, until `VALIDATE CONSTRAINT` makes it the
column's NOT NULL (0077). Over a row type -- a composite, or a domain over
one at any depth -- the check is `(column IS DISTINCT FROM NULL)`, the rule
the NOT NULL keeps there: `IS NOT NULL` asks that every field be non-null,
and the column takes `row(null, null)`. A request's description of a table
(0041) reads the column the same way. A stored
generated column is `computed`
and has no default, though PostgreSQL files its expression where defaults
live.
Unique keys include unique indexes that are not constraints, when they are
valid, not partial and over plain columns. A foreign key to a partitioned table
is reported once, not once per partition. A foreign key is `enforced` unless
its triggers were disabled, which is the only way one stops being checked on
PostgreSQL 17 — on the table, or on any partition of either side, whose
triggers belong to that partition's clone of the constraint. Partitions are
described through their parent, materialized views as views, and foreign tables
are gaps.

### What the phase-1 spike found, kept as tests

`src/spike.integration.test.ts` keeps the PostgreSQL half of the plan's
phase-1 spike running against the fixture:

- **Large integers and exact decimals.** By default the driver returns
  `bigint` and `numeric` as strings holding the exact digits. That default is
  the composition root's to change — a driver configured to parse numbers
  returns 2^53 + 1 as 2^53 — so the lossless read path is a cast to `text` in
  the SQL the adapter writes, which no parser configuration can reach. A
  `bigint` key bound as a JavaScript number does not fail; it matches a
  different row. Building the operations showed the cast is not enough on its
  own — `transform` and DateStyle still reach it — which is why they read
  positional bytes and spell dates with `to_char` (above).
- **Untyped parameters.** postgres.js serialises a parameter it did not type
  with its serializer for the type the server inferred: the text `'true'`
  bound against a boolean column is sent as false, and `'infinity'` against a
  date throws in `new Date()`. Cast to text where it stands, either is sent as
  written.
- **Optimistic concurrency with an application-maintained version column.**
  `update ... where id = $1 and row_version = $2` lets exactly one of two
  writers holding the same version through, on two independent connections,
  including when the second arrives while the first is still in its
  transaction: under `READ COMMITTED` PostgreSQL waits for the row lock, then
  re-checks the condition against the committed row and updates nothing.
  Under `REPEATABLE READ` the same race is refused with SQLSTATE `40001`
  instead, which `createPostgresRecords` reports as `stale` too.

## Tests

`pnpm test` starts PostgreSQL through `@formancy/data-fixtures` (and, for one
suite, `postgres:18-alpine`), loads the shared fixture, and runs the suites
against it. It needs Docker, and there is no mocked driver to fall back to —
database semantics are what this package is for, and a suite that passed
without a database would be proving the mock (0003). The fixture is resolved
from its built output, so run `pnpm build` first.

<!-- generated by scripts/release-report/readme.mjs; do not edit -->

The suites start `postgres:17-alpine`, or the image a file names for a fact of its own, through `postgres` 3.4.9 (published as `^3.4.9`); CI runs them again on `postgres:15-alpine`, `postgres:16-alpine` and `postgres:18-alpine`, each named in `FORMANCY_IMAGES`.

<!-- end generated -->

- `adapter.integration.test.ts` — ping and close, including a close after a
  connection was cut mid-statement, which returns, and one with a statement
  still running, which lets it answer.
- `discovery.integration.test.ts` — the shared model as the owner, the
  restricted reader's rule and its grants, privileges short of a whole
  table, the scope, the fingerprint, a check added NOT VALID read as
  enforced and not validated, a key from outside the scope named on the
  table it refers to, a key between partitioned tables listed once, and a
  key onto a partition or an inheriting table a gap on the table above.
- `discovery-access.integration.test.ts` — the writer's grants through its
  role, every reported capability, DELETE on each table included, checked
  against the statement the server runs or refuses (as the owner, the reader
  and the writer), a session role
  and an `INHERIT FALSE` membership (on 15, which refuses that grant, a
  `NOINHERIT` member), row security for the owner with and
  without `FORCE` and for a `BYPASSRLS` role, and what the record operations
  do with both: a `serial` create refused, a hidden row `not-found`.
- `discovery-types.integration.test.ts` and
  `discovery-shapes.integration.test.ts` — the map from each type to the
  contract, the two identities and a sequence default, the shapes only
  PostgreSQL has, declared in schemas of their own, and what a text length
  counts in a SQL_ASCII and a LATIN1 database, each made for the test.
- `discovery-pg18.integration.test.ts` — the two catalog states only 18
  can hold, on `postgres:18-alpine` in every leg: a `NOT ENFORCED` check,
  reported as not enforced, and a NOT NULL added NOT VALID, read as the
  same rule spelled as a check added NOT VALID is, column, quoting and
  description included, over a composite, a domain over it and a domain
  over that domain as `IS DISTINCT FROM NULL`, and as NOT NULL once it is
  validated (0077).
- `discovery/columns.test.ts` — the generation codes, including one no server
  can produce yet, called directly.
- `spike.integration.test.ts` — the driver's numbers, untyped parameters, the
  empty slots its array of rows keeps after a statement that failed
  part-way (0078), and the version column.
- `lookups.integration.test.ts` — the lookup port over the fixture: tenant
  filters, literal search, order, NULL and unrepresentable keys, membership,
  the restricted reader, a driver configured every way it can be, and
  objects planted on the search path.
- `lookups-sized.integration.test.ts` — what a lookup reads and sends on the
  sized customers, in containers of its own: the plan of each statement the
  adapter sent, serially and under the defaults (0034); and what a page of
  records deep in key order reads after a row, and at an offset (0108).
- `lookups-limits.integration.test.ts` — a lookup whose signal aborts (0061),
  through the TCP hop, each statement waiting behind a lock `blockTable`
  holds so its end is read from `pg_locks`: a search, a resolve and a rejects
  stopped before the lock is released, the next lookup on the same backend
  answering with no setting left behind; a deadline rejecting with its own
  TimeoutError; an aborted signal sending nothing; an abort in the same tick,
  while the connection is being opened and while queued, each leaving a pool
  of one that answers; with every answer held 100 ms, an abort while queued,
  in the same tick and during the first round trip each stopping a 30 s
  sleep once its execute is sent; a cancel request the hop refuses, which no
  unhandled rejection follows; an already-aborted resolve or rejects with no
  key still rejecting; one cancel request held at the hop until it lands on
  the next lookup, which runs once more, and the two of a search aborted in
  its parse, which stop the next lookup and its one run more; a statement stopped part-way through its
  answer, after which the next search, resolve and rejects on its
  connection answer as they would have (0078); a connection cut and a backend terminated
  under a lookup; and `connectPostgres`'s `applicationName`.
- `parity.integration.test.ts` — the cases 0028 holds both engines to, from
  `@formancy/data-fixtures`, over its `parity` schema: every row filter in a
  lookup's page, resolve and membership, a read and an update; the filter
  served by the primary key, and unchanged by a planted `public."C"` and
  `public.bpchar`; an unconstrained `numeric` filter; every label under an
  unusual TimeZone, DateStyle and float digits, which the test reads back
  from the session first, and the time and instant `TEMPORAL_PARITY` names
  under another — postgres.js drops a startup parameter whose value
  is falsy, and `extra_float_digits: 0` had never arrived; and every refusal, a
  deadlock victim, the timeouts and a terminated backend included.
- `records.integration.test.ts` — the record port over the fixture: every
  edge value and every kind, the shared shipment rows and the column facts
  both engines are held to (a length in characters, a `real`'s canonical
  value against PostgreSQL's own text, the zoneless spelling, why a
  by-default identity stays read-only, and the U+FFFD an unpaired surrogate
  would silently become),
  instants and times read to the shape and what no shape names refused,
  concurrency between real
  connections, every refusal the fixture can provoke, writes a trigger or a
  rule declines, objects planted on the search path, a connection cut
  through a TCP hop after a write was sent, and a read after a statement
  that failed part-way on its connection (0078).
- `list.integration.test.ts` — a page of records (0044), each case
  `LIST_PARITY`'s: key order and paging after a row (0108), every order
  walked a page at a time as its one page, a row inserted or deleted before
  a page moving nothing, a page after a row gone or another tenant's
  refused, a varchar walked a label at a time, a literal search, NULLs last both
  ways, a NOT NULL sort spelled without a placement, a parent over an
  integer and over a `char(2)` foreign key, a child's lines through their
  order, every row its read, and a page refused once its own description
  says the key can be NULL or is not unique; and a file of the shipments
  (0079), `EXPORT_PARITY`'s `export: shipments`: the shipments listed
  through the adapter and written by data-core are the shared file's
  bytes. And a list or a browse narrowed by a person's filter (0104), each
  case `COLUMN_FILTER_PARITY`'s: text equal exactly, under the parity
  schema's case-insensitive collation too; an integer, a decimal, a
  boolean, a uuid and a date equal; ranges holding the rows on their
  bounds; a day range on an instant and on a zoneless timestamp, in the
  default session and in one on Pacific/Chatham with `SQL, DMY`; a literal
  contains; NULL and not NULL; and conditions together, beside a search,
  beside a parent and beside a follow.
- `uuid.integration.test.ts` — a uuid key end to end (0056), each case
  `UUID_PARITY`'s, as the order form's own account: `sales.delivery`'s key
  and its `gen_random_uuid()` default discovered, the key read-only in the
  generated form, its token, a create answered with the key the database
  chose, an update and a stale one, another tenant's delivery not found, a
  list under an order in PostgreSQL's order of uuid -- its bytes in turn,
  where SQL Server's is its byte groups -- and `sales.parcel`'s lookup onto
  the uuid, whose options tied on one carrier come in that same order; a
  delivery deleted by its uuid token with its parcels, and then its order
  with its line, its other delivery and that one's parcel, each on the
  locked path, once the policy names each key the delete acts through
  (0051); and which default makes a version column prove a record over a
  uuid key
  (0057): `gen_random_uuid()` filling the whole key, however the DDL writes
  it, and not a constant, `uuid_generate_v4()`, a function of another
  schema named `gen_random_uuid`, or `gen_random_uuid()` beside a pinned
  tenant or on a key that refers to another table's, each as `pg_get_expr`
  spells it -- with a row of the first read and deleted by its token; and,
  this engine's own, that a `search_path` naming that other schema before
  `pg_catalog` changes no spelling discovery reports, which reads every
  default with `pg_catalog` first, while a description read under it
  spells `pg_catalog.gen_random_uuid()` and the runtime refuses the delete.
- `records-lost-answer.integration.test.ts` — an insert and an update whose
  answer the hop drops after the commit, counted at the wire; a deferred
  unique constraint refused after the row was sent, with and without the
  answer lost; and a statement timed out while it waits on a lock.

## Licence

Source-available, not open source. See [`LICENSE.md`](./LICENSE.md).
