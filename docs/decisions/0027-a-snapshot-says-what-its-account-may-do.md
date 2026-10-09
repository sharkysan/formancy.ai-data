# 0027 — A snapshot says what its account may do, and whose it is

- **Status:** accepted
- **Date:** 2026-10-09
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/snapshot.test.ts` — the account's user is in the
  fingerprint and its login and the server version are not; a column with no
  `access`, or with a capability that is not a boolean, is refused naming the
  column, and a snapshot in 0026's shape is refused as "taken before 0027";
  `unknown` row security with no covering `row-security` gap is refused, and
  a gap on the scope, the object's schema or the object each satisfies it; a
  gap with an empty schema or a malformed subject is refused; gaps sort
  scope, schema, object; a schema subject spelled unlike the scope is
  accepted; a revoked column privilege moves the fingerprint. Watched
  failing with `account` left out of the hash (four tests, three of them in
  drift), and with the guards absent before they were written.
  `packages/data-core/src/generate/access.test.ts` — an unreadable column gets
  no field and an `excluded` note; a column that may be inserted and not
  updated is written on create, read-only on update with the reason, and not
  disabled; one that may be neither is disabled; no INSERT blocks create, no
  UPDATE on what the form writes blocks update, each naming the privilege; an
  unreadable root, pinned column, confirmed version column or lookup column
  throws naming it; an unreadable primary key falls back to a readable unique
  key, and with none create is offered and update is not; row security that
  applies or cannot be established on the root or a target, and every view
  root, gives an `access` note; two runs are byte-identical. Watched failing
  before the rules existed, except the three that hold what does not change:
  a generated column's note, the owner's form with no access note, and two
  identical runs.
  `packages/data-core/src/generate/generate.test.ts` — bindings are version 2,
  and the owner's fields write on both operations or on neither.
  `packages/data-core/src/policy/evaluate.test.ts` — a field written on create
  only is over-posting on update and not on create; watched failing with the
  check reading either operation. `policy/validate.test.ts` — a write grant on
  a field written on neither operation is refused, and on a create-only one
  is not.
  `packages/data-core/src/records/plan-update.test.ts` — a bindings file that
  writes on update a column the account may not UPDATE, or on create one it
  may not INSERT, binds a column, an identity or a rowversion it may not read,
  is `invalid-bindings`; version-1 bindings are refused with "republish".
  `packages/data-core/src/lookup/config.test.ts` — an unreadable key, display,
  search or sort column is refused; version 1 throws.
  `packages/data-core/src/drift/privileges.test.ts` — one case per row of the
  drift table below, another account with identical grants is `review` and
  never an empty report, the same with row security on a target is blocking,
  and a field written on update only that loses UPDATE stops update and not
  create; each watched failing before `privileges.ts` existed. The
  concurrency rows — a confirmed token that lost SELECT breaks reads and
  creates, a version column that lost UPDATE stops update only, a suggested
  one is information — watched failing against the first version, which
  stopped update alone.
  `drift/diff.test.ts` — a root missing behind a schema gap on its own schema
  is `access-narrowed` and behind one on another schema `root-dropped`
  (watched failing with a schema gap covering every schema), a `row-security`
  gap that appears is `review` (watched failing with the row-security doubt
  removed), and version-1 bindings throw. `drift/columns.test.ts` — a
  tightened column written on create only stops create and not update, and
  a confirmed concurrency column that is gone blocks the form, watched
  failing against 0010's "stops update".
  `packages/data-fixtures/src/conformance.test.ts` — an owner snapshot with one
  capability false, `customer` reported `none` on SQL Server or `applies` on
  PostgreSQL, a usable object absent with no gap, an unusable one absent with
  no `objects` gap, a capability other than granted, and `unknown` with no
  covering gap are each a disagreement; absent behind a schema or scope gap
  with nothing granted is not; a schema subject is named in the sentence;
  an object described without the columns its account may not read is a
  disagreement. Watched failing with the owner checks and the gap excuse
  removed, and the last with the column-list comparison removed — the shape
  a privilege-filtered catalog produces, which every other rule passed.
  `packages/data-fixtures/src/fixtures.integration.test.ts` — on both
  engines the owner reads both tenants of `sales.customer` and the writer
  tenant 1 only, and the writer's insert of an order for tenant 2's customer
  is not refused; watched failing on both engines with the PostgreSQL policy
  not created and the SQL Server policy created `state = off`.
  `packages/data-fixtures/src/load.test.ts` — the restricted files create the
  principals `containers.ts` connects as, with its passwords, and CREATE
  FUNCTION opens its batch.
  `packages/data-server/src/bundle.test.ts` — a bundle published before this
  record, and version-1 bindings alone, are refused with "republish", without
  reading the policy against them; a row filter on a column the account may
  not read is refused at publish, and one on a root column it may not INSERT
  while the form offers create; each watched failing with its check
  removed. `routes/admin.test.ts` — drift against a discovery taken as
  another user reports `account-changed`. `e2e.integration.test.ts` — on
  both engines, a form proposed through the writer's connection offers create
  and update, writes `amount` on create only, carries the policy note on
  `customer`; its lookup offers tenant 1's customer to tenant 1's clerk and
  nothing to tenant 2's; a changed `amount` on update is refused before the
  database is asked and `status` is saved; and the two engines' per-operation
  writes are identical.
  `packages/data-postgres/src/discovery.integration.test.ts`,
  `discovery-access.integration.test.ts` — the owner, the reader and the
  writer agree with the model, `READER_ACCESS` and `WRITER_ACCESS`, with no
  gap; a column-by-column grant, an UPDATE without SELECT, a schema without
  USAGE (B2) and a revoke each read as the server answers; every capability
  the snapshot reports is the answer a real statement gets, as owner, reader
  and writer (B6); a session role is the user and the login stays the
  writer's (B5); a membership WITH INHERIT FALSE grants nothing (B4); row
  security applies to the writer and the reader and not to the superuser, to
  a non-superuser owner only under FORCE, to a BYPASSRLS role never (B1,
  B1+); a `serial` create is permission-denied and an identity's succeeds
  (B14); an insert a policy refuses is permission-denied and a row it hides
  not-found (B17); a view's columns say SELECT while a read through it is
  refused for its tables' privileges, the cost below. All failed before the
  adapter changed, refused by `createSnapshot`; then dropping the USAGE AND,
  reading `relrowsecurity` and `session_user` for `row_security_active` and
  `current_user`, matching access by position over rows that kept the
  dropped column, and answering INSERT with the UPDATE check each failed the
  tests that guard them. The view case was watched failing with the base
  table granted.
  `packages/data-sqlserver/src/discovery.integration.test.ts`,
  `discovery-access.integration.test.ts`, `discovery/access.test.ts` — the
  owner matches the model with `customer` applying to `dbo`; the reader's
  exact gaps in order, and its schema gap in the catalog's spelling under a
  scope written `SALES`; every capability is the answer a real statement gets
  as owner, writer, reader and a schema viewer (B12); column grants and
  denies in each precedence (B8); `group` and `it's [odd]` answered (B7);
  user and login, only the user hashed (B13); INSERT alone through a sequence
  default (B15); a policy in another schema unknown to a schema grant and
  applying under a database grant; a disabled policy none; VIEW SECURITY
  DEFINITION alone unknown (B10d); a deny on a schema or on the policy
  unknown, with why (B10f); a schema deny to `public` leaves the owner none
  and gapless while still binding an ordinary viewer; a quoted database
  name; a NULL privilege answer refused. Watched failing with each of these
  put back: the raw column name, the raw `db_name()`, no schema-deny count,
  no object-deny count, no `is_enabled` filter, the login read from
  `user_name()`, the database grant ignored, policies never found, SELECT
  asked of the object only, UPDATE asked as INSERT, the schema gap as a scope
  gap, the NULL guard removed — and, from review, schema denies counted
  without `HAS_PERMS_BY_NAME` and the schema gap spelled as the scope.
  `records-failures.integration.test.ts` — a write a block predicate refuses
  is `permission-denied` on insert and on update, and nothing is stored;
  watched failing as `unavailable`.
  `apps/studio/src/fixtures.test.ts` — the five captures are exactly what
  `createSnapshot` makes, both owners agree with the model, the PostgreSQL
  reader describes every object with no gap and agrees with `READER_ACCESS`,
  the SQL Server reader sees `sales.order` behind gaps, and the writer agrees
  with `WRITER_ACCESS`. `connect.test.tsx`, `choose.test.tsx`,
  `choice.test.ts`, `drift.test.tsx`, `policy.test.tsx`, `api.test.ts` — the
  reader's `sales.customer` shown described and unreadable, the account
  named, a lookup or root the generator would refuse disabled with its
  reason — over an unreadable target key, root column or display column —
  the writer's form with its access and read-only notes, drift against the
  reader's snapshot as `account-changed` and `privilege-narrowed`, the
  create-only wording. These were first run against the re-captures; two
  were wrong about what the captures hold (the SQL Server reader sees a key
  without its target, not a hidden target; every table the PostgreSQL reader
  describes has a Columns list) and were corrected, and the display-column
  and root-column cases were watched failing against the studio before it
  checked them. `apps/examples/src/notes.test.tsx` — the `access` kind is
  shown with its empty sentence. `pnpm test:browser` walks both apps at 320
  pixels over the re-captures.

## Context

A review of the contract against both engines found that a snapshot said
what the catalog showed and not what the account could do with it:

- **0006's privilege test was coarse.** PostgreSQL discovery asked whether
  the account held any privilege on a table, and replaced an unusable one
  with an `objects` gap. A table it could read but not write, or read in
  part, was described as if the account could do everything; a column grant
  was a `columns` gap that could not say which columns.
- **Row security was invisible.** Neither engine's policies were read. A form
  over a policed table showed fewer records than the table held, and nothing
  said why.
- **0007's denied column was found only by a read.** A column denied SELECT
  was described like any other, and the first read failed with 230.
- **`object: null` meant two things.** A gap about the whole scope and one
  about one schema — SQL Server's "no VIEW DEFINITION on schema sales" — were
  both `object: null`, and drift review treated both as "anything in scope".
- **The snapshot did not say whose it was.** The same connection under
  another principal reads other rows, and two such snapshots could hash
  alike.

Probed on 2026-10-09 against `postgres:17-alpine` and
`mcr.microsoft.com/mssql/server:2022-latest` (16.0.4295.3, RTM-CU27), under
Docker Desktop on Windows 11 with 20 CPUs and 16 GB, with the fixture as
committed plus the policy and the writer below. Every container was removed
afterwards.

| Probe | What the server answered |
|---|---|
| B1 | `row_security_active(oid)`, as reader and writer: true for `customer` only, the view included false, and no permission error though the reader has no privilege on `customer`. As the superuser: all false. The owner reads both tenants, the writer tenant 1. |
| B1+ | A non-superuser owner: false without FORCE, true with it. BYPASSRLS: false. Under `row_security = off` still true, and the read fails rather than lie. |
| B2 | SELECT granted, no USAGE on the schema: `has_column_privilege` true, the read 42501, and `'x'::regclass` 42501 too, so the query keys by oid. A dropped column's privilege is NULL. |
| B4 | A membership `WITH INHERIT FALSE`: privilege functions false, the read 42501. Only `SET ROLE`, which this module never issues, changes it. |
| B5 | `connection: { role }` in postgres.js: `current_user` is the role, `session_user` the login, and the policy, which compares `current_user`, shows both tenants. `current_user` is the principal a policy sees. |
| B6 | Every column, as writer, reader and owner, by `select c … where false`, `update … set c = null::type where false`, `insert … (c) select null::type where false` in rolled-back transactions: 128, 143 and 128 statements, no disagreement with the privilege functions. `set c = c` needs SELECT on `c`; a generated column's update fails 428C9 and a non-updatable view's write 55000 before the privilege check, so both are skipped for writes. |
| B7 | `has_perms_by_name(…, 'COLUMN')` with sub-securable `group` 1, `[group]` 1, a column that does not exist 0 — not NULL — and `it's [odd]` raw NULL, quoted 1. A column-level INSERT grant is refused (1020). |
| B8 | Deny the table, grant the column: the column readable. Grant the table, deny the column: not. Deny the column, then grant the table: the grant removed the deny. `has_perms_by_name` agreed with the server each time. |
| B9 | Database VIEW DEFINITION: 1 for a db_owner member and a database grantee, 0 for a schema grantee. In a database named `it's [odd] db`, raw `db_name()` NULL, `quotename(db_name())` 1. |
| B10 | Policies seen: none by the reader; only its schema's by a schema VIEW DEFINITION grantee; all by a database grantee; **none by VIEW SECURITY DEFINITION alone**. With database VIEW DEFINITION and a deny on a schema, that schema's policy is hidden and a count of object denies reads 0. |
| B11 | SQL Server: `dbo` reads both tenants, the writer tenant 1, the reader 229. On both engines the writer's insert of an order for tenant 2's customer succeeds: foreign-key checks are not filtered. |
| B12 | B6 on SQL Server, as writer, reader, a schema grantee, a column-denied user and `sa`: 62, 29, 140, 9 and 140 statements, no disagreement. |
| B13 | A login mapped to a user of another name: `user_name()` the user, `original_login()` the login. A db_owner member is its own user; only `sa` or the database owner is `dbo`. |
| B14 | PostgreSQL: an identity, ALWAYS or BY DEFAULT, inserts without sequence privilege; a `serial` column fails 42501 on its sequence. |
| B15 | SQL Server: INSERT only, through `NEXT VALUE FOR` a sequence of the table's owner: succeeds. |
| B16 | A view over the policed table: SQL Server applies the table's predicate through it; a PostgreSQL view owned by the superuser shows both tenants, and with `security_invoker` tenant 1. |
| B17 | PostgreSQL writer with INSERT and UPDATE on `customer`: inserting tenant 2 is refused ("new row violates row-level security policy"); updating tenant 2 is `UPDATE 0`. |
| B18 | 500 tables of 20 columns, three runs: PostgreSQL's four checks per column 199–205 ms against 8 ms for the catalog read alone; SQL Server's three `HAS_PERMS_BY_NAME` per column 855–1,082 ms as a non-sysadmin and 390–402 ms as `sa`, against 161 ms. |
| B19 | SQL Server: database VIEW DEFINITION held through a role is enough to see every object, the policy, and no hidden check. |

## Decision

1. **Every column says what the account may do with it** — `access: { select,
   insert, update }` — as the database's own privilege check answered at
   discovery. PostgreSQL: `has_schema_privilege(n.oid, 'USAGE') AND
   has_column_privilege(c.oid, a.attnum, …)`, keyed by oid and attnum, never
   through a name cast. SQL Server: `HAS_PERMS_BY_NAME` with
   `QUOTENAME` on the object and the column, and INSERT on the object, since
   a column INSERT grant does not exist. A NULL answer is an error.
2. **Every table or view says whether row security applies to the account** —
   `rowSecurity: 'none' | 'applies' | 'unknown'`, about its own policies only.
   PostgreSQL: `row_security_active(oid)`, always established. SQL Server:
   `applies` when an enabled predicate targets it, which needs no privilege to
   be positive evidence; `none` only with database VIEW DEFINITION and no
   VIEW DEFINITION or CONTROL deny on any object or schema for the account or
   its roles; otherwise `unknown`, with one scope `row-security` gap saying
   why. `createSnapshot` refuses `unknown` without such a gap.
3. **A gap says what it is about** — `subject: { kind: 'scope' } | { kind:
   'schema', schema } | { kind: 'object', object }` replaces `object:
   ObjectRef | null`, in the catalog's spelling, never compared with the
   scope's (SQL Server matches the scope by collation). Gaps sort scope,
   schema, object.
4. **A snapshot names its account** — `account: { user, login }`: PostgreSQL
   `current_user` and `session_user`, SQL Server `USER_NAME()` and
   `ORIGINAL_LOGIN()`. The fingerprint is `schemaHash({ kind, account:
   account.user, objects, gaps })`: the user is the principal privileges and
   policies are evaluated for; a login mapped to the same user is the same
   principal.
5. **Generation offers what the account may do.** No field over a column it
   may not read. Each field writes per operation — bindings `writes: { create,
   update }` replace `writable`, and are version 2 — so a column it may INSERT
   and not UPDATE is written on create and read-only on update, with a note,
   and the document disables a field only when it writes on neither. Create
   is not offered without INSERT; update is not offered when the form would
   write something but for privilege and may write nothing. The identity is
   the first key the account may read. A root, a pinned column, a confirmed
   version column or a lookup column it may not read throws. Row security
   that applies or cannot be established on the root or a lookup target, and
   every view, is an `access` note. The planner, the lookup configuration
   and the server's bundle check hold a bindings file to the same rules.
6. **Drift reports privileges, row security and the account.**
   `privilege-narrowed`, `privilege-widened`, `row-security-changed` and
   `account-changed` join the kinds, and a schema joins the subjects:

   | Change | Kind | Effect |
   |---|---|---|
   | A bound column lost SELECT | privilege-narrowed | breaks reads |
   | An identity column lost SELECT | privilege-narrowed | breaks reads |
   | A confirmed concurrency column lost SELECT | privilege-narrowed | breaks reads: every read names it, and so does every create's RETURNING or OUTPUT |
   | A version column lost UPDATE | privilege-narrowed | stops update |
   | A column a field writes on create lost INSERT | privilege-narrowed | stops create |
   | A bound, non-generated column not written on create lost INSERT | privilege-narrowed | stops create (a pin may write it; bindings do not record pins) |
   | A column a field writes on update lost UPDATE | privilege-narrowed | stops update |
   | A lookup target's key or display column lost SELECT | privilege-narrowed | stops both, affects the lookup |
   | Any other capability change on the root or a target | privilege-widened or -narrowed | info |
   | Row security changed on the root or a target | row-security-changed | review |
   | Another user | account-changed | breaks reads with row security on the root or a target in either snapshot; review otherwise |

   A change that makes a write unsafe stops only the operations on which the
   column is written. A `row-security` gap is for review and stops nothing.
   Row security goes no further than review because neither adapter reports
   a write done that the table does not hold (B17; SQL Server's refind, 0017).

The fixture gains what proves it: a policy on `sales.customer` that binds
`formancy_writer` to tenant 1 on both engines, and that writer, holding the
order form's grants through the role `formancy_forms` — on SQL Server with
database VIEW DEFINITION.

## Consequences

**What it buys.** A form does not offer what the account's grants on its own
tables refuse — a view's tables are the exception below: an
unreadable column is no field where it was a 42501 or 230 at the first read, a
column the account may not UPDATE is written on create and refused only as a
changed value on update, and a create without INSERT is not offered. A
revoked grant is a privilege change in drift, where it was a dropped table or
a gap. Row security that binds the account is said on the form and in drift.
Rotating a connection's credentials to another principal is drift, not an
empty report. PostgreSQL describes every table in scope, because pg_catalog
and the privilege functions answer every role; a PostgreSQL snapshot carries
no gap unless its scope holds a foreign table.

**What it costs.**

- SQL Server without database VIEW DEFINITION, or with a VIEW DEFINITION or
  CONTROL deny on any object or schema, always carries a row-security scope
  gap. The documented minimum for a snapshot with no gap grows from schema to
  database VIEW DEFINITION.
- Capabilities are what was true at discovery. A grant revoked later still
  fails at runtime, and is translated as `permission-denied`, until drift
  review sees it.
- `applies` says nothing about which rows: a changed policy expression is not
  drift.
- A view is not followed to its tables (B16): its own row security says
  nothing about its rows, so every view root or lookup target carries a note.
  Nor do its own grants say a read succeeds. A PostgreSQL view reads its
  tables with its owner's privileges, or the reader's when it is
  `security_invoker`; without them every read is refused 42501 while the
  view's columns say SELECT (measured on postgres:17-alpine, 2026-10-09, and
  pinned by the PostgreSQL discovery-access suite), and the generator offers
  such a view. SQL Server checks the caller on the tables behind a view whose
  owner differs from theirs (a broken ownership chain); that is untested
  here. The view note says a read through it may be refused.
- The privilege functions and PostgreSQL's `row_security_active` read live
  catalog state, not the discovery transaction's snapshot, so a GRANT or an
  ALTER committed mid-discovery can make an answer a moment later than the
  rows beside it. SQL Server's column check looks the column up by name when
  it runs: a concurrent rename was measured in review to report a granted
  column as not granted (4 of 394 checks against 400 renames). Both are put
  right by the next snapshot, and the rename fails closed.
- A policy that reads the login (`SUSER_SNAME()`, `session_user`) rather than
  the user is not followed, and a login change is not in the fingerprint.
- DELETE, REFERENCES and EXECUTE are not described.
- A PostgreSQL `serial` or `nextval` default needs USAGE on its sequence,
  which is not described, so such a create fails `permission-denied` (B14).
  SQL Server's `NEXT VALUE FOR` default did not need it when the sequence and
  the table share an owner (B15); a sequence with another owner is untested.
- A field written on create only is not disabled on update — formancy has no
  per-operation mode — and the server refuses a changed value (0022).
- An account rotation is drift: blocking while row security is in play,
  review otherwise.
- Discovery spends the privilege checks B18 measured: about 200 ms per ten
  thousand columns on PostgreSQL, and about a second on SQL Server as a
  non-sysadmin (2026-10-09, Docker Desktop, 20 CPUs).
- A PostgreSQL membership `WITH INHERIT FALSE` counts as no privilege, which
  matches the server until a `SET ROLE` this module never issues (B4).
- Every form published before this record is republished: version-1
  bindings and a snapshot without an account are refused, by the planner,
  the lookup configuration, drift review and the server's bundle check.
- The studio's PostgreSQL reader no longer shows gaps; the SQL Server reader
  is the capture that does.

**What it does not do.** `absence()` in drift review still compares
`scope.schemas.includes(ref.schema)` case-sensitively. On a case-insensitive
SQL Server database whose scope is configured as `SALES`, a missing root reads
as `scope-narrowed` where the catalog spelled the schema `sales`. Fixing that
is its own change.

**Found in review, and fixed with a test that failed first.** Drift said a
confirmed concurrency column that lost SELECT stopped update only, while both
adapters name it in every read and every create's RETURNING or OUTPUT; it
now breaks reads, and so does one that is gone, where 0010 had it stop
update only. `accessDisagreements` compared only the columns an adapter
reported, so one reading a privilege-filtered catalog — the failure this
record removes — passed for the writer; it now compares the column list with
the model's. The server's publish check refused a row filter on an
unreadable column and not one on a column the account may not INSERT, which
every create writes; it refuses both while create is offered. The studio
offered a lookup over an unreadable root column, and unreadable display
columns, which the generator refuses; it disables them with the reason. SQL
Server's block predicate refusal (33504) was `unavailable`, where
PostgreSQL's row security refusal is `permission-denied`; both are now
`permission-denied`. A VIEW DEFINITION deny on a schema made to `public` was
counted for `sa` and `dbo`, whom no DENY binds, so the owner read `unknown`
behind a gap; only a deny `HAS_PERMS_BY_NAME` applies is counted now. And
the schema gap's spelling under a scope spelled otherwise, which
`createSnapshot` no longer checks, is held by a test. Three comments that
claimed more than the code does were corrected: that PostgreSQL's privilege
answers and row security share the transaction's moment, that SQL Server's
one-statement read keeps a column's access from tearing, and what the
dropped column in PostgreSQL's column-grant test guards.

## Alternatives considered

**Column lists in a gap's detail.** Rejected: a sentence is for a person, and
the generator, the planner and drift each need to ask one column one
question.

**Object-level capabilities only.** Rejected: PostgreSQL grants columns, and
SQL Server grants and denies them, both measured (B6, B8); an object answer
would be wrong in both directions.

**The login in the fingerprint.** Rejected: a login mapped to the same user
is the same principal (B13), and renaming one would be drift about nothing.

**The account outside the fingerprint.** Rejected: B5 — the same connection
under another `current_user` reads other rows, and equal fingerprints would
take drift's fast path past it.

**Schema VIEW DEFINITION as proof of no policy.** Rejected: B10 — a policy in
another schema on this schema's table is invisible to it.

**VIEW SECURITY DEFINITION.** Rejected: B10 — alone, it shows no policy at all.

**Counting the rows the account can see.** Rejected: it costs a scan per
table, says nothing about writes, and a policy that hides nothing today is
still a policy.

**`unknown` blocking.** Rejected: an account without database VIEW DEFINITION
is common and legitimate, and blocking it would make every such SQL Server
form unusable to say "cannot tell"; the gap and the note say it instead.

## Older records

Narrowed, not edited away: 0004's gap shape and fingerprint contents; 0006's
describing only usable objects, and its `columns` gap; 0007's minimum
privilege for no gap, and its column denied SELECT that only a read revealed;
0009's single write flag, which is now one per operation, and its four note
kinds, now five; 0010's drift kinds, the writes a column change stops, and
its concurrency column gone, which now blocks the form.
Extended: 0005's fixture, by the writer, its role and the policy on
`sales.customer`, and its comparator by `accessDisagreements`; 0017's
refusals by their number, by 33504.
