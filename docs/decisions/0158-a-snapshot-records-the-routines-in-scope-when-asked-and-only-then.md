# 0158 — A snapshot records the routines in scope when asked, and only then

- **Status:** accepted
- **Date:** 2026-11-16
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/snapshot.test.ts` -- a scope that does not ask
  for routines makes the snapshot data-core at 4a979d6, the release before
  this record, made of the same objects, gaps and server: its fingerprint
  and the canonical hash of the whole snapshot are literals computed there,
  with no `routines` and a scope of schemas alone (watched failing with an
  absent list hashed as an empty one: the fingerprint, and the literal 0049
  pinned too; and with every scope saying whether it asked: the whole
  snapshot's hash, the fingerprint unchanged).
  `packages/data-core/src/routines.test.ts` -- routines are present exactly
  when the scope asks, an empty list is an answer that hashes otherwise
  than none, and a scope asking as anything but `true` is refused (watched
  failing with the ask unheld: a list without one and an ask without a list
  accepted); routines sort by schema, name and signature in codepoint
  order and a routine's parameters keep their order (watched failing with
  the sort taken out); EXECUTE, reach, a parameter's type identity and its
  default are in the fingerprint, and a `routines` gap is an aspect the
  contract names (watched failing with routines left out of the hash); a
  `routines` gap in a snapshot whose scope did not ask is refused (watched
  failing with that check taken out); a routine reported twice, a malformed
  ref, a kind, effects, returns, reach or mode outside its list, a
  non-boolean executable, a scalar without a result, a void or set with
  one, a parameter without a type id, a database type, a listed kind or a
  text length unit, a parameter's default that is neither a boolean nor
  null, and a SQL Server signature are refused naming the routine (watched
  failing with the duplicate check, the reach list, the void's result check
  and the default's check each taken out).
  `packages/data-core/src/drift/diff.test.ts` -- a routines gap against a
  base that never asked for routines is no change, either way round, one
  that appeared between two snapshots that both record routines is
  `access-narrowed` at `info` and stops nothing, and a routine that changed
  is no change, since nothing binds one (watched failing without the
  filter: `drift/fixture.ts`'s check that routines change no report against
  a base without them, which every drift suite now passes through; and with
  routines gaps always dropped: no change between two that record them).
  `packages/data-server/src/bundle.test.ts` -- `fixtures/bundle-before-0158.json`,
  a bundle data-server and data-core at 4a979d6 published, validates with
  the fingerprint it was published with (watched failing, alone of the
  file, with an absent list hashed as an empty one); a bundle whose
  snapshot records routines validates, its form and bindings those the
  same tables make without them, and one whose routine was edited after
  discovery is refused (watched failing with routines left out of the
  hash).
  `packages/data-fixtures/src/conformance.test.ts` -- `routineDisagreements`
  passes a perfect snapshot as the owner, the reader and the writer on
  either engine, holds each engine to its own edition, and notices a
  routine missing or from nowhere, a wrong kind, reach, effects, returns,
  parameter name, mode or type, and an executable other than the model
  gives the account (watched failing with executable uncompared), and a
  parameter's default other than its engine's catalog gives (watched
  failing with defaults uncompared); a routine missing from a restricted
  account's snapshot is a disagreement unless a routines gap covers it,
  and always when the model says the account may execute it, and a
  routines gap on the owner's is one (watched failing with each rule taken
  out). `load.test.ts` -- each
  SQL Server file opens a batch with each CREATE PROCEDURE (watched failing
  with a statement before the fixture's), and each edition creates the
  routines the model gives its engine (watched failing with PostgreSQL's
  renamed). `cases.test.ts` -- `FIXTURE_ROUTINES` is a family of the two
  shared cases (watched failing without it).
  `packages/data-postgres/src/discovery-routines.integration.test.ts`,
  against postgres:17-alpine (17.11) on 2026-11-16, and
  `packages/data-sqlserver/src/discovery-routines.integration.test.ts`,
  against mcr.microsoft.com/mssql/server:2022-latest (16.0.4295.3) the same
  day, each loaded with the shared fixture and declaring
  `MODEL_CASES.routines` and `MODEL_CASES.routineAccess` with `covers()`:
  the owner discovers the routines the model gives its engine and the
  objects the model's, and a scope that does not ask has no routines and
  the same objects and gaps (watched failing on each engine with routines
  read whether or not the scope asks: refused by `createSnapshot`); EXECUTE
  as the owner, the reader and the writer is `FIXTURE_ROUTINES`', and each
  is the answer a call gets (watched failing on PostgreSQL with EXECUTE
  unasked, USAGE alone, and with the writer's grant or the revoke from
  PUBLIC taken out of the fixture; on SQL Server with the writer's grant
  taken out). On PostgreSQL: EXECUTE held through PUBLIC is executable and a
  revoke from PUBLIC is not (watched failing with EXECUTE unasked); a
  routine in a schema without USAGE is listed, not executable, and behind
  no gap (watched failing with USAGE unasked); an extension's functions are
  left out, its schema's own recorded (watched failing with extension
  members kept: 37 routines); every shape no action could bind is recorded
  with the fact that refuses it -- a procedure, a result, a set, a TABLE,
  OUT, INOUT or VARIADIC argument, an unnamed parameter, a domain, an enum,
  bytea and bare bpchar unsupported, varchar(20) and numeric(14,2)
  unbounded, two overloads, SECURITY DEFINER -- and an aggregate is not
  (watched failing with aggregates read, with sets and non-IN arguments
  filtered out, with parameters read from `proargtypes` alone, with
  SECURITY DEFINER unread, and with STABLE and IMMUTABLE read as writing);
  which parameters have a default is recorded, and beside an overload that
  differs by a defaulted trailing parameter every call by the shorter
  signature is 42725, cast or named, while the longer answers (watched
  failing with every default read as false);
  a SECURITY DEFINER function reads what its caller may not; each entry of
  `ROUTINE_TYPES` is the oid the server gives its name (watched failing
  with an entry naming another type), and a parameter of each is the kind
  a column of it is (watched failing with uuid left out). On SQL Server: a
  DENY under a role's GRANT is not executable (watched failing with VIEW
  DEFINITION asked instead of EXECUTE); a table-valued function is
  executable by SELECT on it -- an inline one granted SELECT is, a
  multi-statement one granted nothing is not -- each the answer a call
  gets (watched failing with EXECUTE asked of every routine); the reader sees only what it holds a
  permission on, with each parameter, behind a routines gap on the schema,
  an account with VIEW DEFINITION on the schema sees what it may not run
  and no gap, and one denied VIEW DEFINITION on a routine has a gap on the
  scope (watched failing with no routines gap, and with VIEW DEFINITION
  asked instead of EXECUTE); a routine marked as Microsoft's is left out
  (watched failing with `is_ms_shipped` unasked); a replication-filter
  procedure is not recorded and a routines gap on it says it is there,
  and only when the scope asks (watched failing with RF taken out of the
  statement); a parameter whose alias or table type the account cannot
  see is unsupported, behind a routines gap on the routine (watched
  failing with the hidden flag unread); a parameter's default is `null`,
  though a call may leave it out and `has_default_value` says 0 (watched
  failing with defaults read as false, which fails both shared cases
  too); every shape no action
  could bind is recorded -- a scalar's result, an inline and a
  multi-statement table-valued function, an OUTPUT parameter as `inout`, an
  alias type, a table type, sysname and varbinary unsupported, varchar(20)
  and decimal(14,2) sized, EXECUTE AS (watched failing with table-valued
  functions dropped, with OUTPUT read as in, with alias and table types
  normalised through their base, and with a function's reach read as the
  account's); a procedure and a scalar function read a table their caller
  may not, by ownership chaining; each entry of `ROUTINE_TYPES` is what
  `TYPE_ID` gives its name (watched failing with an entry naming another
  type), and a parameter of each is the kind a column of it is.
  `packages/data-sqlserver/src/discovery/routines.test.ts`, from the
  statement's rows -- a NULL answer is refused as a defect, naming the
  routine and the permission asked, SELECT for a table-valued function
  (watched failing without the guard, and with EXECUTE named for every
  routine); each CLR and replication-filter routine is a routines gap on
  it, and none is recorded (watched failing with every type read); a
  parameter's or a result's hidden type is a gap on the routine (watched
  failing with the hidden flag unread); and a routine is its own rows'
  parameters, none when its row carries none, each default `null`.

## Context

Administrator-named actions will run routines the deployment keeps in its
database, as 0156 foresaw for their refusals. Before anything can bind one, the catalog
has to say which routines exist, what each takes and returns, what it may
change, whether it may act beyond its caller's grants, and whether the
connection's account may run it. A snapshot said none of it: it held tables,
views and gaps, a `DiscoveryScope` was its schemas alone, and neither
adapter read `pg_proc` or `sys.procedures`.

Every published bundle's snapshot is hashed again on every read (0019). A
fact added to every snapshot moves every fingerprint a release takes, and a
server older than the release refuses what it cannot read: 0049 kept its
facts optional for the first reason, and 0068 named the second for a new
gap aspect. And SQL Server's catalog is filtered by permission (0007, 0027):
a routine an account holds nothing on is not listed to it at all.

What the servers answered, on postgres:17-alpine (17.11) and
mcr.microsoft.com/mssql/server:2022-latest (16.0.4295.3), 2026-11-16, in the
containers the fixture's own harness starts, each held since by the
discovery suites named above:

| Probe | What the server answered |
|---|---|
| R1, PostgreSQL | A new function is executable by every role through PUBLIC; revoked from PUBLIC, a call by the reader is 42501, and `has_function_privilege` says false. A function in a schema the reader has no USAGE on is listed in pg_proc to it, and a call is 42501 whatever EXECUTE says. pg_proc lists every routine to every role. |
| R2, PostgreSQL | pg_proc keeps no typmod: `varchar(20)` and `numeric(14,2)` parameters are `varchar` and `numeric`, `char(2)` is bare `bpchar`. A procedure without output arguments has `prorettype` void, and one with an OUT argument `record`. An extension's functions depend on it with `deptype = 'e'`. A SECURITY DEFINER function reads, for the reader, a table it may not read; the same function without it is refused 42501. |
| R3, SQL Server | A DENY of EXECUTE to the writer beats its role's GRANT: refused 229, and HAS_PERMS_BY_NAME says 0. An account with EXECUTE on three routines of a schema, and no VIEW DEFINITION, sees those three in sys.objects with their parameters, and nothing else of the schema; one with VIEW DEFINITION on the schema sees every routine of it, one it may not run included, refused 229; one denied VIEW DEFINITION on a routine does not see it under a schema grant. A routine `sp_MS_marksystemobject` marks is `is_ms_shipped`. |
| R4, SQL Server | Ownership chaining: the reader, who may not select from a table, reads it through a procedure and through a scalar function it may execute, neither with EXECUTE AS. A scalar function's result is parameter 0 in sys.parameters; an alias type's `user_type_id` is its own, and `sysname`'s is 256 over nvarchar's 231. |
| R5 | data-core and data-server at 4a979d6, the release before this record, read: `createSnapshot` takes no `routines` and hashes without them, so a snapshot that carries them does not hash to its own fingerprint there, and a `routines` gap is "not one the contract names". Read in the code, not run. |
| R6, SQL Server | An account granted SELECT on an inline table-valued function calls it, and is refused 229 by a multi-statement one it holds nothing on; HAS_PERMS_BY_NAME asked EXECUTE of the inline one answers 0. A procedure made `FOR REPLICATION` is type RF, and its body may hold only SELECT, GOTO, IF, WHILE, RETURN and DECLARE. A T-SQL parameter declared with a default has `has_default_value` 0, and a call may leave it out. An account with EXECUTE on a procedure and nothing on the alias and table types of its parameters gets NULL from sys.types for each: the alias's system type is still named, the table type's is not. |
| R7, PostgreSQL | Beside `f(integer)`, `f(integer, integer default 0)` makes `f(1)`, `f(1::int4)` and `f(n => 1)` each 42725, "is not unique"; `f(1, 2)` answers. `pronargdefaults` counts the defaults, which are the last of the arguments a call passes. |

## Decision

1. **Read only when asked, hashed only when present.** `DiscoveryScope`
   gains `routines?: true`. A scope without it reads nothing more, and the
   snapshot is the one discovery made before, to the byte. With it, the
   snapshot's `routines` is the routines in scope -- an empty list is
   "none", absent is "not read" -- and the scope says it asked.
   `createSnapshot` refuses a list without the ask and an ask without a
   list, and hashes the list only when it is there. Nothing in the server
   asks yet: a connection's scope is its schemas, so every snapshot the
   server takes is the one it took before this record.
2. **Every routine in scope, with the fact that would refuse it.**
   `RoutineMeta` (`packages/data-core/src/routines.ts`): `ref` -- schema,
   name and, on PostgreSQL, a signature of the argument types a call passes,
   each qualified by its schema so no search_path spells it; `kind`;
   `parameters` in order, each with its catalog name, its mode, its
   database spelling, its `typeId`, its normalised type and whether it has
   a default; `effects`; `returns` and a scalar's `result`; `reach`;
   `executable`. A routine no action could bind -- a procedure on
   PostgreSQL, a function on SQL Server, a result, a set, a parameter that
   is not `in`, one with no name, one of a type no codec speaks -- is
   recorded, never dropped, so the generator a later record writes can say
   which rule refused it. Not a routine in this contract's sense, so
   neither recorded nor gapped: what is neither a function nor a procedure
   -- PostgreSQL's aggregates (`prokind` 'a') and window functions ('w'),
   SQL Server's CLR aggregates -- which no action could ever be; an
   extension's functions; SQL Server's `is_ms_shipped` routines. Not read,
   and said by a `routines` gap on each (6): SQL Server's CLR routines,
   which no container of the suites can hold without an assembly, and its
   replication-filter procedures, which run only as replication's filter.
   The `table` mode is PostgreSQL's alone, a column of what a RETURNS TABLE
   function returns; a set's shape is described nowhere else, and is not
   compared across the engines.
3. **A type is the engine's own identity, and a codec's only through the
   adapter's table.** `typeId` is PostgreSQL's type oid and SQL Server's
   `user_type_id:max_length:precision:scale`. Each adapter's `ROUTINE_TYPES`
   is a closed table of the built-in types a codec speaks, keyed by that
   identity -- by oid; by user_type_id, which an alias type has of its own
   -- and a type outside it is `unsupported`: a domain, an enum, a
   composite, an array, bare bpchar, bytea; an alias or table type,
   sysname, binary. A later record spells a cast from that table and from
   nothing else; `databaseType` is for a person and never reaches a
   statement.
4. **What a routine does, as each engine enforces it.** PostgreSQL: STABLE
   and IMMUTABLE read, anything else may write, SECURITY DEFINER reaches as
   its owner. SQL Server: a function reads, since the engine refuses a
   write inside one; a procedure may write and returns `void`, its RETURN
   status being the integer every procedure has; a scalar function's result
   is parameter 0; an inline or multi-statement table-valued function is a
   set; an OUTPUT parameter, which takes a value in as well, is `inout`; and
   every routine reaches as its owner, by ownership chaining (R4), so
   EXECUTE AS adds nothing `reach` could say and is not read. Whether a
   parameter has a default: PostgreSQL's `pronargdefaults`, recorded
   because beside an overload that differs by a defaulted trailing
   parameter every call by the shorter signature is ambiguous (R7), so a
   generator must refuse it; SQL Server's catalog keeps no T-SQL
   parameter's default (R6), so there it is `null`, never `false`.
5. **Whether the account may run it is the server's own answer.**
   PostgreSQL: `has_schema_privilege(n.oid, 'USAGE') and
   has_function_privilege(p.oid, 'EXECUTE')`, by oid, as 0027 asks of a
   column. SQL Server: HAS_PERMS_BY_NAME on the QUOTENAME'd routine,
   EXECUTE, and SELECT for a table-valued function, which takes no EXECUTE;
   a NULL is a defect, said.
6. **A new gap aspect, `routines`, where the catalog can hide one.**
   PostgreSQL needs none (R1). On SQL Server, by the check that gives
   tables theirs and from the same answers (`visibility.ts`): a schema in
   scope without VIEW DEFINITION is a gap on the schema, and a VIEW
   DEFINITION or CONTROL deny on an object, which cannot be placed, a gap on
   the scope. And a gap on one routine, named as an object -- no table or
   view in its schema can share its name there -- for each routine it
   shows and does not read (2), and for each whose parameter's or result's
   type the account cannot see in sys.types, as a column's is (R6). Only a
   snapshot that asked carries one, and `createSnapshot` refuses one in any
   other, which keeps the rollback cost below to the snapshots that asked.
   A routine and its parameters are read in one statement, joined on
   object_id, so neither is paired with another's.
7. **Drift compares routines only between two snapshots that both record
   them**, as it compares a `referenced-by` gap only between two that record
   what refers to a table (0049): a routines gap against a base that never
   asked is no change, and between two that did is said, at `info`. No
   family reads a routine yet: nothing is bound to one.
8. **One routine written twice.** The fixture's `sales.ship_order(order id,
   tenant)` ships an order: a function returning void on PostgreSQL, whose
   PUBLIC EXECUTE the file revokes, and a procedure on SQL Server, which
   grants it to nobody by default; `formancy_forms` may execute it on both.
   SQL Server's security predicate on customer, `sales.fn_customer_tenant`,
   is a routine PostgreSQL's file has no counterpart for, and the model says
   so. `FIXTURE_ROUTINES` is the neutral truth, `routineDisagreements` the
   comparator -- an account that is not the owner may meet a routine absent
   only behind a routines gap that covers it, and never one it may execute,
   which both engines list to it -- and two shared cases,
   `model: the owner discovers the fixture's routines` and `access: who may
   execute the fixture's routines`, hold both adapters to it.

## Consequences

**What it buys.** A snapshot can say, before anything is bound, every routine
in scope, what it takes, what it returns and changes, whether it reaches
past its caller's grants and whether its account may run it -- or that it
cannot tell -- on both engines, from one contract. A later record's
generator refuses a routine from what the snapshot recorded, and its runs
cast every argument from a table no catalog string reaches.

**What it costs.**

- **Rolling the server back.** The gap aspects are a closed list and the
  fingerprint covers routines, so a server older than this record refuses
  every snapshot that carries them, and every form published from one, on
  every read (R5) -- as 0068 says of a new aspect. Read only when asked,
  that is the forms discovered with routines, not every form published
  after the upgrade. Rolled back, such a form serves again once it is
  published from a discovery that did not ask, or the server is upgraded
  again.
- **Regenerating to add an action.** A form whose snapshot has no routines
  is discovered again, with routines, before it can offer one.
- **Fingerprint churn.** In a snapshot that records routines, any routine
  change in scope moves the fingerprint and sends drift review past its
  shortcut, as a table change in scope does. An extension's functions are
  left out, so an extension upgrade does not.
- Discovery that asks reads more of the catalog (`discovery/routines.ts`
  in each adapter). Nobody has measured how long discovery takes, before or
  after, and discovery is not in the measured product (0034): no number is
  written.
- A SQL Server account without VIEW DEFINITION on a schema in scope has a
  routines gap on it whenever routines are asked, whether or not one is
  hidden.
- pg_proc keeps no length, precision or scale for a parameter, so a
  PostgreSQL `varchar(20)` parameter is unbounded and `char(n)` is
  unsupported: a later dialog over one is checked only as far as its type
  says. SQL Server's catalog keeps them. The engines differ, and the
  adapters say so.
- Whether a STABLE PostgreSQL function that calls a VOLATILE one is stopped
  from writing through it is not checked, so `reads` is relied on only
  inside a read-only transaction.
- A SQL Server CLR or replication-filter routine in scope is not read: a
  gap on it says it is there, and nothing of what it takes or whether the
  account may run it. The CLR types reach that gap through the statement's
  list of types, which no container of the suites exercises for them; a
  replication filter, which one can hold, runs the path on a server, and
  the gap is built from rows a unit test gives every type.
- A SQL Server parameter's default is not in its catalog, so whether one
  has a default is `null`: a later dialog cannot leave a parameter out on
  the catalog's word there, as it can on PostgreSQL.
- A SQL Server parameter whose type the account cannot see is
  unsupported, behind a gap on its routine, though an account that may see
  the type would read the same routine as one an action could bind.
- A set's columns are described only for a PostgreSQL RETURNS TABLE
  function, as `table` parameters, and not for RETURNS SETOF or a SQL
  Server table-valued function: what a set returns is not compared across
  the engines.
- On SQL Server a routine is read with its parameters in one statement,
  and under READ COMMITTED a statement is not one consistent read: an
  ALTER that commits while it runs is not claimed to be seen whole, as the
  tables' reads are not (0007).
- Every SQL Server routine is read as reaching past its caller's
  grants, so `reach` cannot tell a procedure with EXECUTE AS from one
  without. Whether `sys.sql_modules` shows `execute_as_principal_id` to an
  account without VIEW DEFINITION was not measured, because nothing reads
  it.
- The fixture's writer, and the composed stack's, may execute
  `sales.ship_order`, which writes an order's status.

**What it does not do.** Nothing binds, runs or shows a routine: the
generator, the policy, the planner, the server's routes, the studio and the
host are unchanged, and no route asks for routines. A routine's body is not
read. Triggers are still not recorded.

**Forecloses:** nothing.

## Alternatives considered

**Read routines in every discovery.** Lost: every snapshot a release takes
would hash otherwise than the one before, every form published after an
upgrade would be refused by a server rolled back, and every routine change
in scope would move the fingerprint of every form, though few will ever
bind a routine.

**An absent list read as an empty one.** Lost: the hash of every snapshot
stored before this record would change, and every published form would be
refused on read as edited after it was taken; and "not read" would read as
"none".

**Record only the routines an action could bind.** Lost: a routine left out
reads as one that does not exist, the silent answer 0004 refuses, and the
generator could not say why a routine an administrator expected is not
offered.

**Name a type by its spelling** -- `format_type`, `sys.types.name`. Lost: a
catalog string would become SQL, a type of a user's schema named like a
built-in one would pass for it, and on PostgreSQL a `varchar` parameter
that became `text` would look unchanged, since neither keeps a length.

**Spell the signature with `format_type`.** Lost: it qualifies a type only
when the session's search_path does not find it, so one routine would have
two signatures under two paths; qualified names do not depend on the path.

**Read EXECUTE AS for SQL Server's reach.** Lost: ownership chaining reaches
past the caller's grants without it (R4), so it changes nothing `reach` says,
and it may need VIEW DEFINITION on the module to read.

**Read CLR routines.** Lost here: no container of the suites can hold one
without an assembly, loaded from a hex literal and trusted by its hash, so
the reader would be code no test runs. A gap on each instead, built from
rows a unit test gives, and run against a server through a replication
filter, which the containers can hold.

**Leave a CLR routine out, and name the cost.** Lost: it is the answer the
record refuses for a routine no action could bind -- a snapshot that asked
would say nothing where a routine is (0004).

**One routines gap on each schema that holds a routine not read.** Lost: a
schema's gap covers every routine in it, so a routine missing from a
restricted account would read as explained by a CLR routine beside it, and
drift would report a new CLR routine as an access problem. On the routine,
the gap covers it alone.

**Leave a parameter's default to the record that binds.** Lost: what a
routine records is in the fingerprint, so a fact added later moves the
fingerprint of every snapshot that records routines, and on PostgreSQL a
generator could not refuse a routine whose every call is ambiguous (R7).

**A visibility gap on PostgreSQL.** Lost: pg_proc lists every routine to
every role (R1), so it would say "cannot tell" where the snapshot can.

## Older records

Extended, not edited away: 0004 (a new aspect, `routines`, and in the
fingerprint the routines when the scope asked for them, and only then);
0005 (the fixture's routine written twice, and SQL Server's predicate, which
the model writes down; `FIXTURE_ROUTINES`, `routineDisagreements` and two
shared cases); 0006 (PostgreSQL discovery reads pg_proc when asked, every
function and procedure but an extension's, EXECUTE by oid, with no gap);
0007 (SQL Server discovery reads the T-SQL routines Microsoft did not ship
when asked, and says by a routines gap where its catalog may hide one, and
on each routine it does not read or whose parameter's type it cannot see);
0010 (drift compares a routines gap only between two snapshots that both
record routines); and 0027 (one more capability, EXECUTE on a routine, asked
of the server as for a column, and the visibility rule for tables shared
with routines, so the two cannot disagree; its "REFERENCES and EXECUTE are
not described" is now REFERENCES).
