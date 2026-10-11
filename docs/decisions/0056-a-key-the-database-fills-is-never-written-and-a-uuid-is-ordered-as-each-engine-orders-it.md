# 0056 — A key the database fills is never written by a form unless the person gives another part of it, and a uuid is ordered as each engine orders it

- **Status:** accepted
- **Date:** 2026-10-11
- **Deciders:** Daniel Bacher
- **Verified by:**
  both adapters' `uuid.integration.test.ts`, against `postgres:17-alpine`
  (17.11) and `mcr.microsoft.com/mssql/server:2022-latest` (16.0.4295.3)
  loaded with the shared fixture and `UUID_ROWS` (`@formancy/data-fixtures`),
  run as the order form's own account, every request planned by the core
  from bindings generated over what that account discovers, each case
  declared with `covers()` and its expectation written once in
  `UUID_PARITY` (shared cases `uuid: discovered`, `uuid: generated`,
  `uuid: token`, `uuid: create`, `uuid: update`, `uuid: tenant`,
  `uuid: parent`, `uuid: order`, `uuid: lookup`): `sales.delivery`'s key is
  its uuid `id`, with the default each engine spells, `gen_random_uuid()` and
  `(newsequentialid())`; the generated form shows the key in the Record
  section, never writes or requires it, and offers create and update; a
  delivery's token spells its key in lower case on both engines, a read by it
  finds the row and the same key in upper case is `invalid-record-token`;
  tenant 2's create that leaves the key out is answered with the key the
  database chose, a read by its token finds it, and a create that sends a
  key is `over-posting` because the form never writes it; an update with the
  version read is written and the version before it is `stale`; tenant 2's
  clerk finds none of tenant 1's deliveries by token or by update with its
  current version (`not-found`), nor tenant 1's clerk tenant 2's; the three
  deliveries of the fixture's order are listed under it in each engine's
  order of uuid, and none under tenant 2's order for tenant 1's clerk;
  sixteen deliveries keyed one byte each, five to a page, come in each
  engine's order, the same rows each time, joined without a gap or a repeat;
  and `sales.parcel`'s lookup offers tenant 1's deliveries by carrier, each by
  its uuid token, finds one by part of its carrier, resolves a token to its
  carrier, rejects another tenant's delivery, a key nobody has and a key in
  upper case, offers tenant 2's clerk the sixteen deliveries, which share one
  carrier, in each engine's order of their keys, and a parcel created with a
  delivery chosen holds its key and is read through it (0043) by its tenant
  and by no other. Watched failing, each on 2026-10-11: on SQL Server with
  the adapter's `lower()` taken off a uniqueidentifier's read (`token`,
  `create`, `parent`, the two lookup tests over the fixture's deliveries and
  the sequence test below failed; the tied options, whose keys hold no
  letter, passed); on SQL Server with `uuidOrder` given SQL Server's group
  order applied to the text's byte positions, without the little-endian
  swap of the first three groups, instead of the order measured (`order`,
  the tied options and the storage test below failed, and `parent`, three
  keys, passed, which is why sixteen are paged); on SQL Server with the tied
  options expected in PostgreSQL's order, and on PostgreSQL with the key
  dropped from the end of a lookup's order (the tied-options test failed
  both times); on SQL Server with the key dropped from the end of a
  lookup's order, which passed while `pk_delivery` was clustered -- a scan
  returned the rows in the key's order with or without it -- and failed
  once the key was declared nonclustered; and on PostgreSQL with the
  generator's rule removed (`generated` failed: the key was written on
  create; `create` failed: the key it was sent was refused only because the
  policy withheld it). The
  other cases were not watched failing: they prove on a uuid key what the
  adapters already did on others. Outside the shared cases, the SQL Server
  suite holds that the server stores a uniqueidentifier's first three groups
  little-endian and orders the rows by the bytes it stores, group by group
  from the last -- stored bytes 10-15, 8-9, 6-7, 4-5, 0-3 -- which is
  `uuidOrder`'s rule read through the text (watched failing with those
  positions applied to the text's bytes); and that a key `newsequentialid()`
  made for another tenant between two of tenant 2's creates sorts between
  them, all three sharing their last eight bytes (watched failing with the
  order expected otherwise, and with `lower()` taken off as above).
  `packages/data-core/src/generate/generate.test.ts` -- a one-column key with
  a default is never written on either operation, never required, in the
  Record section, with its note, and create and update are still offered; a
  defaulted column of a composite key is still written (watched failing
  before the rule: the key was written on both operations; and with the rule
  widened to every column of the key: `line_no` stopped being written). A
  key of a pinned tenant and a uuid with a default is never written either,
  and create and update are still offered, while the same key with nothing
  pinned, and a key the pin leaves at two columns, still write the uuid
  (watched failing with the rule asking for a key of one column, as it first
  did: the uuid was written on both operations).
  `packages/data-fixtures/src/fixtures.integration.test.ts` -- on both
  engines the files hold `DELIVERIES`' keys, SQL Server printing them in
  upper case, two parcels join their deliveries, and a create that leaves
  the key out is given one: a version-4 uuid on PostgreSQL, and on SQL Server
  by the default the catalog spells `(newsequentialid())` (watched failing
  against the files as they were before this record: no such table, on
  either engine).
  `packages/data-fixtures/src/uuid.test.ts` -- `uuidOrder` orders the
  fixture's three deliveries differently on each engine; the sixteen paged
  keys each set a different one of the sixteen bytes, and their positions in
  each engine's order are the ones measured; a value that is not a uuid is
  refused (watched failing with the check removed). `src/cases.test.ts` --
  `UUID_PARITY` is a family of shared cases. `src/conformance.test.ts` --
  `sales.order` is referred to by `fk_delivery_order` and
  `fk_order_line_order`, and `sales.delivery` by `fk_parcel_delivery`; the
  restricted reader's rule holds both keys onto the order. Both adapters'
  `discovery.integration.test.ts` and `discovery-access.integration.test.ts`
  hold the owner's, the reader's and the writer's snapshots of the two
  tables to `FIXTURE_MODEL`, `READER_ACCESS` and `WRITER_ACCESS`, and the
  writer's deletes to `order`, `order_line`, `delivery` and `parcel`. The
  studio's and the examples page's captured snapshots were captured again
  and came back byte for byte as committed; on them both apps' suites pass,
  and each app's browser gate and `pictures --check` find every scene saying
  what its picture was recorded saying, so no picture was retaken.

## Context

The user asked for a table with a uuid key in the test data. Until this
record the fixture had uuid values and no uuid key: `sales.shipment` has a
`tracking_no` uuid, which the codecs, discovery and the record reads see,
and the core's unit tests type a uuid key into tokens, filters and
throughs. No form addressed a record by a uuid on a real server, no lookup's
key was one, and no list was ordered by one.

Two things were unsettled. A key the database fills by its default --
`gen_random_uuid()` on PostgreSQL, `newsequentialid()` on SQL Server, which
only a default may call -- is not an identity: the catalog calls it
`generated: 'none'` with a default, because the column takes a value given
to it. The generator offered it as an optional field, written on create,
so a person could type the address of the record they were creating. And
0012 and 0044 said that a uuid on SQL Server is ordered by the column's
collation. It is not: a uniqueidentifier has no collation, and SQL Server
orders it by its byte groups. Measured on SQL Server 2022 (16.0.4295.3) and
PostgreSQL 17.11 on 2026-10-11: a table keyed by the type, holding the
sixteen keys that each set one byte, the fixture's three and 1000 random
keys, ordered by its key column, came back on each server exactly as
`uuidOrder` sorts them for that engine, and not as it sorts them for the
other: PostgreSQL compares the sixteen bytes in turn, the order of the text;
SQL Server compares the last six bytes first, then the two before them,
then the first eight from the right -- in the text, the fifth group and the
fourth from the left, then the third, the second and the first each from its
last byte. That is the order of the bytes SQL Server stores, compared group
by group from the last -- stored bytes 10-15, 8-9, 6-7, 4-5, 0-3 -- because
it stores the text's first three groups little-endian: read through the
text, the first eight bytes come from the right. `newsequentialid()` hands
out keys that rise in that order: four creates in one session differed only
in the first byte of the text, the least significant one, and carried the
version digit 1, not 4. The measurement's first try ordered by a select-list
alias spelled as the column, which SQL Server resolves to the alias -- the
lower-cased text -- and so showed PostgreSQL's order; the SQL Server adapter
names every column through its row's alias, and `uuid: order` and
`uuid: lookup` fail there if a list or a lookup is ordered by the text.

`sales.shipment` already exists: it is 0026's table of the column facts the
engines disagree on. The new table is called `sales.delivery`, and the table
that refers to it `sales.parcel`.

## Decision

- **The fixture grows by two tables**, written twice as the rest is (0005):
  `sales.delivery` -- `id` a uuid primary key filled by the default above,
  `tenant_id`, `order_id` onto `sales.order` with `on delete cascade`, as a
  line's, `carrier`, `shipped_at` and a version as the order's: an
  application-maintained `bigint` on PostgreSQL, a `rowversion` on SQL
  Server -- and `sales.parcel`, an identity key, `delivery_id` onto the
  delivery's uuid with `on delete cascade`, and a `label`. Three deliveries of
  the fixture's order, keys given so both files hold the same ones, one
  written in upper case; two parcels. The order form's account is granted
  both as it is granted the order: it reads and inserts them, updates a
  delivery's carrier and shipping time -- on PostgreSQL its version too, as
  the order's -- but never its key, its tenant or its order, and a parcel's
  delivery and label, and deletes from both, so a delete of an order, which
  now cascades through its deliveries into their parcels, reaches no table
  it may not delete from (0049, which this extends). What a case needs more
  of -- two orders of tenant 2's, a delivery under one and sixteen to page
  under the other, all sixteen of one carrier -- the uuid suites insert, as
  the list suites insert theirs. On SQL Server the delivery's key is
  declared nonclustered, so its rows are a heap, as PostgreSQL's are: a key
  clustered would hand a scan the rows in its own order, and a lookup that
  dropped the key from the end of its order would still offer tied options
  in that order, so the tie-break would be shown on one engine only.
  Discovery does not report the difference, and the order by the column is
  the type's either way.
- **A key the database fills is never written by a form, unless the person
  gives another part of it.** When the form's identity, less the columns
  the request pins, is one column, not generated, with a default, the
  generator shows it in the Record section, never writes it on either
  operation, never requires it, and says why in a `read-only` note, as it
  does an identity (0026). Create stays offered: the column has a default.
  So a uuid key alone is the database's, and the usual multi-tenant key,
  `(tenant_id, id)` with the tenant pinned, the context's and the
  database's: nothing of either is the person's. Where the pins leave more
  than one column, a defaulted one is still written: a line number that
  starts at 1 is a first value, and the person gives the others.
- **One token for a uuid key.** Both adapters read a uuid in lower case,
  SQL Server's by `lower()` over the text it prints in upper case (0017), so
  a record and an option have one token on both engines, and the planner
  and the lookups refuse the upper-case spelling as they refuse `007` for 7.
- **A uuid is ordered as each engine orders it.** A list ordered by a uuid
  key, and a lookup's options tied on their label, come in the engine's own
  order of the type, total and stable on each and not the same on both.
  Neither adapter reorders: the difference is written in each `sql/order.ts`
  and named here. The shared expectation says exactly that: the same rows,
  in `uuidOrder(kind, keys)`, one function per engine's rule, which the
  sixteen one-byte keys measure on every run -- paged as a list, and tied on
  one label as a lookup's options.

## Consequences

**What it buys.** A uuid key is proven end to end on both engines: discovered,
generated, addressed by one token, created, updated, guarded by its
version, scoped by a tenant and through a parent, listed and offered by a
lookup, each as a case the release report shows on both. A form never
offers a person the address of a record the database fills, where the
rest of the key is pinned or there is none, and such a create can no
longer fail on a key somebody typed. 0012's and 0044's sentence about
a uuid's order on SQL Server is corrected, by a measurement that runs.

**Where the engines differ.** The order of uuid values, above, and what the
defaults hand out: `gen_random_uuid()` a random version-4 uuid, which says
nothing about any other key; `newsequentialid()` keys that rise in SQL
Server's own order and carry version digit 1. They rise for the server, not
for a table or a tenant: a key made for another tenant between two of
tenant 2's creates sorts between them, and the three share their last eight
bytes. So on SQL Server a record token tells a tenant that keys were handed
out between its own creates. How many it does not plainly say: in the three
sessions measured, with nothing else making keys, the first byte of the
text rose by three to seven from one key to the next. Measured by a script,
not a test, on 2026-10-11 on SQL Server 2022 (16.0.4295.3), each fact on
one or two containers: across a restart of the same container the keys
went on rising -- bytes 8 and 9 rose by one and bytes 10 to 15 stayed --
and a key made for another table, between two of one table's, sorted
between them; two containers' keys ended in different bytes 10 to 15, the
ones SQL Server compares first, so keys from two servers are not in the
order they were made. Nothing else this record found: both keys are
`generated: 'none'` with a default, both tokens are lower case, and both
engines answer every other case alike.

**What it costs.**
- Every suite that starts the fixture loads two more tables and five more
  rows. Loading the three files into a fresh database, nine times as on main
  and nine times as here, alternating, in one container per engine, took a
  median of 258 ms before and 264 ms after on PostgreSQL 17.11, and 291 ms
  and 306 ms on SQL Server 2022 (16.0.4295.3) -- a few per cent, small beside
  starting a container -- on the Docker sandbox VM (20 CPUs of an i9-10900K,
  16 GB) on 2026-10-11, with other workflows' containers running. The uuid
  suites are two more files, each starting its own container: run alone,
  the container's start included, 5.4 and 5.7 s on PostgreSQL and 11.7 and
  12.3 s on SQL Server, whose suite holds two cases of its own besides the
  shared ones -- two runs each, vitest's duration, on the same machine the
  same day, at a load average of about 3.
- Every hand-written expectation about the fixture's objects moves with it:
  what refers to `sales.order` is now a delivery's key and a line's, the
  captured snapshots of the studio and the examples page were captured again,
  and a delete of the fixture's order now reaches deliveries and parcels. A
  composed stack whose databases were loaded before this record has neither
  table nor the writer's grants on them until
  `docker compose --profile stack down -v` loads them again.
- **For a host, the ordering difference.** A grid of records keyed by a uuid,
  in its default order, lists them in another order on each engine, and in
  an order that tells a person nothing: `gen_random_uuid()`'s keys are
  random, and `newsequentialid()`'s rise only among the keys one server
  made -- the fixture's keys, given by hand, and another server's sit
  anywhere among them. Options whose labels tie come in the key's order, so
  in another order too. Paging stays consistent on each engine, because
  each order is total. A host that wants one order on both sorts by a
  column that means something.
- An administrator cannot let a person choose a key the database fills
  where the rest of the key is pinned or there is none: the bindings never
  write it, whatever the presentation shows, so a create that sends it is
  refused as `over-posting`, and a policy that grants write on it is
  refused at publish (`fields.id grants write, and the form never writes
  id`). A form published before this record over such a
  table keeps the base it was published with, which is checked against the
  generator only at publish, and so does a version of it restored, which is
  copied, not generated again; its next regeneration makes the key
  read-only, and its policy must then stop granting write on the key before
  it publishes. A key whose default is a constant fills one record and then
  refuses every later create on the key -- inferred from the rule, not
  tested.
- `UUID_PARITY` is one more family of shared cases, and `uuidOrder` a
  statement about SQL Server's comparison of uniqueidentifier that the
  sixteen keys hold only for the image the tests name.

**What it does not do.** A key the database fills beside a column the
person gives -- `(order_id, id)` with nothing pinned -- is still written:
there the person may choose the uuid, as they choose a line number, and no
suite runs a form over such a key. No clustered uniqueidentifier key is
in the fixture; the order by the column is the type's either way. No key
type but uuid is ordered differently here than before; a text key is still
ordered by each engine's collation (0012, 0044). No lookup over a uuid key with a version-7 default (PostgreSQL 18's
`uuidv7()`) is tested; the image is 17. No through is offered over a text
key (0043), and nothing here changes that.

**What it forecloses.** One order of uuid values on both engines without a
sort by an expression in every list and lookup statement.

## Alternatives considered

**Name the table `sales.shipment`, as asked.** It exists: 0026's column facts,
which every adapter's record suite reads row by row.

**Order a uuid by its text on SQL Server, so both engines agree.** An ORDER
BY `lower(convert(nchar(36), id))` sorts by an expression no index on the key
serves: every page would sort every row its filters admit, where an index
on the key can serve the order today. And a lookup's tie-break would need the
same. Rejected for a difference that only a grid in its default order shows.

**Order PostgreSQL by SQL Server's rule.** The same cost on the other engine,
for an order that is not the type's own there.

**Ask only about a key of one column, as the rule first did.** The usual
multi-tenant key, `(tenant_id, id)` with the tenant pinned and the uuid
filled by a default, would still offer the uuid as an optional field on
create and an editable one on update, though nothing of that key is the
person's: a review found it. Counting the pins out is the same rule, asked
of the part of the key a person could give.

**Cluster SQL Server's key, and hold the tie-break on PostgreSQL alone.** A
lookup that dropped the key from its order passed SQL Server's suite while
the key was clustered, and passing on one engine does not imply the other
(0003).

**Write each engine's expected order out by hand.** Sixteen positions typed
twice, which a reader checks against nothing; derived by `uuidOrder` from
the rule, and measured by the server on every run, the rule is the claim.

**Keep the key an optional field, and leave it to the policy.** The
generated base would still say the key is written, every administrator would
have to know to withhold it, and the studio's "fill from operations" grants
write on every field the base writes (`fillFromOperations`).

**Recognise a uuid-generating default in discovery, as a generation kind.**
A list of function names -- `gen_random_uuid`, `uuid_generate_v4`, `newid`,
`newsequentialid`, PostgreSQL 18's `uuidv7` -- that misses a function of the
database's own, and a change to the snapshot's contract, its fingerprint and
every reader of `generated`, for a fact the identity and the default already
give.

**Seed the sixteen deliveries in the fixture.** Every suite would load them,
and only the uuid suites page them.
