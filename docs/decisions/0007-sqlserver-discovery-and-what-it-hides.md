# 0007 — Discover SQL Server from its catalog views, and name each thing they hide

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-sqlserver/src/discovery.integration.test.ts`
  against `mcr.microsoft.com/mssql/server:2022-latest` — the owner's snapshot
  has no disagreements with the fixture model; the restricted reader's passes
  `restrictedDisagreements` and carries exactly six gaps — the schema, the
  check, the default and three foreign keys; a
  foreign key whose target is hidden is reported with an unknown target; a
  hidden alias type is reported by its base type with a gap; a schema the
  reader holds nothing in gets a gap and a schema that does not exist does
  not; `VIEW DEFINITION` on the schema alone sees everything the owner sees; a
  table denied `VIEW DEFINITION` under that grant produces a gap, whether the
  `DENY` is made to the account or to a role it is in, and so does a table
  denied `CONTROL`; every type named below normalises as stated; the scope is
  bound as parameters, matched by collation, and an empty one reads nothing.
  `packages/data-sqlserver/src/spike.integration.test.ts` — what the driver
  returns for `bigint`, `decimal(18,4)` and `date` by default, the lossless
  read, the id binding, what a text length counts, and `rowversion`
  concurrency between two connections. The gaps, the left joins, the key
  orderings, the scope binding and matching, the role and `CONTROL` terms of
  the denied-object count, and the token in the update were each reverted once
  and their tests watched fail. That every snapshot is built through
  `createSnapshot` is held by review, as in 0004.

## Context

[0004](0004-a-snapshot-says-what-it-could-not-see.md) requires a snapshot to
carry what its connection could not establish, and says SQL Server will make
that "real work", because whether a definition is hidden has to be inferred
from a `NULL`. The plan's phase-1 gate asks for restricted metadata to be
demonstrated. What follows was found by asking a SQL Server 2022 container as
`formancy_reader`, who may select from `sales.order` and nothing else, and as
accounts made for the purpose in the tests.

**What the reader sees of `sales.order`.** All of it except definitions: every
column, its type, nullability, identity and `rowversion`, the primary key, the
comment. `sys.default_constraints` and `sys.check_constraints` list
`df_order_status` and `ck_order_status`, with `definition` `NULL`.

**What the reader sees of `fk_order_customer`**, whose target `sales.customer`
it may not read: the row in `sys.foreign_keys`, with its flags and actions, and
its own columns in `constraint_column_id` order. `referenced_object_id` is
populated; `OBJECT_NAME` of it is `NULL`, and so is `COL_NAME` of every
referenced column. The same holds for `fk_order_created_by` and
`fk_order_approved_by`, because the reader cannot see `sales.employee`
either. An inner join to the target would drop all three keys.

**What else the catalog does.** `sys.objects` lists only what the account holds
a permission on, silently. `sys.schemas` is not filtered: every schema is
listed. `sys.columns` lists every column of a visible table, including one
the account is denied `SELECT` on. A user-defined type is a securable of its
own: an account may read a table and get `NULL` for the type of one of its
columns, while the column's `system_type_id` still names the base type. Comments
are visible with their object. `HAS_PERMS_BY_NAME` parses the name it is given
and returns `NULL` for `it's [odd]` unless it is quoted. And `VIEW DEFINITION`
on the schema lifts all of it without any data access — except that a
`DENY VIEW DEFINITION` on one table removes that table from `sys.objects` while
`HAS_PERMS_BY_NAME` on the schema still says 1. So does a `DENY CONTROL`, which
implies it. The account can read its own `DENY` rows and those made to a role
it is in, but not the denied object's name or schema.

**What the catalog says about types**, in bytes and synonyms: `nvarchar(200)`
is 400 and `nvarchar(max)` is -1; `float(24)` is catalogued as `real`;
`rowversion` as `timestamp`; `geography`'s `system_type_id` is 240, which names
no row in `sys.types`; a period column is `generated_always_type` 1 or 2.
`datetime` is scale 3 and keeps 1/300 s; `smalldatetime` is scale 0 and keeps
whole minutes. Check expressions come back rewritten:
`status in ('draft', 'placed', 'shipped')` is stored as
`([status]='shipped' OR [status]='placed' OR [status]='draft')`.

## Decision

**`discoverSqlServer(pool, scope)`, beside the adapter**, reads the catalog
views — `sys.objects`, `sys.columns`, `sys.types`, `sys.key_constraints` with
`sys.index_columns` by `key_ordinal`, `sys.foreign_keys` with
`sys.foreign_key_columns` by `constraint_column_id`, `sys.check_constraints`,
`sys.extended_properties`, `OBJECT_DEFINITION` for defaults — one concern per
file in `src/discovery/`, and builds the result with `createSnapshot` only.
Every join to something the account might not see is a `LEFT` join. It is not
on the `DatabaseAdapter` port until the PostgreSQL adapter has its
counterpart and both can shape it.

**Each blind spot is a gap**, observed rather than predicted:

| Aspect | When | What the snapshot says |
|---|---|---|
| `objects` (scope) | the account lacks `VIEW DEFINITION` on a scope schema | the list may be short |
| `objects` (scope) | the account is denied `VIEW DEFINITION` or `CONTROL` on objects it cannot name | how many, and that any may be in scope |
| `foreign-keys` | the target's name or columns are `NULL` | the key, with `references: null` |
| `checks` | the definition is `NULL` | the check, with `expression: null` |
| `defaults` | the definition is `NULL` | `hasDefault: true`, `defaultExpression: null` |
| `columns` | the declared type is hidden | the base type, spelled as such |

A schema that does not exist needs no gap, because `sys.schemas` is not
filtered. **The minimum privilege for complete discovery is `VIEW DEFINITION`
on each schema in scope**, and no data access.

**Types normalise from the system type** behind `system_type_id`, so a hidden
alias still has a meaning: lengths in the unit the type counts (UTF-16 code
units for `nchar`/`nvarchar`, bytes for `char`/`varchar`, -1 as `null`); exact
integer ranges; `bit` boolean; `decimal`/`numeric` with precision and scale,
and `money`/`smallmoney` as the catalog's 19,4 and 10,4; `float` 64 bits and
`real` 32; `time`, `datetime2`, `datetimeoffset`, `datetime` and
`smalldatetime` with **the catalog's scale as their precision** — 3 and 0 for
the last two; `uniqueidentifier` uuid; `binary`/`varbinary`; `rowversion`.
`xml`, `sql_variant`, the CLR types and the deprecated `text`, `ntext` and
`image` are `unsupported`. Identity, computed, `rowversion` and period columns
are generated — a period column as `computed`, because an insert that names it
is refused.

**The scope is bound, one parameter per schema, as `nvarchar(max)`, and
matched by the database's collation.** On a case-insensitive database `SALES`
finds `sales`, and objects carry the catalog's spelling.

## Consequences

**What it buys.** The restricted reader gets a usable, honest snapshot of
`sales.order`: everything it can see, and six sentences for what it cannot —
the schema may hold more, the check and the default are unreadable, and each
of three foreign keys points somewhere it cannot name. "No relationship" never
appears where the truth is "cannot tell". A customer can be told the one grant
discovery needs, and that it is not a grant on their data.

**What it costs.** The gaps over-report. The denied-object count is not
scoped, so a `DENY` on a table in another schema puts a gap in every snapshot;
a schema where the account has `SELECT` on everything, and therefore sees
everything, still gets the `objects` gap, because only `VIEW DEFINITION` is
taken as proof. The temporal precisions overstate two types: a form told
`datetime` has three digits will accept `.001`, which the server stores as
`.000`, and one told `smalldatetime` keeps seconds will see them rounded to
the minute — a silent change, which the contract has no variant to prevent.
`varchar(n)` under a UTF-8 collation is reported as `n` though it holds `n`
bytes, and `money` as a `decimal(19,4)` whose upper part it cannot hold; both
are refused by the server, loudly. A disabled check and a `WITH NOCHECK` one
read the same, `validated: false`, because the contract's check has no
`enforced`. Discovery is seven queries side by side, not one consistent read:
a concurrent `ALTER` can tear it. Everything here was found on SQL Server
2022, and the supported matrix is that image; the queries name catalog columns
an older release may not have.

**What it forecloses.** `INFORMATION_SCHEMA` for discovery, and inner joins to
anything an account might not see. Splicing a schema name into catalog SQL.

## Alternatives considered

**Ask `HAS_PERMS_BY_NAME` per object whether its definitions are visible.**
Rejected: a check and a default always have a definition, so `NULL` is the
direct observation of the hiding, and a second question about permissions is a
second answer that can disagree with what was actually returned.

**Match the scope by exact spelling, as PostgreSQL's catalog does.** Rejected:
on a case-insensitive database, `SALES` names a schema the database resolves,
and reporting it absent would be the silent answer 0004 forbids.

**Report `datetime` as precision 2, the most digits every value keeps
exactly.** Rejected: a stored `.003` would then be shown and saved as `.00`,
changing a value nobody edited. The catalog's scale is the digits the server
writes, and existing values survive it; the cost paragraph says what it lets
in.

**Read everything in one batch or one snapshot transaction.** Rejected for now:
a batch is no more atomic than parallel queries under read committed, and
snapshot isolation is off by default and has its own rules for metadata. The
torn read is named rather than half-solved.

**Map `money` and the deprecated LOB types the other way round** — `money` as
unsupported, `text` and `ntext` as text. Rejected: `money` is an exact
fixed-point type the catalog describes as 19,4, while `text` and `ntext` cannot
be compared and are on their way out, so a form should not be built on them.
