<!-- Part of Formancy Data: https://github.com/sharkysan/formancy.ai-data -->

# @formancy/data-sqlserver

The Microsoft SQL Server adapter for Formancy Data, behind the port
`@formancy/data-core` defines. Built on [`mssql`](https://github.com/tediousjs/node-mssql)
over the pure-JavaScript `tedious` driver, so there is no native module and no
ODBC to install.

## What is here today

An adapter that reaches a real server and says which version answered:

```ts
import mssql from 'mssql'
import { createSqlServerAdapter } from '@formancy/data-sqlserver'

const pool = await new mssql.ConnectionPool(config).connect()
const adapter = createSqlServerAdapter(pool)
await adapter.ping() // { kind: 'sqlserver', version: '16.0.4205.1' }
await adapter.close()
```

And discovery: what a connection can see of the tables and views in an
approved scope, as a `MetadataSnapshot` built by `@formancy/data-core`'s
`createSnapshot`, with what it could not see written down as gaps
([0007](../../docs/decisions/0007-sqlserver-discovery-and-what-it-hides.md)):

```ts
import { discoverSqlServer } from '@formancy/data-sqlserver'

const snapshot = await discoverSqlServer(pool, { schemas: ['sales'] })
snapshot.objects // tables and views, columns with normalised types, keys, foreign keys, checks
snapshot.gaps // e.g. "fk_order_customer references a table this account cannot see: …"
```

It reads SQL Server's catalog views, one concern per file under
`src/discovery/`: objects, columns and their types, keys, foreign keys, checks,
and what the account cannot see. The scope's schema names are bound as
parameters and matched by the database's own collation. Discovery is not one
consistent read: a concurrent `ALTER` can tear it, and `createSnapshot` then
refuses what no catalog could have produced.

**What an account needs.** `VIEW DEFINITION` on each schema in scope, and
nothing else: no `SELECT`, no data access. With it, discovery sees what the
owner sees. Without it, SQL Server lists only the objects the account holds a
permission on and returns `NULL` for every default and check definition, and
the snapshot says so per object and per schema rather than looking complete.
A table someone has denied `VIEW DEFINITION` or `CONTROL` on, whether to the
account or to a role it is in, vanishes even under that grant; the account can
count those denials, though not place them, and the snapshot says that too.

The adapter and discovery take a connected pool rather than a connection
string: opening the connection is where a secret is handled, and that happens
once, in the composition root. Nothing in this package reads configuration.
`discoverSqlServer` is a function beside the adapter, not a method on the
`DatabaseAdapter` port, until the PostgreSQL adapter has its counterpart and
the port can be shaped by both.

`@types/mssql` is a dependency rather than a devDependency because the pool is
in both functions' signatures. A consumer type-checking against the published
declarations needs it, and `skipLibCheck` would not save them, since the import
is in this package's own declaration file. The install gate checks exactly this.

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
  collation holds n bytes; neither is n characters.
- Optimistic concurrency on `rowversion` holds between two independent
  connections: the update that names the current 8-byte token wins, and the
  stale one changes no rows.

## Tests

`pnpm test` starts `mcr.microsoft.com/mssql/server:2022-latest` through
testcontainers and runs the suite against it. It needs Docker and, the first
time, a pull of about a gigabyte and a half. There is no mocked driver to fall
back to — database semantics are what this package is for (0003).

## Licence

Source-available, not open source. See [`LICENSE.md`](./LICENSE.md).
