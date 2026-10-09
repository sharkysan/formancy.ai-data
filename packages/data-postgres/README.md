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
await adapter.ping() // { kind: 'postgres', version: '17.6' }

const snapshot = await adapter.discover({ schemas: ['sales'] })
snapshot.account // { user, login }: current_user and session_user
snapshot.objects // tables and views, with columns, keys, foreign keys, checks, comments,
//                  what the account may do with each column, and whether row security applies to it
snapshot.gaps // what this release could not describe: a foreign table
snapshot.fingerprint // changes when the structure, the account's privileges, or the account changes

const lookups = createPostgresLookups(sql) // LookupAdapter: search, resolve, rejects
const records = createPostgresRecords(sql) // RecordAdapter: read, insert, update
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
- **A value formancy's shapes cannot carry is read faithfully, not rounded.**
  An instant with a fraction of a second — anything `now()` wrote — reads as
  `2026-10-08T10:34:56.789012Z`; a time with seconds as `10:30:15.5`; an
  infinite or BC date as `infinity` or `0044-03-15 BC`; a NaN as `NaN`. The
  codec refuses each on the way back, so a form cannot save it unchanged as
  something else. A host that sends every field back on save cannot save such
  a record until the value is changed.
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
- **The order is the config's**, NULL placement spelled for every column. Text
  sorts in the column's collation; on `postgres:17-alpine`, whose libc is
  musl, as observed on 2026-10-09, the default `en_US.utf8` orders by code
  point, exactly like `"C"`.
- **A key with a NULL is never offered**, and a key too long for a token is
  counted in `omitted`. Membership is decided from the keys as the rows hold
  them, so a case-insensitive collation or `char(n)` padding cannot admit a
  token the lookup never offered.
- **An update is one statement**: key, filters and expected version in one
  WHERE, the version column incremented in the same SET. Zero rows, or 40001
  under REPEATABLE READ, is followed by one read that tells `stale` from
  `not-found`, inside the same filters, so another tenant's record is
  `not-found` too. A record still at the version sent was declined by the
  database itself — a BEFORE trigger returning NULL, a rule, a row security
  policy — and is `refused`, not `stale`; so is an insert the server
  completed as `INSERT 0 0`.
- **Errors are values.** By SQLSTATE: 23505 and 23P01 `unique-violation`,
  23503 `foreign-key-violation`, 23502 `not-null-violation`, other class 23
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
- The only gap a PostgreSQL snapshot carries is a **foreign table**, which
  this release does not describe, named as the gap's subject.

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
every schema name is a bound parameter.

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
skips only the rows already there. A stored generated column is `computed`
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

The suites start `postgres:17-alpine` unless a test names another image, through `postgres` 3.4.9 (published as `^3.4.9`).

<!-- end generated -->

- `adapter.integration.test.ts` — ping and close, including a close after a
  connection was cut mid-statement, which returns, and one with a statement
  still running, which lets it answer.
- `discovery.integration.test.ts` — the shared model as the owner, the
  restricted reader's rule and its grants, privileges short of a whole
  table, the scope, the fingerprint, and a check added NOT VALID read as
  enforced and not validated.
- `discovery-access.integration.test.ts` — the writer's grants through its
  role, every reported capability checked against the statement the server
  runs or refuses (as the owner, the reader and the writer), a session role
  and an `INHERIT FALSE` membership, row security for the owner with and
  without `FORCE` and for a `BYPASSRLS` role, and what the record operations
  do with both: a `serial` create refused, a hidden row `not-found`.
- `discovery-types.integration.test.ts` and
  `discovery-shapes.integration.test.ts` — the map from each type to the
  contract, the two identities and a sequence default, the shapes only
  PostgreSQL has, declared in schemas of their own, and what a text length
  counts in a SQL_ASCII and a LATIN1 database, each made for the test.
- `discovery-pg18.integration.test.ts` — the one catalog fact 18 adds: a
  `NOT ENFORCED` check, on `postgres:18-alpine`, reported as not enforced.
- `discovery/columns.test.ts` — the generation codes, including one no server
  can produce yet, called directly.
- `spike.integration.test.ts` — the driver's numbers, untyped parameters, and
  the version column.
- `lookups.integration.test.ts` — the lookup port over the fixture: tenant
  filters, literal search, order, NULL and unrepresentable keys, membership,
  the restricted reader, a driver configured every way it can be, and
  objects planted on the search path.
- `parity.integration.test.ts` — the cases 0028 holds both engines to, from
  `@formancy/data-fixtures`, over its `parity` schema: every row filter in a
  lookup's page, resolve and membership, a read and an update; the filter
  served by the primary key, and unchanged by a planted `public."C"` and
  `public.bpchar`; an unconstrained `numeric` filter; every label under an
  unusual TimeZone, DateStyle and float digits, which the test reads back
  from the session first — postgres.js drops a startup parameter whose value
  is falsy, and `extra_float_digits: 0` had never arrived; and every refusal, a
  deadlock victim, the timeouts and a terminated backend included.
- `records.integration.test.ts` — the record port over the fixture: every
  edge value and every kind, the shared shipment rows and the column facts
  both engines are held to (a length in characters, a `real`'s canonical
  value against PostgreSQL's own text, the zoneless spelling, why a
  by-default identity stays read-only, and the U+FFFD an unpaired surrogate
  would silently become),
  faithful reads, concurrency between real
  connections, every refusal the fixture can provoke, writes a trigger or a
  rule declines, objects planted on the search path, and a connection cut
  through a TCP hop after a write was sent.
- `records-lost-answer.integration.test.ts` — an insert and an update whose
  answer the hop drops after the commit, counted at the wire; a deferred
  unique constraint refused after the row was sent, with and without the
  answer lost; and a statement timed out while it waits on a lock.

## Licence

Source-available, not open source. See [`LICENSE.md`](./LICENSE.md).
