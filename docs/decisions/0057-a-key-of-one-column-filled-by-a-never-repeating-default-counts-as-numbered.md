# 0057 — A key of one column that `gen_random_uuid()` or `newsequentialid()` fills, and no foreign key includes, counts as one the database numbers

- **Status:** accepted
- **Date:** 2026-10-12
- **Deciders:** Daniel Bacher
- **Verified by:**
  both adapters' `uuid.integration.test.ts`, against `postgres:17-alpine`
  (17.11) and `mcr.microsoft.com/mssql/server:2022-latest` (16.0.4295.3),
  discovery, generation, the reads and the deletes run as the order form's
  own account after the owner's setup, each case declared with `covers()`
  and its expectation written once in `UUID_PARITY`
  (`@formancy/data-fixtures`): under `uuid: generated` the delivery form
  generated from what that account discovers of the shared fixture offers
  delete on both engines -- on PostgreSQL over its version column, on SQL
  Server by its rowversion -- and under `uuid: delete` a grant of it is
  refused on both for the parcels that cascade from a delivery and for
  nothing else (watched failing on PostgreSQL before the rule: no delete,
  and the grant refused as not offered too). Under `uuid: defaults`, in a
  schema of the suites' own, tables keyed by a uuid and guarded by an `int`
  version column differ in the default that fills the key, and the
  account's snapshot spells each as the engine does: on PostgreSQL
  `gen_random_uuid()`, a constant
  `'2b7e1516-28ae-4d2a-a6f7-15880945cf4f'::uuid`, `uuid_generate_v4()` from
  `uuid-ossp`, and a function of that schema named `gen_random_uuid`
  spelled `minted.gen_random_uuid()`; on SQL Server `(newsequentialid())`,
  `('2b7e1516-28ae-4d2a-a6f7-15880945cf4f')`, `(newid())` and
  `([minted].[newsequentialid]())`. Two more fill their key with the
  engine's own and differ in one more thing: a tenant beside it in a key of
  two columns, generated with the tenant pinned, and a key that refers to
  the first table's. And the engine's own written in the DDL in upper case,
  in mixed case and in parentheses -- on PostgreSQL also qualified with
  `pg_catalog` -- is spelled as the first on each engine. A form offers
  delete over the first and those three alone. A row of the first, inserted
  by the owner, is read by its token at version 1, the version column's
  default, deleted at that version, planned as the server plans one over
  the table as the request describes it, and answered with its key in lower
  case on both engines; the same delete again is not found (watched failing
  on both engines before the rule: no table offered delete, and the delete
  was refused as not offered; with the default matched by the function's
  name inside it: the lookalike offered delete on both; and with the
  foreign keys not asked: the key that refers to another offered delete).
  On PostgreSQL alone, the same account discovering through a
  `search_path` of `minted, public, pg_catalog` gets the same spellings and
  the same offers, while a description read through that path spells the
  first table's default `pg_catalog.gen_random_uuid()` and its delete is
  refused as `drift` (watched failing with discovery under the session's
  path: the lookalike was spelled bare and offered delete, and the six keys
  PostgreSQL's own fills were spelled `pg_catalog.gen_random_uuid()`, the
  four of them that offered delete offering none).
  `packages/data-core/src/generate/generate.test.ts` -- a version-column
  delivery whose whole key `gen_random_uuid()` fills on PostgreSQL, or
  `(newsequentialid())` on SQL Server, offers delete, and one guarded by a
  rowversion does whatever its key (watched failing before the rule:
  PostgreSQL's offered none); a constant, `uuid_generate_v4()`, `newid()`,
  a function named like the engine's in another schema, the other
  engine's spelling, a definition the account could not read and the
  engine's own beside a pinned tenant each offer none, with the note
  naming the engine's default (watched failing with every default on a
  key of one column counted: all ten of one column offered delete; with
  the expression matched by the function's name inside it: the three
  lookalikes did; and with the one-column rule removed: both keys of two
  columns did); and a key the engine's own fills that is also a foreign
  key offers none on either engine, whether the form looks up through it
  -- and so writes it on create -- or not (watched failing with the
  foreign keys not asked: all four offered delete).
  `records/plan-delete.test.ts` -- an order keyed by a uuid
  `gen_random_uuid()` fills is planned on PostgreSQL by its snapshot's own
  engine, and the same claim over a constant, or over a key a foreign key
  includes, is `invalid-bindings` (watched failing with the planner asking
  SQL Server's rule of the PostgreSQL snapshot: the first was refused; and
  with the foreign keys not asked: the last was planned).
  `drift/delete.test.ts` -- on each engine, that key's default changed to a
  constant or to another function, or dropped, and on SQL Server hidden,
  stops delete in review and at runtime, blocking where somebody may
  delete; the same spelling, or another column's default changed, stops
  nothing (watched failing with the rule asked only when the key's
  generation changes: review and the runtime kept delete for each; and on
  SQL Server with the rule asked of PostgreSQL's spelling: every change
  kept delete); and a foreign key added over the key stops delete in
  review and at runtime, said on the foreign key, where one over another
  column stops nothing (watched failing with the foreign keys not asked:
  delete kept on both engines). `drift/fixture.ts`'s properties hold over
  each: the runtime never refuses what review allows, and over a change to
  the root's definition alone the two give one report.
  **Not mechanically enforced:** that `gen_random_uuid()` and
  `newsequentialid()` never hand out one value twice, which is the
  engines' design and the person's decision, not a measurement; and the
  edges under *What it does not do*.

## Context

0050 offers delete on a table whose concurrency token is a version column
the module maintains only where the table's identity includes a column the
database numbers, an identity of either kind. A version column starts at
its default on every insert, so a record deleted at version 1 and created
again under its key is at version 1 too, and a stale delete, a stale update
or a delete sent again after a lost answer lands on the new record. An
identity is never written by a form (0026), a lookup's included, so the
module never creates a deleted record's key again.

A key the database fills by its default is not an identity: the catalog
calls it `generated: 'none'`, because the column takes a value given to it.
0056 made such a key, where it is all of the key the policy does not pin,
read-only in a generated form -- but a lookup over a foreign key that
includes it still writes it, from the record a person chooses, as it
writes any lookup's columns. 0050 did not count such a key as numbered, so
on PostgreSQL the fixture's `sales.delivery` -- a uuid key from
`gen_random_uuid()`, guarded by an application-maintained `row_version` --
offered no delete, where SQL Server's, guarded by a rowversion, did. 0050's
alternative *Count a key a default fills as numbered* lost "for now": a
default may hand out one value twice, a constant does, and the snapshot
holds a default only as the expression the engine spells. Naming the
defaults that never repeat was left to a rule of its own.

The person decided on 2026-10-12: a key of one column filled by
`gen_random_uuid()` on PostgreSQL or `newsequentialid()` on SQL Server
counts as numbered, because in practice neither hands out the same value
twice; any other default -- a constant, a sequence someone can reset,
`uuid_generate_v4()` unless measured and named -- does not, until a later
record says so. And the default is recognised from the snapshot's column
facts, as discovery reports the expression on each engine, compared
exactly, never by a part of a name an outsider can choose.

What discovery reports, measured on 2026-10-12 by the uuid suites on the
images above, as the order form's account. PostgreSQL's `pg_get_expr`
deparses the stored expression, so however the DDL writes PostgreSQL's
own function -- `GEN_RANDOM_UUID()`, `Gen_Random_Uuid()`,
`(pg_catalog.gen_random_uuid())` -- it is spelled `gen_random_uuid()`;
`uuid-ossp`'s in `public` is `uuid_generate_v4()`, and a function of
another schema with the same name `minted.gen_random_uuid()`, its schema
included. SQL Server's `object_definition(default_object_id)` -- read
rather than `sys.default_constraints`, because a default bound with
`sp_bindefault` is not a constraint (0007) -- spells `NEWSEQUENTIALID()`,
`(NewSequentialId())` and `((newsequentialid()))` alike as
`(newsequentialid())`, `newid()` as `(newid())`, and a function of the
database's own as `([minted].[newsequentialid]())`. SQL Server calls a
function of a schema only by a name with its schema, so a bare
`newsequentialid()` is always its own. `pg_get_expr` leaves a function's
schema out where the session's `search_path` finds that function by its
bare name, and PostgreSQL searches `pg_catalog` first unless the path
names it later. Under a path that names it after a schema holding a
function called `gen_random_uuid` -- whoever may CREATE in that schema, in
`public` every login on PostgreSQL 14 and earlier, can plant one -- the
planted function was spelled bare and counted, and PostgreSQL's own was
spelled `pg_catalog.gen_random_uuid()` and did not: measured by the
PostgreSQL suite before discovery put `pg_catalog` first. A sequence's
next value is not this record's: discovery already reports `nextval(...)`
and `NEXT VALUE FOR` defaults as `identity-by-default` (0026), which 0050
counts.

## Decision

- **A key column is numbered when it is an identity of either kind, or
  the whole key, not generated, with a default the snapshot spells exactly
  as its engine spells the default that never repeats** --
  `gen_random_uuid()` on PostgreSQL, `(newsequentialid())` on SQL Server,
  chosen by the snapshot's own `kind` -- **and included in no foreign key
  of the table.** Any form over the table may offer a lookup through such
  a key, and a lookup writes it, so the default is not what fills it there.
  One predicate, `numbersKey`, in `generate/offers.ts`, which
  `versionProvesRecord` asks of the identity's columns; the generator, the
  planner (`deleteUnoffered`) and drift review all ask it, so none of them
  offers what another refuses.
- **Nothing else counts:** a constant; another function that makes uuids,
  `uuid_generate_v4()`, `newid()`, PostgreSQL 18's `uuidv7()`; a function of
  a schema's own with the same name, which the catalog spells with its
  schema; the other engine's spelling; a default the account may not read,
  which SQL Server reports without its definition; the engine's own
  default on one column of a key of two, even with the other column
  pinned, because a form without that pin writes the uuid (0056); and the
  engine's own on a key a foreign key includes.
- **PostgreSQL's discovery reads with `pg_catalog` first** in its
  transaction's `search_path`, before the session's own, so PostgreSQL's
  own function is the one spelled bare whatever the composition root's
  path holds (0006). Under a path that does not name `pg_catalog` -- the
  default among them -- it is searched first already and nothing is
  spelled otherwise.
- **Drift review asks the rule again** of the table as it is now: on a
  version-column form, the key's default changed to anything else, dropped
  or hidden is the same loss as an identity dropped, whatever else the
  column's change is called, and is said on the key column; a foreign key
  that comes to include the key is the same loss, said on the foreign key.
  Delete stops in review and at runtime, which read both from the
  request's own description of the root (0041).
- **The generator's note names the engine's default**: "A key with an
  identity column, a key of one column that gen_random_uuid() fills and no
  foreign key includes, or SQL Server's rowversion, can."

## Consequences

**What it buys.** PostgreSQL's deliveries offer delete as SQL Server's do,
and so does any version-column table keyed by a uuid alone that
`gen_random_uuid()` or `newsequentialid()` fills and that refers to no
other table through its key: the usual shape of a table keyed by a uuid.
A grant of delete on the fixture's delivery form is still refused, for the
parcels that cascade from a delivery, until a policy can name such a key
(0051). A function planted under a name like PostgreSQL's own is never
counted in a snapshot, whatever the discovering session's path.

**What it costs.**
- That the two defaults never repeat is their design, not something this
  repository measured. `gen_random_uuid()` draws 122 random bits, so two
  keys alike are possible and improbable past anything a table holds.
  `newsequentialid()` is documented to stay unique across restarts, where
  its values may start again from a lower range; 0056 measured them rising
  across one container's restart, not more. A repeat after a delete would
  start the new record's version where the deleted one's did, as a typed
  key's does.
- A table whose key is also a foreign key -- one that extends another row
  by sharing its key -- offers no delete over a version column, though its
  default fills the key whenever no lookup does.
- The default is recognised by its spelling, so a server release that
  spells it otherwise offers no delete over it, and drift reports the
  respelling as the key's default changed. That fails closed.
- On PostgreSQL a request's description of the root is read in the
  request's own statement, under the session's `search_path`, as 0016's
  statements are: a path that names `pg_catalog` after a schema holding a
  function called `gen_random_uuid` spells PostgreSQL's own with its
  schema there, so the runtime reads the key's default as changed and
  refuses every delete of such a form as `drift`, which review, reading
  with `pg_catalog` first, does not report. It withdraws an offer and never
  makes one. And under such a path a type or a function of that schema
  that shadows one a column's type or default names is spelled differently
  by discovery since this record, so a snapshot taken under it before
  differs from one taken now, once, where something was shadowed.
- SQL Server reports a default's definition only to an account that may
  view it, and otherwise a default without one (0007); such a key does not
  count, and the form offers no delete over a version column. That fails
  closed.

**What it does not do.** Another application that inserts a deleted
record's key by hand restarts its version, as it does over a by-default
identity: outside a version column's guarantee already (0016, 0050). A row
filter on the key column itself writes the key from the context on every
create, so where that column is the whole key a record deleted is created
again under its key by the next create in that context, its version
starting where the deleted one's did -- as over a by-default identity
since 0050; inferred from the planner, not tested, and not refused. No
default but the two is counted, `uuid_generate_v4()` and `newid()`
included, though both draw random keys: neither is named by the person's
decision, and each is a record's to add with what it rests on. A
rowversion table is unchanged: it proves a record whatever its key.

**What it forecloses.** Recognising a never-repeating default by its
function's name, or by anything less than the whole expression.

## Alternatives considered

**Leave such a key uncounted, as 0050 did.** PostgreSQL's deliveries, and
every version-column table keyed by a uuid alone, would offer no delete,
for a repeat that their defaults are designed never to make. The person
decided otherwise.

**Match the function's name inside the expression**, so `public.gen_random_uuid()`
or a cast would count. A function of the same name in another schema is
somebody else's -- in the suites, one that returns the same key every
time -- and matching a part of the expression would count it.

**Recognise the default in discovery, as a generation kind.** 0056 lost it
for the same reasons: a list of names in the snapshot's contract, its
fingerprint changed for every table so keyed, and every reader of
`generated` taught a kind, where the identity, the default and the engine
already give the fact. One predicate over them decides it here.

**Count `uuid_generate_v4()` and `newid()` too**, which draw random keys as
`gen_random_uuid()` does. Not decided by the person, and `uuid-ossp`'s
function is an extension's, installed in a schema the deployment chooses,
so its spelling is not one this record can write down once.

**Count the default on any column of the key**, as an identity counts
anywhere in it. A form that pins nothing writes a defaulted column of a
key of two (0056), so a person could create a deleted record's key again.
An identity is never written by any form.

**Count a key a foreign key includes unless this form looks up through
it.** The form would write nothing, but another form over the same table
could look up through the key and create a deleted record again under it,
at version 1, and a stale delete through the first would then be answered
`deleted` -- seen on both engines in review of this record. Whether any
form looks up through a key is not this form's to know.

**Spell defaults under the session's `search_path`, as discovery did.**
The path is the composition root's, and whoever may CREATE in a schema it
names before `pg_catalog` would choose which key counts, and which form
offers delete over a key that repeats.

**Read the request's description under `pg_catalog` first too**, so that
the runtime never refuses what review allows under such a path. The
description is read in the statement that reads or writes the record
(0041), and `SET LOCAL` would need a transaction around every one of them,
for which 0016 rejected setting the path in the first place; discovery
runs in a transaction of its own already.
