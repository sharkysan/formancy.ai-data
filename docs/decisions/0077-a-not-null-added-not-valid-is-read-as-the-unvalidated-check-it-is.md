# 0077 — A NOT NULL that PostgreSQL 18 added NOT VALID is read as the check it is: the column nullable, the constraint enforced and not validated

- **Status:** accepted
- **Date:** 2026-10-17
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-postgres/src/discovery-pg18.integration.test.ts`, on
  `postgres:18-alpine` in every PostgreSQL leg (0067). *A NOT NULL added NOT
  VALID on PostgreSQL 18 reads as CHECK (… IS NOT NULL) NOT VALID does: a
  nullable column and an enforced, unvalidated check* -- the server first
  refuses a new NULL in each of the two columns, 23502, and keeps the row
  older than the constraints that holds NULL in both; then both columns
  read nullable, one of them named `Paid On`, which must be quoted; the
  table's columns are exactly those of a twin table on which the same two
  rules are `CHECK (… IS NOT NULL)` added NOT VALID, and its checks are that
  table's checks but for their names, the quoted expression included; and
  the description a request reads of the table (0041) is discovery's.
  Watched failing: before this record, with both columns read not nullable;
  with only the description reading `attnotnull`, on the description, the
  columns `nullable: false`; and with the column's name spelled into the
  expression unquoted, on `(Paid On IS NOT NULL)`. *A NOT NULL added NOT
  VALID on PostgreSQL 18, once validated, reads as NOT NULL with no check*
  -- nullable with one unvalidated check before `VALIDATE CONSTRAINT`, not
  nullable and no check after (watched failing before this record, the
  column not nullable before). *A NOT NULL added NOT VALID over a row type
  on PostgreSQL 18 reads as CHECK (… IS DISTINCT FROM NULL) NOT VALID does,
  the rule it keeps* -- a column of a composite, of a domain over it, of a
  domain over that domain and of an array of the composite each takes a
  value whose every field is NULL, and the NULL itself is refused; then the
  three row-typed constraints read `(col IS DISTINCT FROM NULL)` and the
  array's `(col IS NOT NULL)`, as a twin table's hand-written checks do
  (watched failing on `(pair IS NOT NULL)`, and with the chain of domains
  walked one step only, on `(bounded IS NOT NULL)`). The rest of the
  PostgreSQL suite on 15, 16, 17 and 18, where pg_constraint has no
  unvalidated row of type `n` -- 15 to 17 none at all -- and so reads as it
  did: the shared model's columns and checks against the conformance
  comparator, and
  `records-definition.integration.test.ts`'s *describe reads every fixture
  table as discovery does*, which reads the same constant through the
  description, as the owner, the reader and the writer.
  `packages/data-core/src/drift/columns.test.ts`, *tightened on a bound
  column blocks writes of that field; loosened is informational* and *a
  column no field writes, made NOT NULL with no default, stops create and
  only create* (watched failing with create kept whenever a change leaves a
  column needing a value) -- what drift review does with the column when
  the constraint is validated; `generate/generate.test.ts`, *excluded
  columns are noted, and create is refused when a required column cannot be
  filled*, which offers create over a nullable column no codec reads
  (watched failing with a nullable column counted as needing a value);
  and `records/drift.test.ts`, *refuses a page when the table no longer
  holds the key to a total order, which a read allows*, with
  `drift/columns.test.ts`'s *the concurrency column changed blocks update,
  and gone blocks the form* -- what a form published before this record
  over such a column meets. **Not mechanically enforced:** that every query
  of the adapter that reads whether a column holds NULL reads `NOT_NULL`
  and not `attnotnull`; a query written later that reads `attnotnull`
  would claim the NOT NULL again, and only a test that reached it on 18
  would fail. Held by review.

## Context

PostgreSQL 18 files every NOT NULL in `pg_constraint`, as a row of type `n`
(`VERSION_FACTS.notNullConstraints`, 0067), and lets one be added NOT VALID:
`ALTER TABLE t ADD CONSTRAINT n NOT NULL col NOT VALID`. New and changed rows
are held to it; the rows already there are not checked. Measured on
2026-10-16 against `postgres:18-alpine` answering 18.6 (0067): the
constraint catalogues as `contype n, convalidated f`, and
`pg_attribute.attnotnull` is true from the moment it is added, over a row
holding NULL. 15.19 and 17.11 refuse the statement as a syntax error, 42601.

Discovery read NOT NULL from `attnotnull` alone
([0006](0006-postgres-discovery-reads-pg-catalog.md)), so on 18 such a column
was reported not nullable while a row older than the constraint held NULL.
0067 characterised it and left it undecided. What followed from the claim:

- the generator made the field required (`generate.ts`: a create writes it,
  and it is neither nullable nor defaulted), and a lookup over a foreign key
  of such a column required too;
- a record whose row holds that NULL opened with a required field empty,
  and the codec refused a NULL for it before the database was asked;
- a unique key over the column counted as one that holds no NULL, which a
  page of records is ordered by (0044), and an integer column counted as one
  a form's version column may be, though a version that is NULL matches no
  update's guard.

Before 18 the same intent has one spelling, `CHECK (col IS NOT NULL) NOT
VALID`, which every version in the matrix accepts -- over a row type, a
composite or a domain over one, `CHECK (col IS DISTINCT FROM NULL) NOT
VALID`, since there `IS NOT NULL` is true only when every field is non-null,
which a NOT NULL does not ask. Discovery reads it, on every version, as what
it is: `attnotnull` is false, so the column is nullable, and the check is
reported with the expression the server deparses, `(col IS NOT NULL)` or
`(col IS DISTINCT FROM NULL)`, enforced and not validated (0026). Nothing about a form's rows differs
between the two spellings: both refuse a new NULL, and both may hold an old
one.

A snapshot says what its account can establish and nothing more
([0004](0004-a-snapshot-says-what-it-could-not-see.md),
[0027](0027-a-snapshot-says-what-its-account-may-do.md)), and a capability
that is not proven is not claimed: fail closed, upstream's
[formancy.ai 0022](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0022-fail-open-fail-closed.md).
A NOT NULL nothing has checked the old rows against is not proven.

SQL Server has no NOT NULL that skips the rows already there: Microsoft's
documentation of `ALTER TABLE` says `ALTER COLUMN … NOT NULL` fails while the
column holds a NULL, and `WITH NOCHECK` applies to foreign keys and checks
alone. Its spelling of the same intent is `CHECK ([col] IS NOT NULL)` added
`WITH NOCHECK`, which discovery already reads as a nullable column and an
enforced, untrusted check (0026). That was read in the documentation and not
measured here. So the case is PostgreSQL's alone, and not a shared case: the
shared model loads on every image of both engines, and 15 to 17 cannot hold
it.

## Decision

- **A column holds no NULL when `attnotnull` is true and no NOT NULL
  constraint over it is unvalidated.** `NOT_NULL`, in
  `packages/data-postgres/src/discovery/columns.ts`, is that condition: no
  row of `pg_constraint` of type `n` on the column's relation, over its
  attnum, with `convalidated` false. Discovery reads it, and so does the
  root's description a request reads (0041), from the one constant, so the
  runtime reads the column as review did and its digest moves when the
  constraint is validated.
- **The unvalidated constraint is reported among the table's checks**, as the
  check `CHECK (col IS NOT NULL) NOT VALID` is reported: by its own name,
  with the expression `(col IS NOT NULL)`, the column's name quoted as
  `pg_get_expr` quotes it (`format`'s `%I`, the same `quote_identifier`),
  enforced and not validated. A row of type `n` has no `conbin`, so the
  expression is spelled by the adapter; `pg_get_constraintdef` would give
  DDL, `NOT NULL col NOT VALID`. Over a row type -- a composite, or a domain
  over one at any depth, the chain `ROW_TYPED` in `checks.ts` walks, as
  PostgreSQL's own `type_is_rowtype` does -- it is `(col IS DISTINCT FROM
  NULL)`, as `CHECK (col IS DISTINCT FROM NULL) NOT VALID` is reported: the
  NOT NULL takes a value whose every field is NULL, which `(col IS NOT
  NULL)` refuses, so that spelling would report a rule stricter than the
  database keeps.
- **Validated, it is the column's NOT NULL and not a check**, as every NOT
  NULL on 15 to 17 is and as 0067 recorded for 18: the shared model's checks
  are the same list on every leg.
- **One query on every version.** 15 to 17 have no row of type `n` on a
  relation, so both reads answer there as they did; nothing branches on the
  server's major.

## Measured

On 2026-10-17, on Windows 11 Pro with Docker Desktop (WSL 2), one suite at a
time. Before the fix, `discovery-pg18.integration.test.ts` on
`postgres:18-alpine` failed both of its NOT NULL cases with the columns read
not nullable, and passed its NOT ENFORCED case. After it, the whole
data-postgres suite, run with `FORMANCY_IMAGES` naming each image of the
matrix, passed 378 of 378 on each: `postgres:17-alpine` answering 17.11,
`postgres:18-alpine` 18.6, `postgres:15-alpine` 15.19 and
`postgres:16-alpine` 16.15, the pg18 file on 18.6 in every one. With the
row-type case added, it passed 379 of 379 on each, the same four builds
answering. None of it is a CI figure.

Later the same day, against `postgres:18-alpine` answering 18.6, by hand
and by a script that ran data-core's generator and its runtime drift check
as built at this record over tables on that server:

- A NOT NULL added NOT VALID took `row(null, null)` in a column of a
  composite, of a domain over it and of a domain over that domain, and
  `CHECK (col IS NOT NULL)` refused it in each, 23514; `pg_get_expr` spelled
  the hand-written `CHECK (col IS DISTINCT FROM NULL)` as `(col IS DISTINCT
  FROM NULL)`, and `CHECK (col IS NOT NULL)` over an array of the composite
  took an array of such a value. A domain's `typcategory` is its base's, `C`
  for each of the three, but a base type may declare any category, so
  `ROW_TYPED` walks `typbasetype` instead.
- A form generated from a table keyed by a unique index over a column with
  such a constraint, a second one confirmed as its version column, both read
  not nullable as before this record: its page refused, `column-loosened`,
  its update and delete refused, `concurrency-changed`, its read allowed;
  generated again from the table as read now, the version column was
  refused, "it must be a non-nullable integer".
- A table whose `json` column, which no codec reads, had such a constraint
  and no default: generated as read before this record, create was not
  offered, "doc must be given a value and no field can give one"; as read
  now, it was, and an insert leaving the column out was refused, 23502. Once
  the constraint was validated, review reported `column-tightened`,
  blocking, "A create must now give it a value, and no field of this form
  can, so create is blocked", and the runtime refused create.
- An update of a row older than the constraint that still held the NULL,
  naming another column, was refused, 23502, and so was the same update under
  `CHECK (col IS NOT NULL) NOT VALID`, 23514.

## Consequences

**What it buys.** On 18 a column reads the same whichever way the operator
spelled "no new NULL here": nullable, with a check that is enforced and not
validated. The generator makes its field optional, a record holding the old
NULL opens without a required field empty, and neither a key nor a version
column rests on a NOT NULL that may be false. Every table without such a constraint
reads exactly as before on every version, so no snapshot taken on 15, 16 or
17, and none of a table on 18 without one, changes its fingerprint.

**What it costs.**

- A column whose NOT VALID NOT NULL the operator meant as NOT NULL -- the
  usual reason is to add one to a large table without the scan, and validate
  it later -- is generated optional until `VALIDATE CONSTRAINT` runs. A
  create or an update that leaves it empty reaches the database and is
  refused there, 23502, answered `not-null-violation`, where the form would
  have said "A value is required." before sending anything.
- What rested on the column holding no NULL is refused until the
  constraint is validated: a form keyed by a unique key over it lists no
  page, "This form's key can be NULL", and the column is not offered as a
  version column, "it must be a non-nullable integer".
- Create is offered where such a column has no default and no field writes
  it on create -- excluded for its type, unreadable or not insertable --
  and the database refuses every create, 23502, unless a trigger fills the
  column. Read not nullable, the column kept create from being offered,
  "must be given a value and no field can give one". The generator reads
  `nullable` and not a check (0026), so it offers the same create over the
  rule spelled `CHECK (col IS NOT NULL) NOT VALID`, on every version.
- When the constraint is validated, the column tightens: drift review
  reports `column-tightened`, "it no longer accepts null", which blocks the
  writes of a form that writes the column, and the create of a form no
  field of which writes it on create, "A create must now give it a value",
  until the form is reviewed; the runtime refuses those operations too,
  since the description reads the column as review does (0041). The check
  disappearing is reported beside it, as information. On 15 to 17 the same
  comes with `SET NOT NULL` after a validated check, not with the
  validation.
- A form published on 18 before this record over such a column was
  published with it not nullable. Read now, the column has loosened and a
  check has appeared, and what the form rested on the column holding no
  NULL stops. A form keyed by a unique key over the column lists no page --
  drift refuses it, `column-loosened`, and once the form is reviewed the
  planner does, "This form's key can be NULL" -- until the constraint is
  validated, though a record is still read by its token. A form whose
  version column is the column has update and delete blocked,
  `concurrency-changed`, since any change to a form's version column stops
  both, and a review cannot confirm the column again, "it must be a
  non-nullable integer", until the constraint is validated. A form whose
  published control can no longer hold the column's values -- a boolean
  shown as a checkbox, which cannot say NULL -- has its writes of the
  column blocked until it is reviewed. Anywhere else it is a note in
  review.
- The expression is spelled by the adapter. It is what `pg_get_expr` spells
  the hand-written check as on 18, `IS NOT NULL` or, over a row type, `IS
  DISTINCT FROM NULL`, which the test holds there, and on no other version:
  a later PostgreSQL that deparsed either otherwise, or counted another
  kind of type a row type, would show the two spellings apart only when a
  test ran it.
- A NOT NULL over a table whose rows hold no NULL at all is still read as
  nullable until it is validated: discovery reads the catalog and counts no
  rows.
- What the generator, the codec, the list, review and the runtime do with
  the column is each data-core's rule for a nullable column, tested there
  on fixtures (`generate/`, `codecs/`, `records/`, `drift/`); no test runs
  them against such a column on 18, and the script under *Measured* ran the
  generator and the runtime's drift check against one once. What this
  record's tests show is the snapshot and the description.

**What it does not do.** It validates nothing and runs no statement against
a table's rows. The form still does not translate a check (0026); the
database enforces it, with its own error. An update of a row older than the
constraint that still holds the NULL is refused by the database whether the
form writes the column or not, as it was before this record and as it is
under the check; a form that does not bind the column cannot mend the row.
Nothing here was tried on a NOT NULL added NOT VALID to a partitioned table
or to a parent of inheritance children, and a NOT NULL made `NO INHERIT` and
18's virtual generated columns are still untested (0067). SQL Server reads
as it did.

## Alternatives considered

- **Read `attnotnull` as 18 sets it**, as before this record. The snapshot
  claims of the old rows more than the database keeps, and the generator,
  the codec and the key rules act on that claim; and two spellings of one
  rule read differently.
- **Refuse the column**, as unsupported or behind a gap. It is readable and
  writable, and the same rule spelled as a check is refused on no version;
  a whole column would be lost for a fact the check already says.
- **Count the column's NULLs at discovery**, and read it not nullable when
  there are none. Discovery reads the catalog; this would scan a table, as
  an account row security may hide rows from, which is the scan the
  operator added NOT VALID to avoid.
- **A third value for `nullable`**, "refuses new NULLs, may hold old ones".
  A change to the contract, both adapters and the generator for a state
  one version of one engine holds, which the check already says in the
  contract's own words.
- **Branch on the server's major.** One query reads the same on every
  version; a branch is one more thing that differs between legs.
- **Keep create from being offered where such a column has no default and
  no field writes it**, counting an enforced, unvalidated NOT NULL as a
  value a create must give. The generator would have to read the check,
  which it does for no check (0026), or the contract hold the third value
  of `nullable` above; and create would still be offered over the same rule
  spelled as a check.
- **Spell the check `IS NOT NULL` whatever the column's type.** One
  spelling, and the one a person writes; over a row type it is a stricter
  rule than the NOT NULL keeps, and the snapshot would report a
  `row(null, null)` the column holds as refused.

## Older records

Extended, not edited away: [0006](0006-postgres-discovery-reads-pg-catalog.md)
(NOT NULL is read from `attnotnull` unless an unvalidated NOT NULL
constraint is over the column, which is read as a check) and
[0067](0067-the-adapter-suites-run-on-every-image-of-a-per-engine-matrix.md)
(the NOT NULL added NOT VALID it characterised and left undecided is
decided here; its `notNullConstraints` row says discovery reads an
unvalidated row of type `n`). 0026 and 0041 are applied, not changed.
