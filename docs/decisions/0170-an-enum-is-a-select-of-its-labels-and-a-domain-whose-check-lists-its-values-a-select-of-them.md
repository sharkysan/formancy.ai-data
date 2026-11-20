# 0170 — An enum is a select of its labels, and a domain whose check lists its values a select of them

- **Status:** accepted; extends [0152](0152-a-column-whose-values-a-check-lists-is-a-select-of-them.md): PostgreSQL's enums and domains over a list, the later record it named, read the same way -- a domain's check is a list as a table's is, and an enum's labels are its type; extends [0004](0004-a-snapshot-says-what-it-could-not-see.md): the snapshot's contract names an enum and a column's domains, absent from every snapshot taken before; extends [0006](0006-postgres-discovery-reads-pg-catalog.md): PostgreSQL discovery reads `pg_enum` and walks a domain's chain; extends [0010](0010-drift-is-classified-against-the-bindings.md) and [0041](0041-the-runtime-refuses-what-drift-blocks.md): a label gone is a tightened column, in review and at runtime, and one added a field the column outgrew; extends [0005](0005-one-fixture-written-twice.md): a schema PostgreSQL's alone, held by the shared comparator to a model of its own; extends [0127](0127-a-host-page-draws-a-state-field-as-the-moves-its-person-may-make.md): a state field over an enum keeps its moves; extends [0149](0149-a-new-record-starts-with-its-columns-constant-default.md): an enum's default, `'placed'::sales.order_state`, starts its field
- **Date:** 2026-11-20
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/generate/enums.test.ts` -- a snapshot as
  discovery took it before 0170, an enum, a domain and an array of an enum
  each unsupported, fingerprints and generates to the bytes its
  predecessor (a26567b) made of it, pinned on 2026-11-20, and none of its
  columns carries `domains` (watched failing with `createSnapshot` writing
  `domains` onto every column, undefined where it has none); an enum is a
  select of its labels in the order the type gives them (watched failing
  with the labels sorted by codepoint: high came first), required where
  NOT NULL without a default and taking NULL where nullable, a label with
  a quote, a comma, blanks or letters past ASCII one option; an empty label
  or none at all is shown and never written (watched failing with the
  labels taken as they are: the released validator refused the empty
  option); its codec takes a label and nothing else (watched failing with
  any text taken); its default, qualified, bare or quoted, starts its
  field, a cast to another name, a CoerceViaIO and a backslash do not, and
  no other kind's cast default is read (watched failing with the enum left
  out of the readers); a starting value is one of its labels; its filter
  offers equality with a label alone (watched failing with a range
  offered); its codec's refusal, a person's field error, names no type
  (watched failing with the type named); a key value is one of its labels
  (watched failing with any text taken); a state field's moves are between
  labels (watched failing with a state field held to text and whole
  numbers); an enum no catalog could have produced is refused (watched
  failing with its shape unchecked).
  `packages/data-core/src/generate/domains.test.ts` -- a
  domain's check as PostgreSQL deparses one, `VALUE` for the value, read
  as a list over varchar, text and an integer, as one value, as an OR, and
  with awkward values (watched failing with the table's reader asked); a
  column's name, `"VALUE"`, lower case, a comparison and a cast to an enum
  are no list (watched failing with a quoted name read as the value); a
  domain's list is a select naming the domain (watched failing with the
  domains left unread), at any depth of the chain; added NOT VALID, beside
  the table's or beside another domain's, it is no select and says why
  (watched failing with the domain check's state ignored); a default the
  list names starts the field, and one it does not is none, said naming
  the domain (watched failing with the check named alone); never read on
  SQL Server (watched failing with it read there); a malformed chain is
  refused and a domain's checks sorted by name (each watched failing with
  its rule removed). `packages/data-core/src/drift/enums.test.ts` -- an
  enum and a listed domain unsupported in the published snapshot and read
  now are a note and stop nothing (watched failing with the message as it
  was: "from sales.order_state to sales.order_state"), but for a domain NOT
  NULL with no default the form never wrote, which stops create; a label
  added is a field the column outgrew, for review, stopping nothing
  (watched failing with it read as the type loosened alone: a note), a label
  renamed a tightened column stopping writes in review and at runtime
  (watched failing with the labels left out of the comparison: nothing
  stopped), a label renamed under a select the form only shows a field
  the column outgrew, for review (watched failing with it read as a
  narrower column alone: a note), the type renamed another type, an enum
  read before and unsupported now said as such (watched failing with
  "from sales.order_state to sales.order_state"); a lookup keyed by an
  enum blocked by a label added or renamed, said by its labels (watched
  failing with the spelling alone); an enum and a domain respelled by the
  search_path no change, in review and at runtime, and a domain retyped to
  another still one (watched failing with the spelling compared alone:
  both blocked the form); a domain's list narrowed,
  widened, dropped, no longer validated, or beside a NOT VALID one, as 0152
  weighs a table's, the runtime comparing none (watched failing with the
  domains left out of review's lists). `packages/data-core/src/lookup/searchable.test.ts`
  and `display.test.ts` -- an enum is searched and shown as its label.
  `packages/data-core/src/records/list-terms.test.ts` and
  `plan-list.test.ts` -- a list's search over an enum column, as the
  planner writes it, is read by the terms every adapter's list reads its
  request through, its type rebuilt, and one whose type was edited by hand
  refused (watched failing with text and integer alone taken: every search
  of such a form failed on PostgreSQL before a statement was built).
  `apps/studio/src/policy-moves.test.tsx` -- the Policy step offers an
  enum field as a state field, and its moves publish as typed (watched
  failing with text and whole numbers alone offered).
  `packages/data-postgres/src/discovery/types.test.ts` -- an enum, and a
  domain over one, is its labels (watched failing with the labels left
  unread); a domain over text or a whole number is its base type with the
  innermost domain's modifier, over any other unsupported (watched failing
  with every base read); an array of an enum is unsupported; a column of
  no domain has no `domains` key (watched failing with it written as
  undefined). `packages/data-postgres/src/sql/types.test.ts` -- an enum is
  bound cast to its own quoted name (watched failing with it bound as
  text). `packages/data-fixtures/src/states.test.ts` -- the comparator
  holds an enum's name and labels in order (watched failing with a type's
  properties compared by identity), a column's domains, its checks' flags
  and what data-core reads of each, and none where the model names none
  (watched failing with the domains left uncompared); the states fixture
  creates the tables its model names. Against real servers, written on
  2026-11-20 without one and run first in CI, on every image of the
  matrix: `packages/data-postgres/src/states.integration.test.ts` -- the
  states schema discovered as STATES_MODEL says, the root's description
  reading every column as discovery does, the ticket form's selects,
  boxes, columns left out and defaults, a lookup onto a table keyed by an
  enum, and the near misses: awkward labels, an empty label and none, a
  type in a schema whose name needs quoting and its default, a domain's
  list added NOT VALID, a domain over a domain, an array of an enum, a
  domain's default dropped, or set on the domain below it, after it was
  declared, read as none and met by the engine (23502), and an enum in a
  schema the reader may not use unsupported for it and left out, its cast
  refused (42501);
  `states-records.integration.test.ts` -- a create and an update of a
  label of every select read back as given, the column's and the domain's
  defaults stored, a label the codec refuses and one past it the engine
  refuses as out of range (22P02), a value a domain's list leaves out a
  check violation, a page sorted by an enum in its type's order both ways
  and paged after a row one at a time, a search and a filter on a label,
  an export's cells, the same sort, paging, filter and cells over a domain
  over varchar and one over an integer, each listed, and one over text
  that is not, a record read by a token spelling its label, a lookup
  onto it searched, resolved and a token that is no label rejected without
  failing the statement, and a state field's moves;
  `states-drift.integration.test.ts` -- the form discovered with the
  schema on the search_path and reviewed and described without it, no
  drift; ADD VALUE, a domain's list replaced
  NOT VALID, validated and dropped, and RENAME VALUE, each reviewed, decided
  by the runtime over a description and met by the database; a write
  decided before a label was added refused by the definition's guard, the
  labels digested; and the type renamed under a planned write a changed
  schema (42704), and another type in review.
  `packages/data-postgres/src/discovery-types.integration.test.ts` -- its
  enum is read as one, its domain over numeric still unsupported.

## Context

[0152](0152-a-column-whose-values-a-check-lists-is-a-select-of-them.md)
made a column whose values one check lists a select of them, and left
"PostgreSQL's enums and domains over a list" to a later record, read the
same way. Until now discovery reported both as `unsupported`
(`discovery/types.ts` matched a type by name within `pg_catalog` alone), so
the generator left a column of either out of every form with a note: an
enum, the shape PostgreSQL gives exactly the finite set of states 0152
draws as a select, could not be shown at all.

The two are not the same fact. A domain's check is an expression, filed in
`pg_constraint` with `contypid` set, deparsed by `pg_get_expr` as a table's
is with `VALUE` where the column stands --
`((VALUE)::text = ANY ((ARRAY['red'::character varying, …])::text[]))` --
and a domain may be declared over another, which `checks.ts` already walks
for a row type. An enum has no check: its labels are rows of `pg_enum`, in
`enumsortorder`, which is the order the engine sorts and compares them in,
and text has no cast to it but through its input function, so a value
bound as text, as every value is bound (`sql/statement.ts`), is refused in
an insert with 42804 and in a comparison with 42883.

0152 read its lists out of the spelling the snapshot already held, and
kept the list off the snapshot, because a property added to it changes its
contract and its fingerprint: every captured snapshot would have needed
capturing again, and every stored bundle's snapshot would lack it. Neither
holds here. No captured snapshot holds an enum or a domain -- the shared
fixture's `sales`, from which the studio's and the examples page's
captures are taken, has neither -- and an enum's labels are not in the
snapshot to read: they have to be carried, or not had.

SQL Server has no enum, and normalises an alias type --
`create type sales.status from varchar(20)` -- as its system type, as it
has since [0007](0007-sqlserver-discovery-and-what-it-hides.md); an alias
type carries no check, and a rule bound to one (`sp_bindrule`, deprecated)
is not read.

## Decision

**An enum is a type of its own in the snapshot**: `{ kind: 'enum', name,
labels }` (`metadata.ts`), `name` the type a value is cast to, `labels`
its labels in `enumsortorder`. A domain over an enum is the enum.
**A column of a domain carries its chain** (`ColumnMeta.domains`), outermost
first, each domain with its checks as `pg_get_expr` spells them, and its
type is the one the chain ends in, with the innermost domain's modifier; a
domain's NOT NULL is the column's, and the default of the domain the
column is declared with its default where it has none of its own -- what
an INSERT that leaves it out stores, since `get_typdefault` reads the
column's type alone: CREATE DOMAIN copies the default of the domain it is
declared over, once, and an ALTER DOMAIN of either moves only its own
(`discovery/domains.ts`'s `DOMAIN_CHAIN`, one join for discovery and for
the root's description). Neither property exists on a column of any
other type, so a snapshot of a catalog with neither is the one discovery
made before 0170, to the byte, and one stored before it -- a published
bundle's, a draft's, a capture -- reads, fingerprints and generates as it
did, its enums and domains unsupported until discovered again.

**A domain over text or a whole number is read as that type**; over any
other it is unsupported. Every operation over such a column is its base
type's -- PostgreSQL resolves an operator or a function over a domain as
over its base, and takes a value of the base into the domain under its
checks. The suite runs a create, an update and a read back, a sort both
ways, a page after a row, a filter and an export over a domain over
varchar and one over an integer whose checks list their values, and one
over text whose check does not; a domain in a key, a lookup or a row
filter is its base type's too, and no suite runs one. Its checks that are
no list are the database's, as a table's are (0152).

**An enum column is a select of exactly its labels, in the type's order**
(`generate/controls.ts`), each its own option's text: not 0152's stated
order, which exists because SQL Server writes an IN list back to front --
an enum's order is the type's, the same on every discovery, and how the
engine sorts it. A nullable one's empty choice is NULL (0095). An empty
label, which a select cannot tell from no answer, or no label at all, is
shown and never written. Its codec takes a label and nothing else; a key,
a row filter, a lookup's token and a filter's value are held to its labels
before anything is bound, so a value that is no label fails no statement
(0028). Its default, `'placed'::sales.order_state` qualified or bare as
`format_type` spells the type, starts its field (0149); a state field over
one keeps its moves (0127). A list's filter offers equality with a label
alone: the engine compares labels in the type's order, which a range typed
as text would not say, and has no LIKE.

**A domain's check is a list as a table's is** (`generate/listed.ts`,
`check-lists.ts`'s `readDomainList`): one list among the table's checks
and every domain's of the chain together, enforced and validated, is a
select, its binding naming the domain (`listed.domain`); anything else is
the base type's control and a note.

**PostgreSQL binds an enum cast to its type** (`sql/types.ts`):
`$n::pg_catalog.text::"sales"."order_state"`, the name approved metadata,
quoted one part at a time; reads it as `::pg_catalog.text`, which no
setting spells otherwise; searches it as that text; sorts it by the type's
own operator class, so a page after a row (0108) compares in the order it
sorts. A domain over text or a whole number is bound as its base type. A
type named by a statement and gone is `schema-changed` (42704). A
qualified type name resolves only in a schema the role may use, so an enum
in a schema the connected account has no USAGE on is unsupported for it,
in discovery and in the root's description alike (`LABELS`): no value of
it could be cast, and the column is left out, as every enum was before.

**Drift**: an enum's labels are its type, which the root's description
reads too, digested, since they are names (`records/definition.ts`). A
label gone -- RENAME VALUE takes the old away -- is a tightened column:
writes of the field stop in review and at runtime, as a shorter varchar's
do (0010, 0041). A label added is a field the column outgrew, for review:
the select refuses a value it does not offer rather than writing another
back (formancy.ai 0076), so nothing stops. A label renamed under a select
the form only shows is one too: the form writes nothing a rename could
stop. A lookup that reads the enum is blocked by either, said by the labels.
Another type is another type. A domain's list is weighed as a table's
check (`drift/listed.ts`, 0152): review's alone, the runtime comparing no
check. A column read now that the published snapshot called unsupported is
a note. A type the search_path alone respells is the same type:
`format_type` leaves out the schema of a type the path makes visible, and
an enum's name is in its type and a domain's in its chain, so a discovery
and a description under two paths agree (`drift/compare.ts`).

**SQL Server is unchanged**: no enum, an alias type its system type, no
rule read (`data-sqlserver/src/discovery/types.ts` says where the engines
differ). The shared fixture is unchanged too: an enum lives in a schema
PostgreSQL's alone, `states` (`fixtures/postgres.states.sql`, loaded into
every PostgreSQL container), with a model of its own (`STATES_MODEL`)
that the shared comparator holds discovery to, and no shared case.

## Consequences

**What it buys.** A PostgreSQL enum, the commonest way to say a column's
states, is a select a person picks from, in the order its type means,
written and compared as the type; a domain whose check lists its values is
one as a table's check is; a state field over either keeps its moves; and
a label renamed under a published form stops its writes before the
database refuses them.

**What it costs.**
- A domain over any type but text and a whole number -- numeric, a date, a
  uuid, a boolean, a timestamp -- is still unsupported, though its base is
  not: nothing has proved an operation over one. A routine's parameter of
  an enum or a domain is unsupported as before (0158).
- A domain's NOT NULL is read as the column's, though PostgreSQL documents
  that a column of such a domain can still hold NULL, written through a
  NULL it never coerces; such a record's field is required, and refused on
  Save until a value is chosen.
- A form published before 0170 never bound an enum or a domain, and is
  unchanged; review notes each such column once, as read now. One such
  column stops something: a domain NOT NULL with no default, which a create
  that left it out was refused by already. Review and the runtime now stop
  create on that form until it is generated again with the column in it.
- A database with an enum or a domain column fingerprints otherwise at its
  first discovery since 0170, so every drift review of a form published
  before compares in full until the form is published again.
- A server older than 0170 handed a snapshot taken since cannot generate a
  form over a table with an enum: its generator has no control for the
  kind. A downgrade needs a discovery by the older server.
- Labels are offered as the type holds them, `in_transit` and not "In
  transit"; an administrator relabels a state field's states (0129) and
  no other select's. The studio's starting value of an enum's field is
  typed, not chosen, and refused unless it is a label.
- A list's filter offers no range on an enum, nor a search of part of a
  label in its Filter panel; a list's search finds it.
- A label added under a published form is refused by its codec, so a
  record holding it is refused on Save until an offered label is chosen,
  and a record whose key holds one has no token the published form takes;
  a lookup that reads the enum is blocked until the form is generated
  again, as for any type change a lookup reads (0028).
- A change to a domain's checks that is no list a select rests on is not
  reported, where a table's is noted.
- An enum in a schema the connected account has no USAGE on is
  unsupported for it and left out of its forms, though it could be read:
  every value is cast to the type by its name, which needs that USAGE. A
  GRANT or a REVOKE of it under a published form is a type changed, which
  blocks the form in review and at runtime until it is generated again.
- A check that leaves out some of an enum's labels, the table's or a
  domain's over the enum, is not read: the select offers every label, and
  the database refuses the others on Save with a check violation.
- A domain in a key, a lookup or a row filter is offered as its base type
  is, and no suite runs one.
- On SQL Server a rule bound to an alias type or a column is not read: a
  value it refuses is refused on Save, and a rule that lists values is no
  select.
- The chain is read per column in discovery and in every write's guard;
  what that costs is not measured.
- The integration suites were written without a server and run first in
  CI; every spelling the record quotes for a domain's check and an enum's
  default is PostgreSQL's as `ruleutils.c` writes it, held there and on no
  release before CI runs them.

**What it forecloses.** Nothing: a domain over another base is a later
record, proved as these were.

## Alternatives considered

**Leave enums unsupported.** What the snapshot said; every form over a
table with one leaves out the column its states are in, which is the
column 0152's select exists for.

**Read the labels as a CHECK-like list at generation only**, as 0152 reads
a check. There is nothing in a snapshot to read them from: a column of an
enum holds `databaseType` and nothing else, and an adapter that reported
a synthetic check `state = ANY (ARRAY[…])` would invent a constraint the
catalog does not have, collide with a real one's name, lose the type's
order and its name, which every bound value is cast to, and make a label
renamed a check changed, for review, where the database refuses the old
label on every write.

**Carry the labels on the column, beside its type** (`ColumnMeta.labels`).
Every request that binds a value -- a filter, a key, a lookup's token, a
row filter -- carries the column's type and nothing else, and the cast
needs the type's name; and the labels are what the type accepts, which
every comparison of two types -- review, the runtime, a lookup's -- has to
see. As part of the type each sees it without being taught to.

**Keep a domain over text unsupported unless its check lists values.** The
adapter cannot tell a list without data-core's reader, and data-core would
have to treat a column the snapshot types as text as unsupported in every
place a type is asked -- browse, lookups, version columns, keys. SQL Server
has read an alias type as its base since 0007.

**Order an enum's labels by codepoint, as 0152 orders a list.** The same
DDL would offer its states in an order nobody declared, and sort a page in
another; 0152's reason, an IN list SQL Server writes back to front, does
not reach a type whose order is its own.

**A filter's range over an enum, in the type's order.** It would compare
as the engine does and read as nobody types it; a later record, with a
control that offers the labels in order.
