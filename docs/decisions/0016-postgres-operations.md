# 0016 — Convert every PostgreSQL value on the server, bind it as text, and never let the driver's configuration decide an answer

- **Status:** accepted
- **Date:** 2026-10-09
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-postgres/src/lookups.integration.test.ts` and
  `packages/data-postgres/src/records.integration.test.ts`, against
  `postgres:17-alpine` loaded with the shared fixture, as its owner and as
  `formancy_reader`. Lookups: *offers only the tenant's own customers*,
  *rejects another tenant's token for a customer that exists*, *filters that
  say nothing are refused before the database is asked*, *matches '%', '_'
  and '[' as the characters themselves*, *matches the configured search
  columns and no others*, *folds case … and not accents*, *searches a column
  whose collation is nondeterministic*, *follows the config's total order,
  NULLs where it says*, *never offers a row whose key holds a NULL, and does
  not count it*, *counts a row whose key cannot fit in a token*, *rejects a
  token spelled differently from the row the database matched*, *offers,
  resolves and accepts a bigint key past 2^53 exactly, as the restricted
  reader*, *throws when the database refuses the account*, *asks the database
  nothing when no token can name a row*, *refuses an order it cannot spell*,
  *a filter on a boolean column selects the rows it names*, *names, values,
  parsers, DateStyle and TimeZone do not change an answer*. Records: *reads
  every edge value of the fixture back exactly*, *reads every kind as the
  value its codec would return*, *reads a value the canonical shapes cannot
  carry faithfully*, *reads the same values however the driver and the
  session are configured*, *reads a real as the shortest decimal PostgreSQL
  itself prints for it*, *a record outside the filters is not-found*, *quotes
  a table name holding a dot and a column name holding quotes*, *refuses a
  name PostgreSQL would truncate into another table*, *an insert into
  sales.order returns its identity, its default status and its first
  version*, *an insert of no values writes every default*, *of two concurrent
  updates with the same version, one wins and the other is stale*, *a lost
  race under REPEATABLE READ is stale too*, *an update outside the tenant
  filter is not-found and changes nothing*, every case in *what a refusal is
  called* and in *requests no binding produces*, the read in *a connection
  lost during a read*, and the three cases of *a connection lost after a
  write was sent*. `packages/data-postgres/src/spike.integration.test.ts`,
  *binding a value the driver did not type*, keeps the serializer behaviour
  below as a characterisation. The suites were first run against a
  deliberately naive implementation — `::text` reads, untyped parameters, an
  unescaped ILIKE, every connection error `unavailable` — and every case
  aimed at one of those failed on its assertion; the NULL-key case passed for
  the wrong reason (the core counted the NULL key as `omitted`) and was
  tightened until it failed. Then each guard listed under *Consequences* was
  reverted once on the finished code and its test watched failing. Two tests
  first passed under their revert without testing anything — the
  configured-driver read compared two `not-found` answers when run alone, and
  the search-columns case displayed exactly what it searched — and were
  rewritten until the revert failed them.

## Context

[0015](0015-a-record-operation-is-one-guarded-statement.md) set the contract:
canonical text in, canonical text out, converted in SQL and never by the
driver; one guarded statement per write; errors as values; an ambiguous write
never retried. [0012](0012-a-lookup-token-is-a-reference-not-a-permission.md)
set the lookup half. The phase-1 spike ([0006](0006-postgres-discovery-reads-pg-catalog.md))
had concluded that a `::text` cast is the read path "no parser configuration
can reach". Building both halves against the fixture showed that is true of
postgres.js's *parsers* and of nothing else the composition root controls:

- **`transform`** renames result columns (`postgres.camel` turns `the_id` into
  `theId`) and rewrites every value after parsing, text included. A `::text`
  column read by name is at its mercy.
- **Session settings** change the server's own text. `date::text` is
  `08/10/2026` under `DateStyle = 'SQL, DMY'`, `timestamptz::text` follows
  `TimeZone`, and a float's text follows `extra_float_digits`: at `0`,
  `0.1 + 0.2` reads as `0.3`. `to_char` ignores DateStyle but drops the era —
  44 BC reads as `0044-03-15` — and returns NULL for `infinity`.
- **Untyped parameters** are worse than parsers. postgres.js sends a statement
  with untyped parameters as Parse and Describe, then serialises each value with
  its serializer for the type the server inferred. Its boolean serializer
  writes `'t'` only for the JavaScript `true`, so the text `'true'` becomes
  `'f'`: a row filter of `active = 'true'` selected the inactive rows, and an
  insert of `true` wrote false. Its date serializer is `new Date(value)`, which
  throws on `infinity`.
- **Identifiers** longer than 63 bytes are truncated by the server with only a
  NOTICE; a 64-byte table name read the table named by its first 63 bytes.
- **Collation.** PostgreSQL 17 refuses LIKE and ILIKE outright on a column
  with a nondeterministic collation (SQLSTATE 0A000), and a `::text` cast keeps
  the column's collation, so the cast does not help. Under a case-insensitive
  collation `IN ('acme')` matches `ACME`, and `char(3)` matches `'AB '` to
  `'AB'`. And `postgres:17-alpine`'s default `en_US.utf8` orders text by code
  point, exactly like `"C"`, because musl has no collation tables.
- **The shapes.** formancy's instant has whole seconds and its time has
  minutes. `now()`, the default of the fixture's own `customer.created_at`,
  writes microseconds; `time` keeps them too; a `date` can be `infinity` or BC.
- **A lost connection.** Through a TCP hop cut while an update waited on a row
  lock, the driver reported `CONNECTION_CLOSED`, and the orphaned update
  committed when the lock was released. The same cut while an insert waited on
  a table lock wrote nothing, because the lock was taken while the server was
  still parsing — before postgres.js had sent the values. The client cannot
  tell the two apart.

## Decision

`createPostgresLookups(sql)` and `createPostgresRecords(sql)` implement
`LookupAdapter` and `RecordAdapter` on a driver the composition root
connected, and assume nothing about how it was configured.

**Read as text the server wrote, by position.** Every column is converted in
SQL to the text `codecFor(column).parse` would return: integers, decimals,
uuids and text as their own output; booleans as `true`/`false`; dates and
timestamps with `to_char`, instants first moved with `at time zone 'UTC'`;
floats as their IEEE 754 bits in hex, decoded exactly. Rows are read with
`raw()`, as bytes by position, so no `transform`, parser or column name is
involved. A value the canonical shapes cannot carry — a fraction of a second,
a time with seconds, `infinity`, a BC or five-digit year, a NaN — is read in a
faithful spelling the codec refuses (`2026-10-08T10:34:56.789012Z`,
`0044-03-15 BC`), never rounded into the shape and never NULL, so it is shown
and cannot be written back as something else.

**Bind as text the server converts.** Every placeholder is `$n::text`, so the
driver only ever serialises text; a typed value becomes `$n::text::bigint`,
`::numeric`, `::bpchar`, `::date` and so on, named exactly from its normalised
type so the comparison can use the column's index. Row filters carry no type,
so each term's text is parsed by the column's own input function through
`jsonb_populate_record(null::<table>, …)` over the table's row type, one record
per term, and compared column to column.

**Quote identifiers one part at a time**, doubling quotes, and refuse one over
63 bytes, or empty, or holding NUL, as a programming error.

**Lookups.** The search is `ILIKE` through the database's default collation,
with `!` as the escape character (`\` is not a one-character literal when
`standard_conforming_strings` is off) and `!`, `%`, `_` escaped. Only the
config's search columns are searched; a key with a NULL component is excluded
in SQL; the order is the config's, each NULL placement spelled; one row more
than the page is fetched. Keys are read as canonical text and display columns,
whose types the config does not carry, through `to_jsonb(…) #>> '{}'`, which
spells dates in ISO 8601 whatever DateStyle says. Membership and labels are the
core's helpers, from the keys as the rows hold them. A database error is
thrown.

**Records.** An update is one statement: key, filters and expected version in
one WHERE, the version column incremented in the same SET. Zero rows, or
SQLSTATE 40001, is followed by one read inside the same filters that tells
`stale` from `not-found`. An expected version that is not a decimal number is
answered the same way without being bound. Errors map by SQLSTATE, then by
class: 22 is `out-of-range`, 23 and P0 (a trigger's `RAISE`) `check-violation`,
54000 `too-long`, 23P01 `unique-violation`, 42P01/42703/428C9/42883/42804
`schema-changed`; anything else the server sends is `unavailable`, because it
ended the statement and its implicit transaction rolled back; class 42
otherwise is the adapter's own SQL and is thrown. A connection error before
sending is `unavailable`; after sending, a write is `unknown-outcome` and is
not retried. A request that sets the version column or a filter column, sets
nothing, names a key that is not the identity, or carries a value of the
wrong shape for its kind — a decimal or an integer as a JavaScript number, a
boolean as text — is thrown before anything is sent; so is an identity that
turns out to match several rows on a read, and an order direction the
adapter cannot spell, which is looked up in a `Map` because every object
literal has a `constructor`.

## Consequences

**What it buys.** No setting the composition root can choose — parsers,
transforms, DateStyle, TimeZone, `extra_float_digits`,
`default_transaction_isolation` — changes a value, a filter or an answer; the
tests run drivers with each of them changed beside a default one.
A boolean filter means what the policy said. The fixture's edge values round
trip exactly, as the restricted reader too. A tenant cannot see, resolve or
write another tenant's record, and gets the same `not-found` for it as for a
record that does not exist. A lost connection after a write is reported as
what it is.

**What it costs.** The SQL is longer and less familiar than the obvious
version: a `CASE` per date or timestamp column, a `jsonb_populate_record` per
filter term, `$n::text::bigint` everywhere, hex for floats. Somebody reading a
statement in `pg_stat_statements` has to know why. A value outside formancy's
shapes reaches the form as text its field refuses — every row whose
`created_at` came from `now()` — so a host that sends every field back on save
cannot save that record until the person changes the value; that is friction
chosen over truncating a timestamp nobody edited, and the generator does not
yet mark such columns read-only. Search folds case but not accents, where
formancy's own narrowing folds both, and it folds through the database's
default collation rather than the column's own. Text sorts in the column's
collation, which on this image is code point order: the same data on a glibc
image orders differently. A label's instant is spelled in the session's
TimeZone — `2026-10-09T01:45:00+13:45` under Pacific/Chatham — because
`to_jsonb` uses it and the config carries no display types to do better.
`unknown-outcome` over-reports: a cut while the server is still parsing wrote
nothing and is reported the same way, because the client cannot tell. Any
server refusal without a specific code is `unavailable`, which is true about
the outcome and vague about the cause — a broken trigger in class 38 or 39
reads as a database that could not answer. 40003 is mapped to
`unknown-outcome` and 23001 to `foreign-key-violation` without a test that
provokes them. The update trusts that the identity is a key, as the generator
guarantees: an identity that is not unique would change every matching row,
and the adapter throws afterwards rather than before. 63 bytes is the default
build's limit; a server compiled with a larger `NAMEDATALEN` has names this
adapter refuses. Nothing bounds how many tokens a `resolve` or `rejects` is
handed: past 65,533 parameters, key values and filters together,
postgres.js throws `MAX_PARAMETERS_EXCEEDED` itself, which fails closed but
not gracefully. Everything here was found on PostgreSQL 17 and postgres.js
3.4.

Each guard was reverted once and its test watched failing: the LIKE escape,
the default collation, the NULL-key condition, search over the search columns
only, NULL placement, membership from the row's key and not the token's, typed
filters, the filters at all, positional raw reading, typed binds, `to_char` for
dates, the era for out-of-range dates, the fraction of an instant, floats as
bits and the ninth digit of a real, the identifier length, the version in the
WHERE, the version increment, 40001 as stale, the version's shape, the
filter-column check, the value-shape check, the several-rows check, the
order table as a `Map` (as an object literal it spliced `function Object()`
into the ORDER BY), the raw-value check, unknown-outcome for writes and
unavailable for reads, class 42 thrown, and the trigger, data-exception,
exclusion, index-size and changed-type mappings.

**What it forecloses.** The driver's `sql(identifier)` helper, untyped
parameters, reading a value by column name, and session settings changed by
the adapter on a pooled connection it does not own.

## Alternatives considered

**`::text` for everything, read by name**, as the spike suggested. Rejected
on the measurements above: `transform` reaches it, and DateStyle changes it.

**Configure the driver's parsers, or set the session.** Rejected: the driver
is the composition root's (CLAUDE.md, "Secrets and identifiers"), and a `SET`
on a pooled connection changes it for whoever uses it next. `SET LOCAL` would
need a transaction around every statement.

**Untyped parameters, letting the server infer.** The idiomatic postgres.js
spelling, and the one that inverted a boolean filter.

**Filters as `column::text = $n::text`.** Immune to the driver and simple, and
it defeats the index on the tenant column: a lookup listing one tenant's
customers would scan every tenant's.

**Truncate a fractional instant to the shape, or refuse the read.** Truncating
writes the truncated value over the real one on the next save. Refusing makes
every record whose timestamp came from `now()` unreadable, and the contract has
no code for it.

**Escape LIKE with a backslash.** The textbook spelling, and a syntax error
under `standard_conforming_strings = off`.

**Map every unrecognised server error to a thrown exception.** Rejected: the
contract says a database error is a value, and every server error in an
implicit transaction is one that certainly did not commit. Class 42 is the
exception, because there the adapter's SQL is what is wrong.

**Check the row count inside a transaction and roll back when the identity
matched more than one row.** Rejected for now: three round trips per update to
guard against bindings the generator does not produce.
