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
import { buildLookupConfig } from '@formancy/data-core'
import { createSqlServerLookups } from '@formancy/data-sqlserver'

const lookups = createSqlServerLookups(pool)
const config = buildLookupConfig(bindings, 'customer', { snapshot })
const tenant = { kind: 'restricted', equal: [{ column: 'tenant_id', value: '1' }] } as const
await lookups.search(config, { search: 'muster', offset: 0, limit: 50 }, tenant)
// { rows: [{ token: 'k1:1,1001', label: 'Muster AG' }], hasMore: false, omitted: 0 }
await lookups.rejects(config, ['k1:1,1001', 'k1:2,1001'], tenant) // ['k1:2,1001']: another tenant's
```

A search is a literal: `%`, `_` and `[` match themselves. How it matches case
and accents, and how text is ordered, is the column's collation — on a
case-insensitive database `muster` finds `Muster AG` and `apple` sorts before
`Banana` — which is SQL Server's rule and not code-point order. NULLs sort
where the configuration says, though SQL Server has no `NULLS LAST`. A row
whose key holds a NULL is never offered. A filter compares its trusted value
exactly, not by collation. Membership is the re-encoded row's, because
SQL Server's `=` finds `CH` for `ch` and `A` for `A `. Tokens are asked about
in groups of 2098 parameters, which is what one statement can bind. A display
column is spelled by SQL Server's ISO style 126, because the configuration
does not carry its type. A database error is thrown, which formancy turns into
a refused submission.

### Records

`createSqlServerRecords(pool)` reads, inserts and updates one record
([0015](../../docs/decisions/0015-a-record-operation-is-one-guarded-statement.md),
[0017](../../docs/decisions/0017-sqlserver-operations.md)):

```ts
import { createSqlServerRecords } from '@formancy/data-sqlserver'

const records = createSqlServerRecords(pool)
const read = await records.read({ target, key, columns, filters })
// { ok: true, values: { id: '9007199254740993', amount: '99999999999999.9999', … }, version: '00000000000007d1' }
const saved = await records.update({ target, key, set, expectedVersion: read.version, filters, returning })
// or { ok: false, code: 'stale' | 'not-found' | 'unique-violation' | …, message }
```

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
  off, because formancy's shapes cannot hold them; update only the fields a
  person changed. Text and
  decimals are read by the column's own type, not the snapshot's, so a
  column widened since discovery reads what it holds.
- **Values arrive as text the server converts**, never through the driver's
  typed parameters, whose decimal goes through a JavaScript number.
- **A write is one batch**: the guarded statement, a check that every text
  column stored the text it was sent — SQL Server turns `ŁA` into `LA` in a
  single-byte varchar without an error, and the adapter refuses it as
  `out-of-range` — and the commit. Any error rolls it back, a trigger's
  `RAISERROR` included, which on its own would not stop the commit. It works
  on a table with triggers: `returning` is the row as the statement wrote it,
  before an AFTER trigger, and the version is the row's after one, read back
  by its key, so a trigger that touches the row does not make the next save
  stale.
- **A trigger that decides what is stored is refused.** An INSTEAD OF
  trigger runs in place of the statement, and what SQL Server returns is the
  row as if it had not: a write to a table with an enabled one for that
  operation — a view made writable by one included — is rolled back as
  `unavailable`, and so is a write by an account that cannot see the table's
  triggers. A trigger that ends the write's transaction itself, by COMMIT or
  ROLLBACK, is `unknown-outcome`, because the batch cannot tell which. An
  AFTER trigger that deletes the row it fired for, or that commits and then
  raises an error, still misleads; [0017](../../docs/decisions/0017-sqlserver-operations.md)
  says how.
- **An update is one statement** naming the key, the filters and the
  expected version, incrementing a version column in the same SET. A record
  outside the filters is `not-found`, like one that does not exist.
- **A refusal is a code**, by its error number, with a sentence of the
  adapter's own that never repeats a value. A constraint or column is named
  when the message is English, which it is unless `options.language` was set.
  A pool that hands out no connection — closed, or none free within
  `acquireTimeoutMillis` — is `unavailable`, because nothing was sent.
  A connection lost after a write was sent is `unknown-outcome`, and nothing
  is retried.

**What an account needs.** `SELECT` on what a form reads and a lookup offers,
and `INSERT` and `UPDATE` on what a form writes — with `SELECT` on it too: a
write reads back through `OUTPUT` the columns it returns, the text it checks
and the key it finds the row by again, and SQL Server asks `SELECT` for
every column `OUTPUT` names, refusing an INSERT-only grant with 229. A grant
it lacks is `permission-denied` for a record and a thrown error for a
lookup. A row a security policy's block predicate refuses (33504) is
`permission-denied` too, as PostgreSQL's row-level security refusal is
there. An account denied `VIEW DEFINITION` on a table it writes is refused
the write, because whether a trigger decides it cannot be seen.

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
error; and a German session gets error 547 with its `FOREIGN KEY` and `CHECK`
keywords untranslated. That all 34 languages on the 2022 image keep them was
checked once, by hand, on 2026-10-09, and is not a test.

## Tests

`pnpm test` starts `mcr.microsoft.com/mssql/server:2022-latest` through
testcontainers, once per test file, and runs the suite against it: discovery,
the spike, lookups, records, and the ways a record operation fails. It needs Docker and, the first
time, a pull of about a gigabyte and a half. There is no mocked driver to fall
back to — database semantics are what this package is for (0003).

## Licence

Source-available, not open source. See [`LICENSE.md`](./LICENSE.md).
