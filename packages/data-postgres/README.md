<!-- Part of Formancy Data: https://github.com/sharkysan/formancy.ai-data -->

# @formancy/data-postgres

The PostgreSQL adapter for Formancy Data, behind the port
`@formancy/data-core` defines. Built on [`postgres`](https://github.com/porsager/postgres),
the same driver `@formancy/server` uses upstream.

## What is here today

An adapter that reaches a real server and says which version answered, and
discovery of the schemas an administrator approved:

```ts
import postgres from 'postgres'
import { createPostgresAdapter, discoverPostgres } from '@formancy/data-postgres'

const sql = postgres(process.env.DATABASE_URL)
const adapter = createPostgresAdapter(sql)
await adapter.ping() // { kind: 'postgres', version: '17.6' }

const snapshot = await discoverPostgres(sql, { schemas: ['sales'] })
snapshot.objects // tables and views, with columns, keys, foreign keys, checks, comments
snapshot.gaps // what this account could not establish, or may not use
snapshot.fingerprint // changes when the structure, or this account's access, changes
await adapter.close()
```

Both take a connected driver rather than a connection string: opening the
connection is where a secret is handled, and that happens once, in the
composition root. Nothing in this package reads configuration.

`discoverPostgres` is a function of its own for now. It joins the
`DatabaseAdapter` port when SQL Server's discovery exists too, because a port
is a promise both engines keep.

### Discovery reads pg_catalog, as the account the forms will run as

`information_schema` is filtered by privilege: an account that may only
`SELECT` from a table sees none of that table's constraints in it. Discovery
reads `pg_catalog` instead, which every role can read whole, and asks
separately what the connecting account may **use**
([0006](../../docs/decisions/0006-postgres-discovery-reads-pg-catalog.md)):

- An object in scope the account holds no usable privilege on, or whose schema
  it has no `USAGE` on, is not described. It is reported as a gap naming it,
  so "no such table" and "not yours" stay different answers, and a revoked
  privilege changes the fingerprint as an access change rather than as a
  dropped table.
- An object the account may use but not `SELECT` as a whole — a grant on some
  columns — is described, with a `columns` gap.
- A foreign key keeps its target even when the account cannot use the
  target: PostgreSQL's catalog names it, so a target is never unknown here.

So a snapshot describes the database **as one account sees it**. Discover as
the account the forms will use; an owner's snapshot and a narrow account's
differ, and so do their fingerprints.

Every catalog query runs in one `REPEATABLE READ`, read-only transaction, and
every schema name is a bound parameter.

### What the catalog is read as

| PostgreSQL | Normalised |
|---|---|
| `smallint`, `integer`, `bigint` | `integer` with the exact range, as decimal strings |
| `numeric(p,s)`; `numeric` | `decimal` with `p` and `s`; both `null` when unconstrained. A negative scale, or one above the precision, is reported as declared |
| `varchar(n)`, `char(n)`, `text`, `varchar` | `text`, length in characters, `fixedLength` for `char` |
| `boolean`, `date`, `uuid`, `bytea` | `boolean`, `date`, `uuid`, `binary` |
| `time(p)`, `timestamp(p)`, `timestamptz(p)` | `time`, `timestamp` with or without a zone; precision `null` when not declared |
| `real`, `double precision` | `float` of 32 or 64 bits |
| anything else — `timetz`, `interval`, `money`, `json`, arrays, enums, domains, bare `bpchar` | `unsupported`, with the type as PostgreSQL spells it |

`GENERATED ... AS IDENTITY` is `identity`; a stored generated column is
`computed` and has no default, though PostgreSQL files its expression where
defaults live; `serial` is an ordinary column whose default is `nextval()`.
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
  different row.
- **Optimistic concurrency with an application-maintained version column.**
  `update ... where id = $1 and row_version = $2` lets exactly one of two
  writers holding the same version through, on two independent connections,
  including when the second arrives while the first is still in its
  transaction: under `READ COMMITTED` PostgreSQL waits for the row lock, then
  re-checks the condition against the committed row and updates nothing.
  Under `REPEATABLE READ` the same race is refused with SQLSTATE `40001`
  instead, which error translation will have to treat as a conflict too.

## Tests

`pnpm test` starts `postgres:17-alpine` through testcontainers, loads the
shared fixture from `@formancy/data-fixtures`, and runs the suites against
it. It needs Docker, and there is no mocked driver to fall back to — database
semantics are what this package is for, and a suite that passed without a
database would be proving the mock (0003). The fixture is resolved from its
built output, so run `pnpm build` first.

- `adapter.integration.test.ts` — ping and close.
- `discovery.integration.test.ts` — the shared model as the owner, the
  restricted reader's rule, privileges, the scope, the fingerprint.
- `discovery-types.integration.test.ts` and
  `discovery-shapes.integration.test.ts` — types and catalog shapes the shared
  model does not describe yet, declared in schemas of their own.
- `spike.integration.test.ts` — the driver's numbers and the version column.

## Licence

Source-available, not open source. See [`LICENSE.md`](./LICENSE.md).
