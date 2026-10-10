<!-- Part of Formancy Data: https://github.com/sharkysan/formancy.ai-data -->

# @formancy/data-sqlserver

The Microsoft SQL Server adapter for Formancy Data, behind the port
`@formancy/data-core` defines. Built on [`mssql`](https://github.com/tediousjs/node-mssql)
over the pure-JavaScript `tedious` driver, so there is no native module and no
ODBC to install.

## What is here today

An adapter that reaches a real server and says which version answered:

```ts
import { connectSqlServer, createSqlServerAdapter } from '@formancy/data-sqlserver'

const pool = await connectSqlServer({ host, port, database, user, password, encrypt: true, trustServerCertificate: false })
const adapter = createSqlServerAdapter(pool)
await adapter.ping() // { kind: 'sqlserver', version: '16.0.4205.1' }
await adapter.close()
```

Open the pool with `connectSqlServer`, not with an `mssql` you imported
yourself. This package binds every value with `mssql.NVarChar` and friends from
its own copy of mssql, and tedious checks those by identity: a pool from
another copy refuses every parameter with "type.validate is not a function".
pnpm produced exactly that for the server, two installs of the same mssql
version, and only the end-to-end suite saw it
([0025](../../docs/decisions/0025-each-adapter-owns-its-driver.md)).

And discovery: what a connection can see of the tables and views in an
approved scope, as a `MetadataSnapshot` built by `@formancy/data-core`'s
`createSnapshot`, with what it could not see written down as gaps
([0007](../../docs/decisions/0007-sqlserver-discovery-and-what-it-hides.md)):

```ts
import { discoverSqlServer } from '@formancy/data-sqlserver'

const snapshot = await discoverSqlServer(pool, { schemas: ['sales'] })
snapshot.objects // tables and views, columns with normalised types and access, keys, foreign keys, checks, row security
snapshot.account // { user: 'dbo', login: 'sa' }
snapshot.gaps // e.g. on sales.order: "fk_order_customer references a table this account cannot see: …"
```

It reads SQL Server's catalog views, one concern per file under
`src/discovery/`: objects, columns and their types, what the account may do
with each column, keys, foreign keys, checks, security policies, the account,
and what the account cannot see. The scope's schema names are bound as
parameters and matched by the database's own collation. Discovery is not one
consistent read: a concurrent `ALTER` can tear it, and `createSnapshot` then
refuses what no catalog could have produced. A column and its privileges are
read in one statement, so no column lacks an answer; but the privilege check
looks a column up by name when it runs, so a concurrent rename can answer
"not granted" for a column that is, until the next snapshot.

**An answer lost after a write.** `records-lost-answer.integration.test.ts`
puts a TCP hop in front of the server that drops its answer, so every byte is
tedious's and the server's and only the network fails (0031). What it proves
on SQL Server 2022, with the driver versions *Tests* names:

- **An insert or an update whose answer is lost after it committed** is
  `unknown-outcome`. The write crossed the hop once and is stored once; an
  update's change is stored and its rowversion has moved past the one sent,
  so saving again with that version is `stale`, not a second write.
- **A request timeout after the commit** is `unknown-outcome` too, and the
  row is stored: tedious gives up at `requestTimeout`, and again at
  `cancelTimeout` when the answer to its cancel is lost as well. The suite's
  `requestTimeout` is five seconds, against a commit whose answer reached the
  hop 40 ms after the send, because an attention that reached the server
  before the commit would cancel the batch and prove nothing. On
  PostgreSQL a server-side `statement_timeout` rolls back and is
  `unavailable`; here the timeout is the client's, and says nothing about the
  commit.
- **A socket cut while the write waits on a lock** is `unknown-outcome`,
  which over-reports: SQL Server ends a session whose client went away, the
  session is gone shortly after, and once the lock is released nothing was
  stored. PostgreSQL does the opposite, and an orphaned write there commits
  after the release.
- **What the driver rejects a lost answer with** is a `RequestError` whose
  `number` is the string `'ECONNRESET'` for a cut socket and `'ETIMEOUT'` for
  a timeout, with no `class`: mssql copies a driver error's `code` into
  `number` when it has no `info`. That every failure after a connection is
  handed out is a `RequestError` was read in mssql's source for
  [0017](../../docs/decisions/0017-sqlserver-operations.md); it is now tested,
  for a socket and a timeout. It is why `serverError` asks `typeof number ===
  'number'`: a lost answer read as the server's refusal would be `refused`.

**What an account needs.** For a snapshot with no gap, `VIEW DEFINITION` on
the database, and nothing else: no `SELECT`, no data access
([0027](../../docs/decisions/0027-a-snapshot-says-what-its-account-may-do.md)).
`VIEW DEFINITION` on each schema in scope describes every table and view the
owner sees, but not every security policy: a policy lives in a schema of its
own and can filter a table in any other, so row security is then `unknown`
except where a visible policy applies, and one scope gap says why.
`VIEW SECURITY DEFINITION` does not help; it lists no policy. Without either
grant, SQL Server lists only the objects the account holds a permission on and
returns `NULL` for every default and check definition, and the snapshot says so
per object and per schema rather than looking complete. A table someone has
denied `VIEW DEFINITION` or `CONTROL` on, whether to the account or to a role
it is in, vanishes even under that grant; the account can count those denials,
though not place them, and the snapshot says that too. Any such deny, on an
object or on a schema, leaves row security `unknown` even under the database
grant, because the hidden thing may be a policy. Only a deny the server
applies counts: one made to `public` binds no sysadmin and no `dbo`, so the
owner's snapshot stays complete.

**What the snapshot says the account may do.** Every column carries `access`:
whether the account may `SELECT` it, name it in an `INSERT` and in an
`UPDATE`, as `HAS_PERMS_BY_NAME` answers for the connected user, through every
role it is in. SQL Server grants `INSERT` on whole objects only, so every column
of an object the account may insert into says yes. A column denied `SELECT`
says so, where before only the first read found out. `rowSecurity` is
`applies` where an enabled security policy targets the object — SQL Server
exempts nobody, `dbo` included — `none` where the database grant establishes
that none does, and `unknown` otherwise. The snapshot names its `account`:
`USER_NAME()`, which the fingerprint carries, and `ORIGINAL_LOGIN()`, which it
does not; `sa` and any other sysadmin are `dbo`. Each is what was true at
discovery: a grant revoked afterwards still fails at runtime as
`permission-denied`.

**What a column is read as**
([0026](../../docs/decisions/0026-name-every-column-fact-the-engines-disagree-on.md)).
A text length is in the unit the column counts: UTF-16 code units for
`nchar`/`nvarchar` under every collation, a UTF-8 one included, though the
catalog reports code page 65001 for it; bytes of UTF-8 for `char`/`varchar`
under a UTF-8 collation; bytes of its code page under any other. `binary(n)`
pads and says so. `IDENTITY` is `identity-always`; a default that is exactly
`NEXT VALUE FOR` a sequence numbers a row an insert leaves out and takes a
value given by hand, as PostgreSQL's BY DEFAULT identity does, and is
`identity-by-default`, keeping its default. Without `VIEW DEFINITION` that
definition is `NULL`, the column reads as an ordinary default, and the
snapshot's `defaults` gap says so. A check is `enforced` unless it is
disabled, and `validated` unless it is untrusted — which every disabled check
also is.

Every function here takes a connected pool rather than a connection string:
opening the connection is where a secret is handled, and that happens once, in
the composition root. Nothing in this package reads configuration.
`adapter.discover(scope)` is the same discovery through the `DatabaseAdapter`
port.

`@types/mssql` is a dependency rather than a devDependency because the pool is
in every function's signature. A consumer type-checking against the published
declarations needs it, and `skipLibCheck` would not save them, since the import
is in this package's own declaration file. The install gate checks exactly this.

### Lookups

`createSqlServerLookups(pool)` answers formancy's option sources for the
foreign keys a form offers as lookups — a page of a search, labels for tokens a
form holds, and which submitted tokens are not members — under the actor's
trusted row filters, in the same statement
([0012](../../docs/decisions/0012-a-lookup-token-is-a-reference-not-a-permission.md),
[0017](../../docs/decisions/0017-sqlserver-operations.md)):

```ts
import { buildLookupConfig, findObject, scopeRowFilters } from '@formancy/data-core'
import { createSqlServerLookups } from '@formancy/data-sqlserver'

const lookups = createSqlServerLookups(pool)
const config = buildLookupConfig(bindings, 'customer', { snapshot })
const customers = findObject(snapshot, config.target)
if (customers === undefined) throw new Error('the lookup target is not in the snapshot')
const scoped = scopeRowFilters(customers, [{ column: 'tenant_id', value: '1' }], 'lookups.customer')
if (!scoped.ok) throw new Error(scoped.message) // invalid-policy or invalid-context
const tenant = scoped.filters // each term carries its column's type
await lookups.search(config, { search: 'muster', offset: 0, limit: 50 }, tenant)
// { rows: [{ token: 'k1:1,1001', label: 'Muster AG' }], hasMore: false, omitted: 0 }
await lookups.rejects(config, ['k1:1,1001', 'k1:2,1001'], tenant) // ['k1:2,1001']: another tenant's
```

A search is a literal: `%`, `_` and `[` match themselves. How it matches case
and accents, and how text is ordered, is the column's collation — on a
case-insensitive database `muster` finds `Muster AG` and `apple` sorts before
`Banana` — which is SQL Server's rule and not code-point order. NULLs sort
where the configuration says, though SQL Server has no `NULLS LAST`. A row
whose key holds a NULL is never offered. Membership is the re-encoded row's,
because SQL Server's `=` finds `CH` for `ch` and `A` for `A `. Tokens are
asked about in groups of 2098 parameters, which is what one statement can
bind. A database error is thrown, which formancy turns into a refused
submission.

**A row filter compares exactly**
([0028](../../docs/decisions/0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md)):
the column's canonical value is the trusted value, so case, accents and
trailing spaces all count, as on PostgreSQL. SQL Server has no such operator —
every collation, BIN2 included, ignores trailing spaces — so a text filter is
three conjuncts on one parameter: `=` in the column's own collation, `=`
under `Latin1_General_100_BIN2`, and, for variable-length text, equal
`datalength`s. A non-text filter is bound as its column's type. The first
conjunct is the one an index seeks on: measured over 20,004 rows, an
`nvarchar` or `nchar` column seeks, and so does a `char` or `varchar` under a
Windows collation; a `char` or `varchar` under a `SQL_` collation still
scans, as it did when the filter was BIN2 alone, which never seeked. The
parity suite reads the plan to hold the `nvarchar` case.

**A label is the record reader's value**, decoded as a record read decodes
it and spelled by `displayText` from `@formancy/data-core`: `true` for a bit,
a lower-case uuid, `0.1` for a float or a real, an instant in UTC to the
second, a time to the minute, whatever the session's language. A `char(n)`
reads without its padding, in a label, a key and a record alike, so a
fixed-length key has the token PostgreSQL gives it. An integer search column
is matched as its canonical text; text as itself, so its collation folds case
and accents.

### What a lookup reads

[0034](../../docs/decisions/0034-performance-is-measured-through-the-shipped-server-and-held-without-a-clock.md)
holds this without a clock, on the sized `sales.customer` of
`@formancy/data-fixtures`: `lookups-sized.integration.test.ts` runs each
statement through `createSqlServerLookups` as the writer and reads the actual
plan of exactly that statement, `ActualRowsRead` summed over every operator
and thread on `[customer]`. The counts it pins are `sizedRowsRead()` of
`@formancy/data-fixtures`, which the PostgreSQL suite and the performance
page read too. What it pins:

- **Rows sent.** A search asks for the page and one more row, `offset …
  fetch` in SQL: the server never receives more.
- **Rows read.** With the order form's tenant row filter, a search is a
  Clustered Index Seek on the tenant and reads exactly that tenant's rows --
  every one of them, for every search and for the first page, because a
  leading-wildcard `like` and the order by name have no index to use. On a
  form with no tenant row filter it is a Clustered Index Scan of the whole
  table: the row-security predicate is not a seek. A resolve and the
  membership check read at most one row per key.
- **What the plans were** (2026-10-09, SQL Server 2022 CU27 Developer,
  SQL_Latin1_General_CP1_CI_AS, a Docker Sandbox VM on a Windows 11
  workstation): the tenant's seek runs in parallel; the generated names
  sort as the generator says they do (P1).
- **How the rows read are seen** (P2): `sys.dm_exec_query_plan_stats`
  reports `ActualRows` per thread but no `ActualRowsRead` on this build,
  so the test reads the actual plan from an Extended Events session on
  `query_post_execution_showplan`, limited to the writer's statements. Not
  `SET STATISTICS XML` over text the test builds: a limit raised in
  `lookups.ts` would never show there.
- **What an index would not change** (P5, an index on `(tenant_id, name,
  customer_no)` created and dropped by the probe, never shipped): the
  `CASE … IS NULL` before each sort column keeps it from serving the order,
  so the first page still reads and sorts the whole tenant.

Every statement is two round trips: mssql's pool checks each connection with
`SELECT 1;` before handing it out (`validateConnection`, on by default and
not set by `connectSqlServer`), then sends the statement. The measurement's
counting pass counts it through a TCP hop on every run, and
[`docs/performance.md`](../../docs/performance.md) has the figures.

### Records

`createSqlServerRecords(pool)` reads, inserts and updates one record
([0015](../../docs/decisions/0015-a-record-operation-is-one-guarded-statement.md),
[0017](../../docs/decisions/0017-sqlserver-operations.md)):

```ts
import { createSqlServerRecords } from '@formancy/data-sqlserver'

const records = createSqlServerRecords(pool)
const read = await records.read({ target, key, columns, filters })
// { ok: true, described: { kind, columns, keys…, definition }, record: { values: { id: '9007199254740993', … }, version: '00000000000007d1' } }
const saved = await records.update({ target, key, set, expectedVersion: read.record.version, filters, returning, definition: read.described.definition })
// or { ok: false, code: 'stale' | 'not-found' | 'schema-changed' | 'unique-violation' | …, message }
```

- **Every write holds the table to the definition it was decided over**
  ([0041](../../docs/decisions/0041-the-runtime-refuses-what-drift-blocks.md)).
  `describe(table)` reads the root's definition in one statement, and a read
  returns it from the statement that read the record, which holds a
  schema-stability lock on the table while it runs. The facts are one FOR
  JSON text read by discovery's own queries for the object's kind, its
  column definitions, its keys and its foreign keys, without access or
  comment; the definition is their HASHBYTES SHA-256. The write batch checks
  it after its statement, while its locks keep an ALTER out, and again in
  CATCH after the rollback, so a statement that failed against a moved table
  -- 245 for `'many'` into a column retyped to int -- is answered as the
  move: 51706, `schema-changed`, and the batch rolled the write back, its
  triggers' work included. CATCH asks only while the transaction is still
  the batch's own: one a trigger ended is `unknown-outcome` whatever the
  table did, because the trigger may have committed the write (0031). The
  facts depend on the account, which the catalog filters by permission: an
  account without VIEW DEFINITION reads a default's definition as NULL, and
  the definition suite holds that its definition moves exactly when the
  owner's does. Measured on 2026-10-10 outside the suites, on one shared
  machine: 1.4 ms of CPU for a describe, 1.7 to 2.2 ms for a read where the
  read without the description took 0.1 ms, and 2.1 to 2.6 ms for a write
  where its batch took 0.66 to 0.77 ms. Masking is not among the facts:
  a column masked after publication reads as its mask to an account
  without UNMASK, and nothing compares it. A text the client receives cut by the
  connection's TEXTSIZE is `unavailable`, never parsed; an account the
  catalog hides the table from cannot have it described, and is
  `schema-changed`.

- **Values leave as text the server produced**, exactly what
  `codecFor(column).parse` returns: decimals padded to their scale (money to
  four places), integers as decimal strings, a `real` as the shortest decimal
  naming its float (`0.1`, never `0.10000000149011612`), dates `YYYY-MM-DD`,
  times `HH:MM`, instants in UTC to the second, a zoneless timestamp with its
  fraction and no trailing zeros (`2026-10-08T12:34:56.5`), as PostgreSQL
  spells it ([0026](../../docs/decisions/0026-name-every-column-fact-the-engines-disagree-on.md)) —
  a `datetime`, which keeps 1/300 s, to the millisecond, rounded as SQL
  Server spells it —
  UUIDs in lower case. A time's seconds and an instant's fraction are cut
  off, because formancy's shapes cannot hold them, as the PostgreSQL adapter
  now cuts them too. `planUpdate` in `@formancy/data-core`, given the record
  as read, removes an unedited echo of either from an update and refuses to
  plan one without that read, so a save planned by it does not write the
  shorter value
  ([0040](../../docs/decisions/0040-instants-and-times-are-read-to-the-shape-and-an-unedited-one-is-never-written.md)); a caller that builds an
  update request itself, as above, must set only the fields a person
  changed.
  Text and
  decimals are read by the column's own type, not the snapshot's, so a
  column widened since discovery reads what it holds.
- **Values arrive as text the server converts**, never through the driver's
  typed parameters, whose decimal goes through a JavaScript number.
- **A write is one batch**: the guarded statement, a check that every text
  column stored exactly the text it was sent — SQL Server turns `ŁA` into
  `LA` in a single-byte varchar without an error, and a varchar created under
  `ANSI_PADDING OFF` stores `acme` for `acme `, and the adapter refuses both
  as `out-of-range` — and the commit. Any error rolls it back, a trigger's
  `RAISERROR` included, which on its own would not stop the commit. It works
  on a table with triggers: `returning` is the row as the statement wrote it,
  before an AFTER trigger, and the version is the row's after one, read back
  by its key, so a trigger that touches the row does not make the next save
  stale.
- **A trigger that decides what is stored is refused.** An INSTEAD OF
  trigger runs in place of the statement, and what SQL Server returns is the
  row as if it had not: a write to a table with an enabled one for that
  operation — a view made writable by one included — is rolled back as
  `refused`, and so is a write by an account that cannot see the table's
  triggers. A trigger that ends the write's transaction itself, by COMMIT or
  ROLLBACK, is `unknown-outcome`, because the batch cannot tell which --
  whether or not it then raises an error of its own: the batch's CATCH sees
  that its transaction is gone, so a COMMIT followed by RAISERROR is no
  longer reported as the refusal it raised over a stored row, and a ROLLBACK
  followed by one is over-reported as unknown
  ([0031](../../docs/decisions/0031-an-answer-lost-after-a-write-is-unknown.md)).
  An AFTER trigger that deletes the row it fired for still misleads;
  [0017](../../docs/decisions/0017-sqlserver-operations.md) says how.
- **An update is one statement** naming the key, the filters and the
  expected version, incrementing a version column in the same SET. A record
  outside the filters is `not-found`, like one that does not exist.
- **A refusal is a code**, by its error number, with a sentence of the
  adapter's own that never repeats a value. A constraint or column is named
  when the message is English, which it is unless `options.language` was set.
  A pool that hands out no connection — closed, or none free within
  `acquireTimeoutMillis` — is `unavailable`, because nothing was sent.
  A connection lost after a write was sent is `unknown-outcome`, and nothing
  is retried ([0031](../../docs/decisions/0031-an-answer-lost-after-a-write-is-unknown.md));
  see *An answer lost after a write* below. The numbers without a code of
  their own (0028):

  | Error | Code |
  |---|---|
  | 544, 8102 (an identity), 271 (a computed column), 273, 272 (a rowversion), 13536, 13537 (a GENERATED ALWAYS column, such as a system-versioning period's) | `schema-changed`, as PostgreSQL's 428C9 |
  | 1205, 1222, 1204, 701, 8645, 8651, 9002, 1105, 3960, 3906 (a read-only database, PostgreSQL's 25006), 976, 983 (an availability replica not accessible now) | `unavailable`: SQL Server documents each as passing |
  | 50000 and above — a trigger's THROW or RAISERROR — and any other number | `refused`: nothing was written, and the same request would be refused again; unless a trigger ended the write's transaction before it, which is `unknown-outcome` (0031) |

  Of the `unavailable` numbers 1205, a deadlock victim, and 3906, a database
  switched to read-only, are provoked by a test; the others are by
  documentation. Every `schema-changed` number is provoked, each by a column
  that became generated after discovery: 273 and 272 because the adapter
  binds no rowversion value itself, 13536 and 13537 through a column that was
  a `datetimeoffset` and became a period's `datetime2`, because a zoneless
  timestamp is never written. A number of 50000 or above is said to be a
  trigger's or a procedure's own, and the suite reads that sentence.

**What an account needs.** `SELECT` on what a form reads and a lookup offers,
and `INSERT` and `UPDATE` on what a form writes — with `SELECT` on it too: a
write reads back through `OUTPUT` the columns it returns, the text it checks
and the key it finds the row by again, and SQL Server asks `SELECT` for
every column `OUTPUT` names, refusing an INSERT-only grant with 229. A grant
it lacks is `permission-denied` for a record and a thrown error for a
lookup. A row a security policy's block predicate refuses (33504) is
`permission-denied` too, as PostgreSQL's row-level security refusal is
there. An account denied `VIEW DEFINITION` on a table is refused every
request of a form over it, reads included: the catalog does not show it the
table, so the table cannot be described, and a write decided over another
account's description finds the table's facts NULL and is refused as a
moved definition, so whether a trigger decides it never has to be seen
([0041](../../docs/decisions/0041-the-runtime-refuses-what-drift-blocks.md)).

## What the spike found about the driver

`src/spike.integration.test.ts` keeps the phase-1 spike as tests, so a driver
upgrade that changes any of this fails by name:

- By default `tedious` returns `bigint` as an exact decimal string, and
  `decimal(18,4)` as a JavaScript number: the largest one, 99999999999999.9999,
  arrives as 100000000000000. Converting to text in the `SELECT` reads both
  exactly.
- A `bigint` key past 2^53 bound as a JavaScript number addresses a different
  row; bound as its decimal string it addresses the right one.
- A `date` arrives as a JavaScript `Date` at midnight UTC.
- `nvarchar(n)` holds n UTF-16 code units, and `varchar(n)` under a UTF-8
  collation holds n bytes; neither is n characters. Discovery says which, as
  each text column's `lengthUnit`, from its own collation's code page, and
  the codec counts in it (0026).
- Optimistic concurrency on `rowversion` holds between two independent
  connections: the update that names the current 8-byte token wins, and the
  stale one changes no rows.

The operations suites added more of the same, each a test that fails by name
if it changes: a `Decimal(18,4)` parameter stores `1234567890123.4567` as
`1234567890123.4568`; a request binds 2098 parameters, not the 2100 the
message names; `OUTPUT` without `INTO` is refused on a table with a trigger
(334); nvarchar into a single-byte varchar takes a "best fit" or `?` without an
error; a varchar created under `ANSI_PADDING OFF` drops a trailing space
without one; BIN2 equality ignores trailing spaces; a char(n) keeps its
padding through a conversion to nvarchar, and `rtrim` removes U+0020 alone;
a deadlock victim is 1205; and a German session gets error 547 with its `FOREIGN KEY` and `CHECK`
keywords untranslated. That all 34 languages on the 2022 image keep them was
checked once, by hand, on 2026-10-09, and is not a test.

## Tests

`pnpm test` starts SQL Server through `@formancy/data-fixtures`, once per
test file, and runs the suite against it: discovery, the spike, lookups,
what a lookup reads on the sized customers (0034), records, the ways a
record operation fails, and a write whose answer is lost on the way back. It
needs Docker and, the first time, a
pull of about a gigabyte and a half. There is no mocked driver to fall back
to — database semantics are what this package is for (0003).

<!-- generated by scripts/release-report/readme.mjs; do not edit -->

The suites start `mcr.microsoft.com/mssql/server:2022-latest` unless a test names another image, through `@types/mssql` 12.3.0 (published as `^12.3.0`), `mssql` 12.7.4 (published as `^12.0.0`) and the `tedious` 20.3.3 under it (`^19.2.2 || ^20.0.0`, by `mssql`).

<!-- end generated -->

## Licence

Source-available, not open source. See [`LICENSE.md`](./LICENSE.md).
