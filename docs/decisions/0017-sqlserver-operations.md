# 0017 — Convert every SQL Server value in SQL, check what a write stored, and translate a refusal by its number

- **Status:** accepted; `real` and zoneless timestamp reads narrowed by [0026](0026-name-every-column-fact-the-engines-disagree-on.md); the refusals translated by number extended by [0027](0027-a-snapshot-says-what-its-account-may-do.md): a block predicate's 33504 is `permission-denied`; narrowed by [0028](0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md): a filter also compares `datalength`, `char(n)` reads unpadded, labels are read by the record reader, and a number from 50000 or none on the allowlist is `refused`; extended by [0031](0031-an-answer-lost-after-a-write-is-unknown.md): the `RequestError` wrapping is tested for a socket cut and a timeout; and narrowed by it: a trigger that ends the write's transaction and then raises an error is `unknown-outcome`, no longer the refusal it raised; and narrowed by [0040](0040-instants-and-times-are-read-to-the-shape-and-an-unedited-one-is-never-written.md): the planner removes an unedited instant or time from an update, so a host that writes every field back no longer writes the shorter value
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
  throws; a sort direction that is neither `asc` nor `desc` is refused and
  its injected insert does not run. `records.integration.test.ts` — every
  `EDGE_VALUES` value and every other kind reads back as its codec spells it;
  a text and a decimal column widened since discovery read back exactly; a
  tampered decimal precision is refused and its injected insert does not
  run, and every precision or scale SQL Server's syntax would not take is
  thrown before anything is sent; a text filter matches exactly;
  another tenant's record and a missing one are the same `not-found`; the
  reader reads `sales.order` as the owner does and is refused
  `sales.customer`; an insert into `sales.order` returns 2^53 + 2 and
  `draft`; the driver's decimal parameter rounds `1234567890123.4567` and the
  adapter does not; a table with a trigger returns what it inserted; every
  kind is written as it is read back; an insert of no values takes every
  default and leaves no session setting behind, against a positive control in
  a transaction where one stays; two concurrent updates with one version give
  one winner and one `stale`, for a rowversion and for a version column; a
  malformed or upper-case token is `stale`; an update outside the tenant
  filter is `not-found`; a version column is compared and incremented, and
  stale once anyone saved; the version an insert and an
  update return, on rows an AFTER trigger touches again — keyed by a
  generated identity and by text under a binary collation — and on a version
  column a trigger also moves, is the one the next save names; a row keyed
  by a time that reads as another row's key, and one inserted with no
  identity, keep the version their statement saw; an identity that is not a
  key changes nothing and throws; a request no codec could produce throws
  before anything is sent.
  `records-failures.integration.test.ts` — SQL Server stores `ŁA` as `LA`,
  and the adapter refuses it on insert and `drąft` on update; unique (2627
  and 2601), foreign key, check, not null, too long (2628, and 8152 at
  compatibility level 140), out of range, permission (229 and 230) and
  schema-changed (207, 208) each map to their code; a foreign key to its own
  table names its constraint whichever way it is broken; a refusal it does
  not know, and a trigger's THROW of the adapter's own number, are
  `unavailable`; a trigger's RAISERROR without a rollback is `unavailable`
  and its insert and update write nothing; an account granted INSERT and
  UPDATE without SELECT is refused a write that the same account with SELECT
  makes; an insert and an update an enabled INSTEAD OF trigger decides are
  refused and store nothing, an INSTEAD OF trigger for another operation or
  a disabled one leaves an insert alone, and an account denied VIEW
  DEFINITION on the table is refused; a trigger that ends the write's
  transaction and begins another, by ROLLBACK or by COMMIT, and one that ends
  it without another (3609), are `unknown-outcome`, whatever each stored; no
  failure message repeats a value; a German
  session gets the same codes; a write to a renamed table is
  `schema-changed`, leaves no transaction on its one connection, and the
  next write on it commits; a closed pool, and one with no connection free
  within `acquireTimeoutMillis`, are `unavailable` even for a write; a write
  whose session is killed while it waits, or which times out, is
  `unknown-outcome` and is not retried. Each suite was first run against a
  naive variant — driver-parsed reads, no filters, no escaping, no NULL
  placement, no grouping, no stored-text check, no version in the WHERE, no
  error translation — and failed on each
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
  exact filter collation, the message check on the adapter's own error
  number, the TRY…CATCH (the RAISERROR insert and update committed), the
  xact_abort (266, and the write left open), the version read back (a token
  stale on return), the key compared through variables (468), the exact-key
  check (another row's version), the no-identity check (102), the pool's
  own timeout (thrown), the INSTEAD OF check (`ok: true` over an unchanged
  table), its `object_id` check (the blind account's `ok: true`), its
  operation and disabled filters (a true write refused), the transaction
  check (`ok: true` with nothing stored), 3609 (`unavailable` over a
  committed write), the SAME TABLE spellings (the constraint lost),
  nvarchar(max) and style 2 (`Muster AG,` and `1.2346`), and the precision
  and direction checks (the injected insert ran); and a version compared in
  one statement and incremented in another failed the race, with both
  writers winning, while the sequential test still passed. **Not
  mechanically enforced:** that a host updates
  only the fields a person changed, which the minute and second spellings
  below rely on to lose nothing stored; that no INSTEAD OF trigger is
  created, dropped, enabled or disabled between a write's statement and the
  catalog check after it; and that `mssql` turns every failure after it
  handed out a connection into a `RequestError`, which was read in its
  source, not tested.

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

**CONVERT to a narrower type says nothing.** `convert(nvarchar(10), …)` of
`Muster AG, Zurich branch` is `Muster AG,`, and `convert(decimal(18, 4), …)`
of 1.234567 is 1.2346: a column widened since discovery, read through the
snapshot's length or scale, reads back as a value it does not hold. Style 2
is ignored by a decimal, which converts with exactly its own digits, and
gives `money` and `smallmoney` four places.

**The statement shapes have edges.** `OUTPUT` without `INTO` is refused (334)
on a table with an enabled trigger, and needs SELECT on every column it
names: an account granted only INSERT is refused with 229. A decimal's
precision and scale, and ASC or DESC, take no parameter and are spliced into
the statement; built from a tampered precision or direction, an insert into
another table ran with the write and the lookup. A request carries at most 2100
parameters, and `sp_executesql`'s own `@stmt` and `@params` are two of them,
so 2098 is what a statement can bind. An ascending order puts NULLs first and
there is no `NULLS LAST`. In LIKE, `%`, `_` and `[` are special. Under the
fixture's `SQL_Latin1_General_CP1_CI_AS`, `=` finds `ACME` for `acme`, and
under every collation it ignores trailing spaces.

**Refusals are numbered, and their messages are not stable.** 547 is a
foreign key, a REFERENCE (a parent row still referenced) and a check alike;
a foreign key to its own table is FOREIGN KEY SAME TABLE and SAME TABLE
REFERENCE.
`tedious` asks for `us_english` at login unless the composition root sets
`options.language`; set, the messages are translated. In each of the 34
languages `sys.syslanguages` lists on the 2022 image — checked by hand on
2026-10-09; the suite checks German — 547 keeps the keywords `FOREIGN KEY`,
`REFERENCE` and `CHECK`, while the constraint's quoting varies (`"x"`, `'x'`,
`„x”`, none). Below compatibility level 150 a truncation is
8152, which names no column. The messages repeat values: "The duplicate key
value is (CH)", "Truncated value: 'AB'".

**An error is not a rollback.** A trigger's `RAISERROR`, unlike `THROW`,
does not end the batch even under `xact_abort`: the statement and the commit
ran, and `mssql` still rejected the request with 50000. A table missing when
the batch compiles — renamed since the bindings were approved — is resolved
only when its statement runs, inside the transaction; `xact_abort` rolls that
208 back, and without it the transaction stays open on the connection and
266 is reported last. An AFTER
trigger that updates the row it fired for moves its rowversion past the one
`OUTPUT` returned.

**A trigger can decide what a write stores, or end the transaction it runs
in.** An INSTEAD OF trigger runs in place of the statement, and `OUTPUT`
returns the row as if the statement had run: one that does nothing gave an
insert and an update a row over an unchanged table, and one that inserts the
row itself, changed, gave the identity 0 and the values before its change.
A trigger's `rollback transaction; begin transaction` leaves `@@trancount`
where it found it, so nothing is raised and the batch went on to commit an
empty transaction; `commit transaction; begin transaction` had stored the
write. A trigger that ends the transaction without beginning another gets
3609 after its COMMIT, which stored the write, and after its ROLLBACK, which
did not. An account denied VIEW DEFINITION on a table may still write it,
and to it `object_id` is NULL and `sys.triggers` lists nothing.

**A connection can fail on either side of a write.** A closed pool raises
`ConnectionError` before anything is sent. A pool with no connection free
within `acquireTimeoutMillis` rejects with tarn's `TimeoutError`, which
`mssql` passes on unwrapped and whose name is `Error`. A session killed while
its write waits on a lock gets 596 at severity 21; a request timeout gets
`ETIMEOUT` with no number.

## Decision

**Out of the database, the server converts every value to the text of its
canonical API value** (`src/sql/values.ts`): text as nvarchar(max), integers
as decimal strings, decimals in style 2 by their own type so every digit is
kept and `money` has four places, booleans as
`1`/`0` made `true`/`false`, floats in style 3, dates `YYYY-MM-DD`, times
`HH:MM`, instants switched to UTC as `YYYY-MM-DDTHH:MM:SSZ`, zoneless
timestamps `YYYY-MM-DDTHH:MM:SS`, UUIDs lower-cased. A rowversion comes back
as its 8 bytes and is spelled by `encodeRowversion`. A lookup's display
columns are spelled by style 126, because the configuration does not carry
their types. Nothing is read through the length, precision or scale the
snapshot remembers, so a column widened since discovery reads what it holds,
as PostgreSQL's `::text` does.

**Into the database, every value travels as nvarchar text and is converted by
the server** to the column's type — `convert(decimal(18, 4), @p3)` — except a
boolean (bit), a float (float) and a rowversion token (varbinary(8)). A value
of the wrong JavaScript type, a column kind with no canonical value, a key
that is not the identity or a column named twice is a programming error,
thrown before anything is sent. So is a decimal precision or scale that is
not a whole number SQL Server's syntax takes (1 to 38, and 0 to the
precision) and a sort direction that is not `asc` or `desc`: those are
spliced, and are checked before they become SQL.

**Every write is one batch:** `xact_abort`, a transaction, the one guarded
statement with `OUTPUT … INTO` a table variable, a check that
`current_transaction_id()` is still the transaction the batch began, a check
in `sys.triggers` and `sys.trigger_events` that no enabled INSTEAD OF trigger
for the operation decides what the table stores — refused too when the
account cannot see the table in the catalog, because then whether one does
cannot be told — a check that each text column
stored exactly the text it was sent (compared under `Latin1_General_100_BIN2`),
for an update a rollback if more than one row matched, the version read back
from the row by its identity as the statement wrote it, and the commit — all
inside TRY…CATCH, which rolls back on any error and rethrows it unchanged,
while `xact_abort` covers the 208 that CATCH cannot catch in its own scope.
The identity is captured as canonical text and compared through variables as
a bound key is. A difference in stored text is `out-of-range`, naming the
column. An update's WHERE holds the key, the trusted filters and the
expected version, and a version column is incremented in the same SET;
nothing matched is followed by one query that tells `stale` from
`not-found`. A token that is not what a read returns — upper-case hex, `01`
— is never bound and gets the same answer.

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
only, a foreign key to its own table included. Every message is the
adapter's own sentence. A number it does not know is `unavailable`. A write
an INSTEAD OF trigger would decide is `unavailable` too: the batch rolled it
back, which is that code's promise, and the port has no code for a table
whose writes this adapter cannot verify; `schema-changed` would claim that a
binding names something gone, and send someone to a drift review that cannot
show a trigger, because the snapshot does not describe triggers. A trigger
that ended the write's transaction — a replaced transaction, or 3609 — is
`unknown-outcome`, because a COMMIT and a ROLLBACK look alike to the batch
once the transaction is gone, and one of them stored the write. Whatever the
pool rejected with before it handed out a
connection — anything but a `RequestError` — is `unavailable` even for a
write; any other driver failure, or a refusal at severity 20 or more, is
`unknown-outcome` after a write and `unavailable` after a read, and is never
retried. A request is bound before it is sent, so an error in binding it is
thrown rather than taken for the pool's.

## Consequences

**What it buys.** Every edge value and every kind round-trips digit for digit,
whatever the driver's defaults, and a widened column reads what it holds. A
varchar cannot quietly keep a code nobody entered. A write an INSTEAD OF
trigger or a swapped transaction kept from the table is not reported done.
A stale save is refused even when two of them race inside the server.
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
AFTER trigger changed it; only the version is read back after one, which is a
key lookup more per write. A record with no identity, or with a key column
that is not text, an integer, a decimal, a uuid or a date — a time or an
instant, whose text is cut short, a boolean or a float, which do not travel
as text — is not found that way and keeps the version the statement saw. A
trigger's `RAISERROR` refuses the write here even where the
customer's own application lets it commit as a warning. A table with an
enabled INSTEAD OF trigger for an operation — a view made writable by one
included — cannot be written that way through this adapter at all, and an
account denied VIEW DEFINITION on a table it writes cannot write it either.
Every write asks the catalog about the table's triggers, and reads every
text column as nvarchar(max), which the driver receives as a large value. A
trigger that commits or rolls back the transaction and raises nothing makes
its write `unknown-outcome`, which the host has to reconcile though a retry
would often be safe. Two trigger shapes still mislead, measured by hand on
2026-10-09 and held by no test: one
that commits the transaction and then raises an error is reported as the
refusal it raised, though the write is stored; and an AFTER trigger that
deletes the row it fired for leaves `ok: true` over a table that does not
hold it, because `returning` is the row as the statement wrote it. A value
read from a widened column may be one the snapshot's codec would not
accept. Whether a rejection
came before a connection was handed out is read from the error's class,
which holds for `mssql` 12 by its source and would have to be read again on
an upgrade. Keys asked about in groups are several reads, not
one. An unknown refusal reported as `unavailable` invites a retry that will be
refused again. A constraint or column is named only in English, and in a
translated session a 547 whose constraint name holds the other kind's keyword
as a word of its own would be misread. The batch's own error numbers, from
51701, are anybody's; a trigger that throws one with another message is an
unknown refusal, and one that throws it with the adapter's exact message would
be misread. Everything here was measured on SQL Server 2022 alone, which is
the supported matrix (0003).

**What it forecloses.** The driver's typed parameters for exact values, a bare
`OUTPUT`, a filter compared by collation, any retry of a write, and writing
through an INSTEAD OF trigger.

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

**Find the written row again by its key instead of asking about INSTEAD OF
triggers.** Rejected as the guard: a target with no identity, or with a key
whose text is not exact, cannot be found that way; an INSTEAD OF trigger may
store the row under another key — it returned the identity 0 — and the row
an INSTEAD OF UPDATE trigger left unchanged is still there to be found; and
finding the row says nothing about what else the trigger did. It would also
be the way to catch an AFTER trigger that deletes its row, and would refuse
one that re-keys it.

**Tell a trigger's COMMIT from its ROLLBACK** by a temporary table created
inside the write's transaction, which a ROLLBACK removes and a COMMIT keeps.
Rejected: a tempdb object for every write, its cost not measured, so that a
trigger which commits and then refuses, or ends the transaction on purpose,
gets a more precise code.

**Read through the snapshot's length and scale, and refuse a column that has
grown as `schema-changed`.** Rejected: a widened column holds values that
were stored through other paths, and reading them exactly is what
PostgreSQL does; a refusal would fail every read of the table after a
harmless widening.
