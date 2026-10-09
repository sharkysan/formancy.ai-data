# 0028 — Row filters, labels and refusals mean the same on both engines

- **Status:** accepted
- **Date:** 2026-10-09
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-postgres/src/parity.integration.test.ts` and
  `packages/data-sqlserver/src/parity.integration.test.ts` — every
  `FILTER_PARITY` case in a lookup search and resolve, a record read and an
  update; every `DISPLAY_PARITY` label under hostile session settings; every
  `REFUSAL_PARITY` case; the tenant filter's index; a deadlock victim, waited
  for by blocking and never by a timer. Both run the expectations
  `@formancy/data-fixtures` writes once (`src/parity.ts`). The `fixed_code`
  cases `AB` and `ab` were watched failing on SQL Server with the `char(n)`
  filter compared under the column's collation alone. The PostgreSQL label
  test reads its session's settings back first, and was watched failing
  with floats read as `::text`; the suite also holds an unconstrained
  `numeric` filter to its scale (watched failing as numeric equality), the
  filter cases with a case-blind `public."C"` and a `public.bpchar` planted
  and pg_catalog searched last (watched failing with either name
  unqualified), and a terminated backend and a `transaction_timeout` as
  `unknown-outcome` (watched failing without CONNECTION_CLOSED in flight).
  The SQL Server suite holds 13536 and 13537 — a column that became a
  period's — as `schema-changed`, a database switched to read-only (3906) as
  `unavailable`, and the sentence a number from 50000 gets, each watched
  failing before the change.
  `packages/data-fixtures/src/fixtures.integration.test.ts` — the parity
  schema loads on both engines, holds the four named tenants and 20,000
  fillers, the rows each `FILTER_PARITY` case selects are worked out from the
  stored rows by exact comparison and equal the expectation, and one value of
  every label kind reads back as the same text; watched failing before the
  files were loaded, and with one expectation changed. `src/load.test.ts` —
  both parity editions create the same tables and name the same constraints,
  and CREATE TRIGGER opens its batch; watched failing with one constraint
  unnamed.
  `packages/data-core/src/lookup/filters.test.ts` — `rowFilterTerms` refuses
  a term with no type, a boolean, float, time or timestamp type, a malformed
  type, and a value its type refuses (`042`, `AB ` for char(3), an upper-case
  uuid), and returns fresh terms and types; `scopeRowFilters` types each term,
  refuses an absent, unreadable or uncomparable column as `invalid-policy`
  and a misspelled value as `invalid-context`, and keeps `[]` the only
  spelling of unrestricted; `rowFilterColumnProblem` names each. Watched
  failing before the functions existed. `lookup/values.test.ts` — a
  fixed-length value ending in U+0020 is not a key value, and one ending in a
  no-break space is; text with an unpaired surrogate is not, watched failing
  with it accepted, as `filters.test.ts` is for both functions.
  `lookup/display.test.ts` — one case per kind, the cut time and second,
  the era and `infinity` passed through, the real, NaN, and a value of the
  wrong type refused. `lookup/rows.test.ts` — labels come from
  `displayText` per display type, and a row whose display values do not line
  up is refused. `lookup/config.test.ts` — display and search columns carry
  the snapshot's types. `codecs/codec.test.ts` — fixed-length text is
  canonicalised without trailing spaces, measured after, and `AB   ` fits
  char(3). `records/plan-*.test.ts` — requests and membership checks carry
  typed filters; a boolean tenant column is `invalid-policy`. Each watched
  failing before the change it guards. `drift/relationships.test.ts` — a
  lookup's display, key and policy filter column retyped, and a filter column
  gone, block the lookup, and a target column nothing reads does not; watched
  failing when drift compared only the root's types.
  `packages/data-server/src/routes/runtime.test.ts` — a lookup query and a
  resolve whose tenant attribute is `042` are 403 `invalid-context` and the
  adapter is never asked, watched failing with the route's scoping skipped;
  `refused` is 422 with "refused the same way", with a field error when a
  bound column is named; `unavailable` is 503 with its new sentence; the audit
  outcome of a refused write is `refused`. `bundle.test.ts` — a lookup filter
  on a boolean or an absent column and a root filter on a timestamp are
  refused at publish, naming them, and the 0027 wording for an unreadable
  column is kept.
  `apps/studio/src/policy.test.tsx` — neither the customer list's filter
  column nor the root's offers `active` or `created_at`; `choice.test.ts` —
  neither is offered as a pin. Watched failing against the studio before.

## Context

Two engines answered one row filter differently, in opposite directions, and
each was measured on 2026-10-09 against `postgres:17-alpine` (17.11) and
`mcr.microsoft.com/mssql/server:2022-latest` (16.0.4295.3, server collation
`SQL_Latin1_General_CP1_CI_AS`), over a table of four named tenants and 20,000
fillers:

- **PostgreSQL.** A filter was bound as a parameter of type `unknown`
  (0016), so `tenant_code = $1` compared under the column's collation. Under
  a case-insensitive ICU collation, tenant `acme` read `ACME`'s rows too
  (probe C3c).
- **SQL Server.** A filter compared under `Latin1_General_100_BIN2` (0017).
  Every SQL Server collation, BIN2 included, ignores trailing spaces, so
  tenant `acme` read `acme `'s rows too (C2-table) — and the BIN2-only
  predicate never sought the index (C5a).

| | `'acme' = 'acme '` | `'acme' = 'ACME'` |
|---|---|---|
| PostgreSQL varchar/text, deterministic collation | false (C3) | false |
| PostgreSQL varchar, nondeterministic ICU level 2 | false (C3b) | **true** (C3, C3c) |
| PostgreSQL char(n) | **true** (C3) | per collation |
| SQL Server, any collation including BIN2 | **true** (C2) | true under CI, false under BIN2 |

The same review found four more places where one request meant two things:

- **Labels.** PostgreSQL's `to_jsonb` spelled an instant in the session's
  TimeZone and a float by `extra_float_digits` (C6-pg); SQL Server's style 126
  spelled a bit `1`, a uuid upper case, a float in scientific notation and an
  offset in the stored zone (C6).
- **The lookup route skipped scoping.** It handed the policy's text to the
  adapter, so a trusted tenant of `042` — which a record request refuses,
  because each engine would read it as 42 — listed tenant 42's rows.
- **`char(n)`.** SQL Server's `convert(nvarchar(max), c)` keeps the padding
  (C1) and PostgreSQL's `::text` drops it, so a `char(3)` key had two tokens.
- **Refusals.** A trigger's RAISE was `check-violation` on PostgreSQL and
  `unavailable` on SQL Server; a write a trigger declined was `unavailable`;
  writing a generated column was `schema-changed` on PostgreSQL (428C9) and
  `unavailable` on SQL Server (544). `unavailable` invites a retry, and every
  one of these is refused again.

## Decision

A row filter carries its column's type, and compares the column's canonical
value (0008) with the trusted value exactly: case, accents and trailing spaces
count, and the collation is not consulted. Labels are spelled once, in the
core, from the value each adapter's record reader returns. A refusal with no
code of its own is `refused`, and `unavailable` means only what passes.

- **The contract** (`data-core`). `RowFilterTerm` gains `type`, one of the
  key kinds (`RowFilterType`). `scopeRowFilters` types each term from the
  snapshot and refuses an uncomparable column as `invalid-policy` and a
  misspelled value as `invalid-context`; `rowFilterColumnProblem` says why a
  column cannot be filtered, and the planner, the server's publish check and
  the studio all ask it. `rowFilterTerms` refuses an untyped or misspelled
  term at run time; text with an unpaired surrogate is neither a key nor a
  filter value, because postgres.js would send U+FFFD where tedious sends the
  unit itself. `lookupFilters` and the planner's `scopedFilters` are
  gone. `LookupConfig.display` and `.search` carry types; `FoundRow.display`
  holds canonical values; `displayText` spells a label. A fixed-length text
  value's trailing U+0020 is dropped by the codec, and is not a key value.
- **PostgreSQL** compares `column = $n::text` in the column's own type and
  collation, which keeps the index, and then the two as text under
  `collate "C"`, which is exact (C4). Both conjuncts admit an exactly equal
  pair, so the first only ever narrows less. A `numeric` with no scale, which
  only PostgreSQL has, is compared as a number and again as its text, since
  numeric equality calls `12.5` and `12.50` equal. The collation and `bpchar`
  are named in `pg_catalog`.
- **SQL Server** binds once as `nvarchar(max)` and compares `=`, `= … collate
  Latin1_General_100_BIN2`, and, for variable-length text, `datalength`. A
  `char(n)` reads `rtrim`med, as PostgreSQL's does. The write batch's stored
  text check uses the same exact comparison.
- **Refusals.** PostgreSQL's P0 and declined writes, and SQL Server's numbers
  from 50000 and its INSTEAD OF trigger, are `refused`; each engine's
  `unavailable` is an allowlist and everything else is `refused`. SQL
  Server's 3906, a read-only database, is on its allowlist as PostgreSQL's
  25006 is on its. 544, 8102, 271, 273, 272, 13536 and 13537 are
  `schema-changed`, as 428C9 is. The server answers
  `refused` with 422 and "Sending it again will be refused the same way".
- **The lookup route** scopes its filter with `scopeRowFilters` before it
  opens a connection; the publish check refuses every filter column
  `rowFilterColumnProblem` names; the studio offers none of them.
- **Drift** (0010) is given the published policy, and compares by type every
  column a lookup reads by type — its key, its display columns and its
  policy filter's columns — so a retyped one blocks the lookup, as a gone one
  does. The runtime reads them by the published snapshot's types, which is
  only right while they are the database's.
- **The parity schema** (`data-fixtures`, outside `FIXTURE_SCOPE`) and its
  expectations, `FILTER_PARITY`, `DISPLAY_PARITY` and `REFUSAL_PARITY`, are
  what both adapters' parity suites run.

## Consequences

What this buys: tenant `acme` reads `acme`'s rows on both engines and no
others; a lookup lists only rows a record request would read; a label is one
string for one row; a refusal says whether to try again, the same way twice.

What it costs, and does not do:

- **Two or three conjuncts per text filter.** On PostgreSQL the index serves
  the first and the "C" comparison is a filter on what it returns (C4).
- **An nvarchar or nchar filter, and a char or varchar one under a Windows
  collation, now seeks where 0017's spelling scanned** (C5b, C5d). `char` and
  `varchar` under a `SQL_` collation — the fixture database's default — still
  scan, as they did (C5c). Binding a varchar filter as varchar would seek and
  was refused below.
- **Labels are not localised.** A person reads `true`, an instant in UTC to
  the second, a time to the minute, cut and never rounded.
- **Boolean filters are refused, in lookups too**, and at publish. A policy
  that filtered by a flag must use a column a filter can compare.
- **A stored answer holding a padded `char` token is no longer a member on
  SQL Server**, whose reader now drops the padding.
- **`refused` lumps a broken trigger with a business rule.** The failure's
  message is for the log; the person reads one sentence.
- **The transient allowlists are by documentation**, except what the parity
  suites provoke: 40P01, 57014, 55P03 and 25006 on PostgreSQL, 1205 and 3906
  on SQL Server. The rest — classes 08, 53, 58 and 28, class 57 but 57014,
  55006 and 3D000 on PostgreSQL; 1222, 1204, 701, 8645, 8651, 9002, 1105,
  3960, 976 and 983 on SQL Server — are named and not provoked. Most of class
  57 never arrives as a SQLSTATE at all: a terminated backend, a shutdown and
  a `transaction_timeout` are FATAL and close the connection, and a write
  that meets one is `unknown-outcome`, which the suite shows.
- **A lookup blocks on a widening too.** A display column grown from
  `nvarchar(200)` to `nvarchar(400)` reads as it did, and drift still blocks
  the lookup until the form is published again: the rule is "the type the
  runtime reads by is the database's", not a judgement per pair of types.
- **A varchar column created under ANSI_PADDING OFF refuses a trailing space
  as `out-of-range`** (C12), instead of reporting `acme` saved for `acme `.
- **Search folding is still per engine** (0012, 0016, 0017): this record
  changes what a filter matches, not what a search matches.
- **Record keys and lookup key lists still compare under the database's own
  equality.** A key is unique under that equality, so it names one row, and
  membership is decided by re-encoding (0012).

## Alternatives considered

- **Compare in the column's collation.** Widens what a trusted value matches,
  per engine and per column: the hole itself.
- **`column::text = $n` only.** Exact, and defeats the index (0016).
- **Carry the collation in the contract.** A third engine fact the core cannot
  use: the core would still have to choose an exact comparison.
- **An `unavailable` code with a transient flag.** HTTP status and the audit
  outcome switch on the code; a flag beside it is read by nobody.
- **`check-violation` for a trigger's error.** Claims a constraint the form
  could have checked, and invites the person to change a value that may be
  fine.
- **Bind a varchar filter as varchar to get a seek.** A lossy conversion
  could narrow the match differently per code page, which is the
  disagreement this record removes.
- **Refuse a filter on an unconstrained `numeric`.** Its canonical value is
  well defined, so refusing it would take away a column that can be filtered
  exactly at the cost of one more conjunct on one engine.
- **Drift compares every column of a lookup's target.** It would need no
  policy, and would block a lookup for a change to a column nothing reads;
  the policy is in the bundle drift is run from.

## Older records

Narrowed, not edited away: 0008's text, whose fixed-length value is now
canonical without its padding; 0010's drift, which is given the policy's
lookup filters and blocks a lookup on any change to a type it reads by; 0012's filters, which are typed and exact, and
its labels, spelled once; 0016's filter parameter of type `unknown`, its
`to_jsonb` labels and its refusal classes; 0017's BIN2-only filter, its
style-126 labels, its `char(n)` read and its refusals by number; 0018's
filters, which a lookup now scopes as a request does.
