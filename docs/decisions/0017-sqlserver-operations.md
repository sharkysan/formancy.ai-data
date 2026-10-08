# 0017 — Convert every SQL Server value in SQL, check what a write stored, and translate a refusal by its number

- **Status:** accepted
- **Date:** 2026-10-09
- **Deciders:** Daniel Bacher
- **Verified by:** three suites in `packages/data-sqlserver/src/` against
  `mcr.microsoft.com/mssql/server:2022-latest` loaded with the shared fixture.
  `lookups.integration.test.ts` — a tenant's lookup over `sales.customer`
  offers only its customers and rejects the other tenant's real token; an empty
  restriction is refused and only `unrestricted` reads every row; a search for
  `%`, `_` or `[x]` matches only those characters; NULLs sort where the
  configuration says in either direction; a NULL key is never offered and a
  key too long for a token is counted in `omitted`; `k1:ch` and `k1:A~0020`
  are rejected though the database matches `CH` and `A`; a statement binds
  2098 parameters and 2099 is refused with 8003, and 2500 tokens are answered
  in groups; the restricted reader's lookup over a table it may not read
  throws. `records.integration.test.ts` — every `EDGE_VALUES` value and every
  other kind reads back as its codec spells it; a text filter matches exactly;
  another tenant's record and a missing one are the same `not-found`; the
  reader reads `sales.order` as the owner does and is refused
  `sales.customer`; an insert into `sales.order` returns 2^53 + 2 and
  `draft`; the driver's decimal parameter rounds `1234567890123.4567` and the
  adapter does not; a table with a trigger returns what it inserted; every
  kind is written as it is read back; an insert of no values takes every
  default and leaves no session setting behind, against a positive control in
  a transaction where one stays; two concurrent updates with one version give
  one winner and one `stale`; a malformed or upper-case token is `stale`; an
  update outside the tenant filter is `not-found`; a version column is
  compared and incremented in one statement; an identity that is not a key
  changes nothing and throws; a request no codec could produce throws before
  anything is sent. `records-failures.integration.test.ts` — SQL Server
  stores `ŁA` as `LA`, and the adapter refuses it on insert and `drąft` on
  update; unique (2627 and 2601), foreign key, check, not null, too long (2628, and
  8152 at compatibility level 140), out of range, permission (229 and 230) and
  schema-changed (207, 208) each map to their code; a refusal it does not
  know, and a trigger's THROW of the adapter's own number, are `unavailable`;
  no failure message repeats a value; a German session gets the same codes;
  a closed pool is `unavailable` even for a write; a write whose session is
  killed while it waits, or which times out, is `unknown-outcome` and is not
  retried. Each suite was first run against a naive variant — driver-parsed
  reads, no filters, no escaping, no NULL placement, no grouping, no stored-text
  check, no version in the WHERE, no error translation — and failed on each
  case whose guard the variant lacked. Then each guard was reverted on its own and its
  test watched failing: the LIKE escape, the NULL CASE, `is not null`, the
  filters in the lookup and in the update, the 2098 limit (at 2100, 8003),
  `rowFilterTerms`, membership from the row's key, the search-column check,
  the money conversion, the uuid case, the UTC switch, the stored-text check,
  `OUTPUT … INTO` (334), the version predicate (both writers "win"), the
  `@@rowcount` check, text binding for decimals, the canonical version token,
  DEFAULT VALUES, the key check, the 547 keyword, the `ConnectionError`
  branch, the severity-20 branch, the adapter's own messages, 8152, the
  unique-index name, the out-of-range, schema and permission numbers, the
  exact filter collation, and the message check on the adapter's own error
  number. **Not mechanically enforced:** that a host updates only the fields a
  person changed, which the minute and second spellings below rely on to lose
  nothing stored.

## Context

[0015](0015-a-record-operation-is-one-guarded-statement.md) defines the record
port and [0012](0012-a-lookup-token-is-a-reference-not-a-permission.md) the
lookup port; this is the SQL Server half of both. What follows was measured
against SQL Server 2022 through `mssql` 12 over `tedious` 20, beyond what the
spike (0007) had already found.

**The driver loses values in both directions.** Read, `decimal(18,4)` arrives
as a JavaScript number and `date` as midnight UTC (0007). Written, a
`Decimal(18,4)` parameter goes through a number too: `1234567890123.4567` is
stored as `1234567890123.4568`, and the largest `decimal(18,4)` is refused
with 8023.

**SQL Server stores text it cannot hold without saying so.** nvarchar
converted to a single-byte varchar takes each character's "best fit" or `?`:
`ŁA` becomes `LA`, `中Z` becomes `?Z`, and `drąft` becomes `draft`, which
`ck_order_status` then accepts. 0008 assumed the server would refuse such a
character and the adapter would translate the error; there is no error.

**The engine's own shapes are not formancy's.** `money` converts to text with
two decimals by default; a `uniqueidentifier` prints in upper case; style 126
of a `datetimeoffset` keeps its offset and seven fractional digits.

**The statement shapes have edges.** `OUTPUT` without `INTO` is refused (334)
on a table with an enabled trigger. A request carries at most 2100
parameters, and `sp_executesql`'s own `@stmt` and `@params` are two of them,
so 2098 is what a statement can bind. An ascending order puts NULLs first and
there is no `NULLS LAST`. In LIKE, `%`, `_` and `[` are special. Under the
fixture's `SQL_Latin1_General_CP1_CI_AS`, `=` finds `ACME` for `acme`, and
under every collation it ignores trailing spaces.

**Refusals are numbered, and their messages are not stable.** 547 is a
foreign key, a REFERENCE (a parent row still referenced) and a check alike.
`tedious` asks for `us_english` at login unless the composition root sets
`options.language`; set, the messages are translated. In each of the 34
languages `sys.syslanguages` lists on the 2022 image — checked by hand on
2026-10-09; the suite checks German — 547 keeps the keywords `FOREIGN KEY`,
`REFERENCE` and `CHECK`, while the constraint's quoting varies (`"x"`, `'x'`,
`„x”`, none). Below compatibility level 150 a truncation is
8152, which names no column. The messages repeat values: "The duplicate key
value is (CH)", "Truncated value: 'AB'".

**A connection can fail on either side of a write.** A closed pool raises
`ConnectionError` before anything is sent. A session killed while its write
waits on a lock gets 596 at severity 21; a request timeout gets `ETIMEOUT`
with no number.

## Decision

**Out of the database, the server converts every value to the text of its
canonical API value** (`src/sql/values.ts`): integers as decimal strings,
decimals through `decimal(p, s)` so `money` keeps four places, booleans as
`1`/`0` made `true`/`false`, floats in style 3, dates `YYYY-MM-DD`, times
`HH:MM`, instants switched to UTC as `YYYY-MM-DDTHH:MM:SSZ`, zoneless
timestamps `YYYY-MM-DDTHH:MM:SS`, UUIDs lower-cased. A rowversion comes back
as its 8 bytes and is spelled by `encodeRowversion`. A lookup's display
columns are spelled by style 126, because the configuration does not carry
their types.

**Into the database, every value travels as nvarchar text and is converted by
the server** to the column's type — `convert(decimal(18, 4), @p3)` — except a
boolean (bit), a float (float) and a rowversion token (varbinary(8)). A value
of the wrong JavaScript type, a column kind with no canonical value, a key
that is not the identity or a column named twice is a programming error,
thrown before anything is sent.

**Every write is one batch:** `xact_abort`, a transaction, the one guarded
statement with `OUTPUT … INTO` a table variable, a check that each text column
stored exactly the text it was sent (compared under `Latin1_General_100_BIN2`),
for an update a rollback if more than one row matched, and the commit. A
difference in stored text is `out-of-range`, naming the column. An update's
WHERE holds the key, the trusted filters and the expected version, and a
version column is incremented in the same SET; nothing matched is followed by
one query that tells `stale` from `not-found`. A token that is not what a read
returns — upper-case hex, `01` — is never bound and gets the same answer.

**Row filters compare exactly**, under the binary collation, not the column's:
the tenant `acme` does not read `ACME`'s rows.

**Lookups** escape `\`, `%`, `_` and `[` in a LIKE over the search columns;
place NULLs with a `CASE` before each sort column; never offer a key with a
NULL; apply the filters in the same WHERE; ask for keys as a table value
constructor under EXISTS, in groups of 2098 parameters; and decide everything
else with `@formancy/data-core`'s helpers.

**A refusal is translated by its number** (`src/records/errors.ts`): 2627/2601
`unique-violation`, 547 by the kind its message names, 515
`not-null-violation`, 2628/8152 `too-long`, the conversion and overflow
numbers `out-of-range`, 229/230 `permission-denied`, 207/208
`schema-changed`. A constraint or column is named from an English message
only. Every message is the adapter's own sentence. A number it does not know
is `unavailable`. A `ConnectionError` is `unavailable` even for a write; any
other driver failure, or a refusal at severity 20 or more, is
`unknown-outcome` after a write and `unavailable` after a read, and is never
retried.

## Consequences

**What it buys.** Every edge value and every kind round-trips digit for digit,
whatever the driver's defaults. A varchar cannot quietly keep a code nobody
entered. A stale save is refused even when two of them race inside the server.
Another tenant's record is indistinguishable from a missing one, in a lookup
and in a write. A failure has the same code in any session language, and its
message can be logged. The adapter's behaviour is what the suites show on a
real server, not what a mock was told.

**What it costs.** Every SELECT list is engine-specific SQL, and converting in
SQL is slower than letting the driver parse. Every write is a transaction, a
table variable and a comparison per text value, all for a defect only a
single-byte varchar has, because a `RecordColumn` cannot say which columns
are varchar. Binding text as nvarchar against a varchar key or filter column
makes the server convert the column, which under a SQL collation means a scan
rather than a seek; and an exact filter on a text column cannot seek an index
whose collation is not binary. Formancy's shapes are narrower than SQL
Server's types, and the read says so only here: a time is cut to the minute
and an instant to the second (`created_at` defaults to
`sysdatetimeoffset()`, so every read of it drops a fraction), and a host that
writes back an unedited value writes the shorter one. A `real` reads as the
double its 32 bits are, so `0.1` written comes back `0.10000000149011612`. A
zoneless timestamp has no codec, so its spelling is this adapter's alone; a
display column that is a bit, a uuid or a timestamp is labelled in style 126,
not canonically. `returning` is the row as the statement wrote it, before an
AFTER trigger changed it. Keys asked about in groups are several reads, not
one. An unknown refusal reported as `unavailable` invites a retry that will be
refused again. A constraint or column is named only in English, and in a
translated session a 547 whose constraint name holds the other kind's keyword
as a word of its own would be misread. The batch's error numbers 51701 and
51702 are anybody's; a trigger that throws one with another message is an
unknown refusal, and one that throws it with the adapter's exact message would
be misread. Everything here was measured on SQL Server 2022 alone, which is
the supported matrix (0003).

**What it forecloses.** The driver's typed parameters for exact values, a bare
`OUTPUT`, a filter compared by collation, and any retry of a write.

## Alternatives considered

**Let the driver parse and bind with typed parameters.** Rejected: measured
lossy in both directions, and silently so for most values.

**Bind a varchar column's value as varchar.** Not possible from the request,
which does not say which text columns are varchar; and `tedious` would encode
it on the client with the same substitution. Querying the catalog for column
types on every write was rejected as a second source of metadata beside the
approved snapshot.

**`SET LANGUAGE us_english` at the top of every batch,** so every message
parses. Rejected: it changes session behaviour the composition root chose,
errors raised while compiling precede it, and the codes do not need it.

**Look up a 547 constraint's type in `sys.objects`.** Rejected: a second round
trip on the failure path, and a REFERENCE constraint on a table the account
cannot see is invisible to it, which the keyword is not.

**Compare filters by the column's collation,** as every constraint on the
column does. Rejected: it widens what a trusted value matches, and narrower is
the side to fail on; it is also where PostgreSQL's default would disagree.

**Split at 2100 parameters, as the message says.** Rejected on the
measurement: 2099 is refused.

**Key lists as OR'd tuples or a JOIN.** Rejected: an OR per key is a plan the
optimiser handles badly at thousands, and a JOIN returns a row once per key
the database finds equal to it, where EXISTS returns it once.

**Retry a write after a deadlock or a dropped connection.** Rejected (0015):
after a write was sent its outcome is unknown, and only the host can
reconcile it.
