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

The adapter takes a connected pool rather than a connection string: opening the
connection is where a secret is handled, and that happens once, in the
composition root. Nothing in this package reads configuration.

`@types/mssql` is a dependency rather than a devDependency because the pool is
in the factory's signature. A consumer type-checking against the published
declarations needs it, and `skipLibCheck` would not save them, since the import
is in this package's own declaration file. The install gate checks exactly this.

## Tests

`pnpm test` starts `mcr.microsoft.com/mssql/server:2022-latest` through
testcontainers and runs the suite against it. It needs Docker and, the first
time, a pull of about a gigabyte and a half. There is no mocked driver to fall
back to — database semantics are what this package is for (0003).

## Licence

Source-available, not open source. See [`LICENSE.md`](./LICENSE.md).
