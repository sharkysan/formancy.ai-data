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
import postgres from 'postgres'
import { createPostgresAdapter, createPostgresLookups, createPostgresRecords } from '@formancy/data-postgres'

const sql = postgres(process.env.DATABASE_URL)
const adapter = createPostgresAdapter(sql)
await adapter.ping() // { kind: 'postgres', version: '17.6' }

const snapshot = await adapter.discover({ schemas: ['sales'] })
snapshot.objects // tables and views, with columns, keys, foreign keys, checks, comments
snapshot.gaps // what this account could not establish, or may not use
snapshot.fingerprint // changes when the structure, or this account's access, changes

const lookups = createPostgresLookups(sql) // LookupAdapter: search, resolve, rejects
const records = createPostgresRecords(sql) // RecordAdapter: read, insert, update
await adapter.close()
```

Each takes a connected driver rather than a connection string: opening the
connection is where a secret is handled, and that happens once, in the
composition root. Nothing in this package reads configuration, and nothing
assumes how the driver was configured (below). `discoverPostgres(sql, scope)`
is the same discovery as a function of its own.

### Lookups and records: what the server converts, and what the driver never touches

[0016](../../docs/decisions/0016-postgres-operations.md) has the reasoning;
in short:

- **Values are read as text the server wrote, by position.** Every column is
  converted in SQL to the text `codecFor(column).parse` would return: a
  decimal padded to its scale, a `bigint` as its digits, a date as
  `YYYY-MM-DD` from `to_char`, an instant as `YYYY-MM-DDTHH:MM:SSZ` in UTC, a
  time as `HH:MM`, a float from its IEEE 754 bits. Rows are read with `raw()`,
  so neither the driver's parsers nor its `transform` option (which renames
  columns and rewrites values, text included) is involved, and neither
  DateStyle, TimeZone nor `extra_float_digits` changes a value.
- **A value formancy's shapes cannot carry is read faithfully, not rounded.**
  An instant with a fraction of a second — anything `now()` wrote — reads as
  `2026-10-08T10:34:56.789012Z`; a time with seconds as `10:30:15.5`; an
  infinite or BC date as `infinity` or `0044-03-15 BC`; a NaN as `NaN`. The
  codec refuses each on the way back, so a form cannot save it unchanged as
  something else. A host that sends every field back on save cannot save such
  a record until the value is changed.
- **Values are bound as text and converted by the server.** Every parameter
  is `$n::text`, then cast to the column's exact type. postgres.js would
  otherwise serialise an untyped parameter through its serializer for the type
  the server inferred, and its boolean serializer turns the text `'true'` into
  false. Row filters, which carry no type, are parsed by each column's own
  input function through `jsonb_populate_record` over the table's row type.
- **Identifiers are quoted one part at a time**, never with the driver's
  `sql(name)`, which splits on dots. A name over 63 bytes is refused: the
  server would truncate it and address another table.
- **The search is literal**: `ILIKE` with `%`, `_` and the escape character
  escaped, over the configured search columns only, through the database's
  default collation — PostgreSQL 17 refuses ILIKE on a nondeterministic
  collation outright. It folds case as that collation does and **does not fold
  accents**: `uber` does not find `Über`, where formancy's own narrowing would.
- **The order is the config's**, NULL placement spelled for every column. Text
  sorts in the column's collation; on `postgres:17-alpine`, whose libc is
  musl, the default `en_US.utf8` orders by code point, exactly like `"C"`.
- **A key with a NULL is never offered**, and a key too long for a token is
  counted in `omitted`. Membership is decided from the keys as the rows hold
  them, so a case-insensitive collation or `char(n)` padding cannot admit a
  token the lookup never offered.
- **An update is one statement**: key, filters and expected version in one
  WHERE, the version column incremented in the same SET. Zero rows, or 40001
  under REPEATABLE READ, is followed by one read that tells `stale` from
  `not-found`, inside the same filters, so another tenant's record is
  `not-found` too.
- **Errors are values.** By SQLSTATE: 23505 and 23P01 `unique-violation`,
  23503 `foreign-key-violation`, 23502 `not-null-violation`, 23514 and a
  trigger's `RAISE` `check-violation`, 22001 and 54000 `too-long`, other class
  22 `out-of-range`, 42501 `permission-denied`, a missing table or column or
  one whose type changed `schema-changed`; anything else the server refuses is
  `unavailable`, because it certainly rolled back. A connection that fails
  before a statement is sent is `unavailable`; after a write was sent it is
  `unknown-outcome` — the tests show such a write committing after the client
  gave up — and it is never retried. A malformed request, filters that say
  nothing, or a syntax error in this adapter's own SQL is thrown.

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
- `spike.integration.test.ts` — the driver's numbers, untyped parameters, and
  the version column.
- `lookups.integration.test.ts` — the lookup port over the fixture: tenant
  filters, literal search, order, NULL and unrepresentable keys, membership,
  the restricted reader, and a driver configured every way it can be.
- `records.integration.test.ts` — the record port over the fixture: every
  edge value and every kind, faithful reads, concurrency between real
  connections, every refusal the fixture can provoke, and a connection cut
  through a TCP hop after a write was sent.

## Licence

Source-available, not open source. See [`LICENSE.md`](./LICENSE.md).
