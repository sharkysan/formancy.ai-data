# 0026 — Name every column fact the two engines disagree on, and check values in the column's own unit

- **Status:** accepted; narrowed by [0040](0040-instants-and-times-are-read-to-the-shape-and-an-unedited-one-is-never-written.md): instants and times are read alike on both engines, an instant to the second and a time to the minute
- **Date:** 2026-10-09
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/codecs/codec.test.ts` — one test per text length
  unit over the same five values at `n = 4`, an unpaired surrogate refused in
  every unit, the 32-bit float's shortest spelling, its refusals at infinity
  and zero, `canonicalFloat32`'s idempotence and its shortest-of-a-length
  choice at 2^-96, and both identities read-only; watched failing with the
  length counted as `value.length` for every unit (code points, UTF-8 and
  code-page tests fail), with the surrogate accepted, with
  `canonicalFloat32` skipping `Math.fround`, and with it taking only the
  nearest decimal of each length (2^-96 came back in nine digits).
  `packages/data-core/src/snapshot.test.ts` — a snapshot in contract v1's shape
  (text with no unit, binary with no `fixedLength`, a check with no `enforced`,
  `generated: 'identity'`) is refused, naming the column or check; watched
  failing with the guard absent.
  `packages/data-core/src/generate/controls.test.ts` and `generate.test.ts` —
  `maxLength` stays `n` in every unit with a caveat per unit, the code-page
  caveat saying a save refuses what the database does not, the 32-bit float's
  caveat, a by-default identity read-only, never required, with create still
  offered; watched failing before the caveats and the per-kind notes existed,
  and with the code-page caveat saying the database refuses.
  `packages/data-core/src/drift/compare.test.ts`, `columns.test.ts` and
  `relationships.test.ts` — a text in another unit and a binary that starts
  padding are changed types, a bound varchar whose collation became UTF-8
  blocks the form, a written column that became a by-default identity stops
  writes, identity-always to identity-by-default is a generation change named
  both ways, and a check that stopped being enforced is noted with its
  enforcement; each watched failing before the comparison read the new fact.
  `packages/data-core/src/lookup/values.test.ts` — a key value is measured in
  its column's unit; watched failing with `value.length`.
  `packages/data-fixtures/src/conformance.test.ts` — the comparator notices a
  text counted in the wrong unit, an identity of the wrong kind, SQL Server's
  sequence default reported as an ordinary column or without its default, and
  a check reported enforced where SQL Server disabled it; the sequence-default
  test watched failing while the model said `none`.
  `packages/data-fixtures/src/load.test.ts` — both files create the same tables;
  watched failing with `sales.shipment` renamed in the SQL Server file.
  `packages/data-fixtures/src/fixtures.integration.test.ts` — on real servers,
  the shipment's code page is 65001, its PostgreSQL identity is `d`, its SQL
  Server id is no IDENTITY and defaults to `NEXT VALUE FOR
  [sales].[shipment_id]`, its checks catalogue as the model says, and a `real`
  0.1 is `0.1` as PostgreSQL text and `1.0000000149011612e-001` in SQL
  Server's style 3; watched failing with the UTF-8 collation removed (1252),
  the identity made ALWAYS (`a`), and the SQL Server id made `int identity`.
  `packages/data-server/src/bundle.test.ts` — a bundle whose snapshot predates
  this contract is refused; watched failing with the snapshot guard removed.
  `apps/examples/src/fixture-snapshot.json` and the studio's three captures in
  `apps/studio/src/fixtures/`, recaptured, and both apps' suites, which
  refused the old captures by this record's snapshot guard.
  PostgreSQL: `discovery-types.integration.test.ts` — the two identities, a
  serial column and a default of exactly `nextval()` by-default, one that
  computes with it not, and a SQL_ASCII and a LATIN1 database, each made for
  the test, counting in `utf8-bytes` and `code-page-bytes` with the server's
  own 22001 and 22P05 beside them; watched failing with every encoding read
  as `code-points` and with the sequence-default rule removed.
  `discovery-pg18.integration.test.ts`, on `postgres:18-alpine` — a `NOT
  ENFORCED` check reported not enforced; watched failing with `enforced`
  always true. `discovery/columns.test.ts` — an `attidentity` code no version
  has is `identity-always`; watched failing while it fell through to `none`.
  `records.integration.test.ts` — the shipments, `varchar(20)` at twenty
  characters, a `real` against PostgreSQL's own text over 2^-96, 805306368 and
  2^-12 (the same float, never more digits; watched failing on 2^-96 with the
  nearest-only `canonicalFloat32`), an unpaired surrogate stored as U+FFFD in
  silence, the zoneless edges, and a by-default identity colliding with a
  number given by hand.
  SQL Server: `discovery.integration.test.ts` — the shipment's sequence
  default as by-default with its default, `kinds.every`'s UTF-8 `nvarchar`
  and `nchar` counting UTF-16 code units, a sequence default with a bracket
  in its name by-default and one that computes with it not, and checks
  enforced and trusted apart; watched failing with the unit taken from the
  code page alone and with the sequence-default rule removed.
  `records.integration.test.ts` — the shipments, each unit's edge, a `real`
  0.1, the zoneless spelling, and a sequence default colliding with a number
  given by hand (2627 → `unique-violation`).

## Context

A review of the contract against both engines found column facts the
normalised type did not carry, each one a place where one engine silently
disagreed with the other or with the browser. A second review of the change
found more of the same, and they are folded in here. Measured on 2026-10-09
against `mcr.microsoft.com/mssql/server:2022-latest` (16.0.4295),
`postgres:17-alpine` (17.11) and, for one fact, `postgres:18-alpine` (18.6):

- **Text length counts different things.** PostgreSQL's `varchar(4)` in a UTF8
  database holds four `é` and four emoji. In a SQL_ASCII database, which
  stores the client's UTF-8 bytes unconverted, it refuses four `é` (22001): it
  counts bytes. In a LATIN1 database it holds four `é` and refuses an emoji
  (22P05), which LATIN1 has no byte for. SQL Server's `nvarchar(4)` holds two
  emoji and refuses a third (2628) — under a UTF-8 collation too, though the
  catalog reports code page 65001 for that column. A `varchar(20)` under
  `Latin1_General_100_CI_AS_SC_UTF8` (65001) refuses twenty `é` — forty bytes —
  with 2628 and accepts ten; under `SQL_Latin1_General_CP1_CI_AS` (1252) it
  holds twenty. Japanese collations use 932, where a character is one or two
  bytes. SQL Server stores a character its code page lacks as `?` or a best
  fit, without an error; only the adapter's stored-as-sent check refuses it.
  The codec counted UTF-16 code units everywhere (0008), so a UTF-8 overflow
  reached the database and PostgreSQL's third emoji was refused for a rule
  that was not its own.
- **An unpaired surrogate ends three ways.** Written to PostgreSQL, `'\ud800a'`
  is stored as U+FFFD then `a`, and the write reports success; SQL Server's
  `nvarchar` keeps it; its UTF-8 `varchar` stores U+FFFD, which the adapter
  refuses as not stored. The lookup token and search already refused it.
- **`binary(4)` pads.** Writing `0x01` reads back `0x01000000`.
- **Two identities, and a third spelling of one.** PostgreSQL's `attidentity`
  is `a` for GENERATED ALWAYS, which refuses a value, and `d` for BY DEFAULT,
  which accepts one. The contract had one `identity`. SQL Server has no BY
  DEFAULT identity; a default of `NEXT VALUE FOR` a sequence takes its place,
  and PostgreSQL's `serial` is a default of `nextval()`. All three number a row
  an insert leaves out and take a value given by hand, and all three collide
  with it later: on SQL Server, insert one row, insert the next id by hand,
  and the next insert that leaves the id out fails with 2627, as PostgreSQL's
  fails with 23505.
- **A disabled check read like an untrusted one.** SQL Server's `NOCHECK
  CONSTRAINT` gives `is_disabled = 1, is_not_trusted = 1`, `WITH NOCHECK ADD`
  gives `0, 1`; the contract's check had only `validated`, so both read `false`
  (0007 said so). PostgreSQL 17 ignores `NOT VALID` inside `CREATE TABLE`; only
  `ALTER TABLE … ADD … NOT VALID` leaves a check unvalidated, and it is still
  enforced for new rows. PostgreSQL 18 adds `NOT ENFORCED`, which lets a value
  the check names through and catalogues as `conenforced = f, convalidated =
  f` — the same shape, read as 17 reads it, as NOT VALID.
- **A `real` is two numbers.** SQL Server's style 3 reads `0.1` as
  `1.0000000149011612e-001`; PostgreSQL's text is `0.1`. SQL Server stores a
  double of 1e-50 as `0` without a word and refuses 1e39 (232); PostgreSQL
  refuses both. An unchanged echo of a real compared `0.1` with
  `0.10000000149011612` on SQL Server, and lost.
- **A zoneless timestamp was spelled two ways.** SQL Server's adapter read
  `convert(nchar(19), x, 126)`, cutting the fraction; PostgreSQL's kept it.
  Style 126 prints the column's scale with trailing zeros (`…56.500` for
  `datetime2(3)`) and omits a zero fraction (`…56`). A `datetime` keeps 1/300
  s, and style 126 spells the .00666… it holds for .007 as `.007`.

## Decision

1. **A text column says what its length counts** — `lengthUnit`:
   `code-points` (PostgreSQL in a UTF8 database), `utf16-code-units`
   (`nchar`/`nvarchar`, under every collation), `utf8-bytes` (`char`/`varchar`
   under code page 65001, and PostgreSQL in a SQL_ASCII database) or
   `code-page-bytes` (any other code page or database encoding, and an unknown
   one). The codec counts in that unit; a code page is counted by characters,
   a lower bound, and the save refuses beyond it. A lookup key is measured the
   same way. The browser's `maxLength` stays `n`, and the generator says per
   field how it relates to the column. The codec refuses an unpaired
   surrogate in every unit, as it refuses NUL.
2. **A binary column says whether it pads** — `fixedLength`. It still has no
   codec; the flag is for drift and for the codec that will need it.
3. **Numbering is `identity-always` or `identity-by-default`.** ALWAYS is
   PostgreSQL's GENERATED ALWAYS and SQL Server's IDENTITY, and an
   `attidentity` code no version has yet. BY DEFAULT is PostgreSQL's
   GENERATED BY DEFAULT and, on either engine, a default that is exactly a
   sequence's next value — `serial`, `nextval('…'::regclass)`, `NEXT VALUE
   FOR` — which keeps reporting the default it has. Both kinds are read-only
   in a form.
4. **A check says whether it is `enforced`**, beside `validated`. SQL Server:
   not `is_disabled`. PostgreSQL: `conenforced` where the server has it (18),
   and true where it does not (17).
5. **A 32-bit float is canonical** as `canonicalFloat32` gives it — the
   shortest decimal naming the float32, and of that length the nearest — in
   the codec and in both adapters' reads. A value a real would store as
   infinity or as a zero nobody wrote is refused.
6. **A zoneless timestamp has one read spelling on both engines**:
   `YYYY-MM-DDTHH:MM:SS`, then its fraction with trailing zeros dropped — a
   SQL Server `datetime` to the millisecond, as SQL Server spells it.
7. **`sales.shipment` joins the shared fixture**, with the facts above on both
   engines, and the model gains `byKind` for checks.

A snapshot in the old shape is refused by `createSnapshot`, so a published
bundle or a captured example from before this record is refused rather than
trusted; the examples page's capture and the studio's three were taken again.

## Consequences

**What it buys.** A UTF-8 `varchar` overflow is a field error before the
database's 2628, and so is a SQL_ASCII one before PostgreSQL's 22001.
PostgreSQL text takes the emoji its column holds. A value is never stored as
something else in silence for want of a surrogate's pair. The shared shipment
table's id is read-only on both engines, where it was writable on SQL Server.
A `real` round-trips: `0.1` written reads `0.1`, and an unchanged echo is
unchanged. A disabled SQL Server check and an unenforced PostgreSQL 18 one
are visible as such. A collation move on a bound `varchar` across the UTF-8
boundary — the same spelling, a different unit — is drift; before this
record the snapshot held no collation or unit, so the move was invisible,
fingerprint included. A stored pre-v2 snapshot is refused rather than trusted.

**What it costs.** The browser's `maxLength` is looser than a UTF-8 or
code-page `varchar`, which makes a second rule checked on the server only
(0009), and stricter than PostgreSQL for emoji. A code-page `varchar` is checked
only by characters; on a double-byte code page the save decides, and on SQL
Server that is the adapter's stored-as-sent check, since the server itself
substitutes. A collation change on a bound `varchar` now blocks its form until
it is reviewed, though reads would still work. A by-default identity, a
`serial` column and a sequence-default key cannot be set from a form even
though the column allows it; a published form that wrote a `serial` column
reports drift on its next review, a written column that became
`identity-by-default`, and stops writing it until reviewed. A sequence
default whose definition the account may not read (SQL Server without `VIEW
DEFINITION`) cannot be told from an ordinary one: it stays writable, and the
snapshot's `defaults` gap says the definition was hidden. A 32-bit float's
answer is not always what was sent: `0.123456789` comes back `0.12345679`,
and the generator says so on the field. The SQL Server zoneless read spells
`convert` five times per column, which the server evaluates for every row
read. Discovery on PostgreSQL reads `conenforced` through the row as JSON so
one query runs on 17 and 18, and starts an 18 container in its suite for the
one fact that needs it.

**What it does not do.** Instants and times still differ between the engines:
PostgreSQL keeps a fraction (0016) and SQL Server cuts an instant to the second
and a time to the minute (0017); reversing that is its own record. A move
between two code pages that are not UTF-8 — 1252 to 932 — is
`code-page-bytes` on both sides, so drift does not see it and neither does
the fingerprint; the save's checks are left to catch what it changes. A SQL
Server `datetime` reads rounded to the millisecond, by SQL Server. The adapters
do not return PostgreSQL's own float4 text: it names the same float, and
differs in a last digit at an exact tie (2^-12: PostgreSQL `0.00024414062`,
here `0.00024414063`) and by a digit where a decimal halfway to the next float
already names this one (805306368: PostgreSQL `8.0530637e+08`, here
`805306400`). SQL Server's `is_not_for_replication` is not read. Binary still
has no codec.

## Alternatives considered

**Keep counting UTF-16 code units everywhere (0008).** Rejected: it lets a
UTF-8 refusal reach the database, and refuses emoji PostgreSQL holds.

**Carry the code page and model its table.** Rejected: there are four
double-byte tables, and nothing here would test them.

**Fail closed on a PostgreSQL database that is not UTF8.** Rejected: SQL_ASCII
counts exactly UTF-8's bytes, and any other encoding counts characters as
`code-page-bytes` says; refusing them would refuse databases whose rule is
known.

**Count an unpaired surrogate as U+FFFD's three bytes, and accept it.**
Rejected: it was the first version of this record, and PostgreSQL then stored
a different value and reported success.

**Refuse a 32-bit float value that does not survive the round trip.**
Rejected: a number field cannot show digits, and a double already rounds at
`JSON.parse`.

**Spell a 32-bit float as PostgreSQL's float4 text does.** Rejected: it
excludes a decimal halfway to the next float that the parser rounds to this
one, and breaks ties to even, so matching it means reimplementing its
printer; nothing needs PostgreSQL's spelling, only one spelling on both
engines.

**Make a by-default identity writable.** Rejected: a number chosen by hand does
not advance the sequence, and a later create collides with it.

**Leave a sequence default an ordinary column with a default.** Rejected: it
was the first version of this record, and made the shared table's id
writable on SQL Server and read-only on PostgreSQL for one behaviour, the
collision included.

**A separate `identity` flag on `ColumnMeta`.** Rejected: with the union split,
every existing `generated !== 'none'` rule — the codec, the create rule, the
version-column rule, the planner's required check — holds unchanged.

**Refuse a PostgreSQL 18 server until it is in the matrix.** Rejected: one
catalog column differs, and reading it where it exists costs one expression
and one container.

**Bump the bindings version.** Rejected: an old snapshot is refused by the
snapshot guard, and old bindings against a new snapshot already fail the
planner's type comparison (`invalid-bindings`).

## Older records

Narrowed, not edited away: 0005's list of where the engines differ is extended
here; 0007's checks and text lengths, 0008's text length, 0009's text
`maxLength` and identity notes, 0010's retyped row, and 0017's `real` and
zoneless reads are narrowed by this record. Two sentences were corrected
because they had become false: 0008's, that SQL Server's single-byte
`varchar` refuses a character its code page lacks — it substitutes, and the
adapter's stored-as-sent check refuses — and 0016's citation of a records
test by its old name, which said a `real` reads as PostgreSQL itself prints
it.
