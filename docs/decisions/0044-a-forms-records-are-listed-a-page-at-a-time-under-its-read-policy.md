# 0044 — A form's records are listed a page at a time under its read policy, searched and paged as a lookup is

- **Status:** accepted
- **Date:** 2026-10-11
- **Deciders:** Daniel Bacher
- **Verified by:**
  both adapters' `list.integration.test.ts`, against `postgres:17-alpine`
  and `mcr.microsoft.com/mssql/server:2022-latest` loaded with the shared
  fixture and `LIST_ROWS` (`@formancy/data-fixtures`), requests planned by
  `planList` from bindings generated over what discovery reports, each case
  declared with `covers()` and its expectation written once in `LIST_PARITY`
  (shared cases `list: pages`, `list: search`, `list: nulls`, `list: order`,
  `list: parent`, `list: through`, `list: read`, `list: text-parent`,
  `list: key`): tenant 1's customers come
  a page at a time in key order, each page saying whether more follow and a
  page past the end empty; `%`, `_` and `[x]` find only the names that hold
  them; sorted by the nullable `credit_limit` the NULLs come last in both
  directions, ties broken by the key; sorted by the NOT NULL `customer_no`
  descending the order is one on both engines and the statement spells no
  NULL placement for it; a line list narrowed to one of tenant 1's orders
  holds its lines alone, and narrowed to tenant 2's order none; tenant 1's
  line list holds no line of tenant 2's order; every listed customer and
  line is exactly what a read by its token returns, and the page carries the
  description `describe` reads; a customer list narrowed to the country
  `k1:CH`, over a `char(2)` foreign key, holds customer 1001 on both, and
  narrowed to `k1:ch` holds it on SQL Server, whose fixture collation folds
  case, and nothing on PostgreSQL, whose default collation does not (watched
  failing on SQL Server with the parent compared under a binary collation,
  and on PostgreSQL with it compared folded); and a table whose key is a
  unique NOT NULL column lists, and once the column is made nullable and
  holds a NULL, and again once its unique key is dropped and a value
  inserted twice, the page's own description refuses it as drift while a
  read is still allowed (watched failing on both with the page decided as a
  read: both listed, the second a page `recordPage` cannot build).
  Watched failing on both engines with the
  NULL placement left unspelled (PostgreSQL's descending page and SQL
  Server's ascending one began with the NULLs), with it spelled on a NOT
  NULL column (the statement held it), with the search unescaped (`%`
  matched every customer on PostgreSQL; `[x]` found "AxB Trading" and
  "x Labs" on SQL Server), with the throughs left out of the statement
  (tenant 2's line listed, and listed under its order as the parent), with
  the parent left out, with `limit` rows fetched instead of `limit + 1` (the
  first page said nothing follows), and with the description selected on no
  row (every page `schema-changed`). Both `parity.integration.test.ts` --
  every `FILTER_PARITY` case runs through a list too, which holds exactly
  the rows the lookup does (watched failing on both with the filters left
  out of the list statement). Both `records-definition.integration.test.ts`
  -- a list queued behind an ALTER of its table answers with the table as
  it is after, as the read beside it does; on PostgreSQL under REPEATABLE
  READ because the list is asked again after the table's lock (watched
  failing with that second asking removed: the list answered the old
  definition, and behind the rewriting ALTER no row). On SQL Server the
  list is one statement under its schema-stability lock, and this case
  passed when added; it was not watched failing. Both `sql/order.test.ts`
  -- the one ORDER BY lookups and lists share spells a placement exactly
  where a term asks for one (watched failing on both with a NOT NULL term
  given one, and with a nullable one left bare).
  `packages/data-core/src/records/plan-list.test.ts` -- exactly the key and
  the readable fields' columns under the read filter and the throughs, the
  same columns and fields as `planRead`'s (watched failing with every bound
  column read); a missing tenant is `missing-attribute`, and an actor
  granted fields but not read is refused; a policy that hides `customer_no`
  is `field-denied` and `listable` refuses, while one that hides the pinned
  `tenant_id` lists (watched failing with the coverage check removed, and
  with the pinned column not counted); a nullable unique key is
  `operation-unavailable` though a read accepts it (watched failing with
  addressability alone checked), and a person the policy does not let read
  is `operation-denied` before anything about the key or the address is
  said (watched failing with the key checked first: the intake clerk was
  told the key can be NULL); a line form whose policy has no row filter and
  no through while its order lookup's options are filtered, as every line
  form before 0043 had to be, is `operation-unavailable`, and one whose
  options are shared lists (watched failing with that check removed: the
  unscoped line form was planned unrestricted); `customer_no desc` is
  followed by
  `tenant_id asc` alone, a NOT NULL column carrying no placement and a
  nullable one `last` (watched failing with every key column appended, and
  with `last` on every column); only readable column fields sort and only
  text and integer ones search, and a hand-edited binary or rowversion field
  does not sort (watched failing with every field searchable, and every kind
  sortable); a parent must be a readable lookup, `007` is refused for a
  bigint key and 2^53 + 1 for an int4 foreign key onto an int8 key (watched
  failing with the token decoded against the target key's type, and with an
  unreadable lookup accepted); drift and an unaddressable form are refused
  with their own codes; `recordPage` keeps a row with no token in its place
  and throws on a token twice (watched failing with such rows dropped, and
  with the check removed). `lookup/search.test.ts` -- every search and every
  page gives one answer through `validateLookupQuery` and
  `validateListQuery` (watched failing with the list's search checked only
  for being text, and with a page bound of its own).
  `records/drift.test.ts` -- a page over a description whose key column is
  nullable, or whose key is gone, is refused `drift` with its own sentence
  and the key's changes for the log, where a read of the same description
  is allowed (watched failing with a page decided as a read is).
  `records/list-query.test.ts` -- a body with any other property is
  `malformed` (watched failing with them ignored), as are an order and a
  parent of any other shape. `records/list-terms.test.ts` -- what both
  adapters read a request through refuses an order that does not name
  every key column (watched failing with that check removed), a direction
  or placement
  the planner never writes, a page past the bound, a search over a kind the
  engines spell apart, and a parent value not spelled as its column holds
  it.
  `packages/data-server/src/routes/runtime-lists.test.ts` -- the port
  receives exactly the planned request (watched failing with the route
  paging from offset 0); 401, and 403 `operation-denied` and
  `missing-attribute`, with the port never asked; each malformed or
  unofferable body is 400 with its code, `not-searchable` included (watched
  failing with its mapping removed: 500); a line form with no row filter
  and no through while its order lookup's options are filtered is 403
  `operation-unavailable` and `GET` offers it no list (watched failing with
  that check removed: a page); a hidden key is 403 `field-denied`
  and `GET /v1/forms/:id` offers no list (watched failing with `GET`
  offering one whatever `listable` says), its `list` otherwise
  `listColumns`'s answer; `LIST_PAGE_SIZE` is at most `MAX_RESOLVE`; a page
  drift stops reading is 409 `drift` with none of its values in the body
  (watched failing with the page left undecided); a page whose description
  has lost the key, or holds a key column nullable, is 409 `drift` with
  none of its values, and `GET` offers no list over either (watched failing
  with the page decided as a read: 500 "A record appears twice in one page"
  for the lost key, 200 for the nullable one, and a list offered over
  both); a refused page is said in the log as `list` (watched failing with
  it logged as a read); an adapter's
  `unknown-outcome` is 500; the audit event is `list`, with no record and
  nothing the person sent. `e2e.integration.test.ts`, on both engines
  through the real server and drivers -- each tenant's clerk is listed
  their own orders and none of the other's, a listed row is what a read of
  its token returns, and a line of tenant 2's order is in no line list of
  tenant 1's, with or without that order as the parent (watched failing on
  both with the list planned without its throughs: tenant 2's line listed).
  `packages/data-client/src/lists.integration.test.ts`, on both engines --
  a tenant's page holds its records and not the other's; exactly the five
  properties travel, in a POST body, the search in no URL (watched failing
  with the whole object sent: the server refused it `malformed`); an abort
  rejects with the AbortError (watched failing with the signal dropped); a
  refusal is the server's code and sentence.
  `packages/data-client/src/transport.test.ts` -- a form reply without
  `list`, or with one of another shape, is `unexpected`, and `null` or the
  columns are the server's (watched failing with `list` left unchecked).
  `apps/studio/src/policy.test.tsx` -- the studio's note on rows nothing
  scopes appears where `unscopedLookups`, the function a list is refused
  by, says so, and says the server offers no list of them (watched failing
  with that clause left out); the note asked the policy itself before.
  `scripts/install-fixture/consume.ts` -- `list` and `LIST_PAGE_SIZE`
  through the published entry points.
  `packages/data-fixtures/src/cases.test.ts` -- the list cases are a family
  of shared cases (watched failing with them left out of `sharedCases()`).
  The getting-started journey (`scripts/getting-started/journey.mjs`), run
  by `pnpm test:getting-started` against the composed stack on both
  engines, checks that tenant 1's list holds the order tenant 1 created and
  tenant 2's does not (watched failing with tenant 1's token sent for tenant
  2's list: "pg: tenant 2's list of orders holds tenant 1's order").
  **Not mechanically enforced:** that a page's rows come in its order. Each
  adapter orders the statement by each row's position in the page's order;
  no suite here can make a lateral join or an APPLY return its rows out of
  order, and with that ORDER BY left out both list suites passed (tried on
  2026-10-11). Nothing measures what a list costs (below).

## Context

No route or port listed records: a host had a record only by its token, and
a grid of a form's records, which a host's workspace needs, had nothing to
ask. The only paging in the module was a
lookup's: offset and limit, a page plus one row to learn whether more
follow, no COUNT, a total order ending with the key, NULLs placed on every
column (0012), and one validator for the search text.

A record token spells its key (0023). A read hands back only the token its
caller sent, and a create only the token of the row the caller made; a list
would hand out one for every row it admits. The generator makes a field of
every readable key column, and a policy may deny that field.

An identity may be a nullable unique key: `identityFor` takes the first
readable unique key, nullable or not, and `addressable` does not ask. On
PostgreSQL a UNIQUE constraint admits many NULLs, so rows tied on a sort with
NULL keys have no order, and offset paging can repeat or skip them. The
snapshot says what the key was at publication; a database changed since can
make a key column nullable or drop the key, and drift review reports the
first as a note and the second as stopping update, because a read by token
needs neither.

Until 0043, a child form could be published only with `rowFilters: []`, and
a form so published keeps that policy after an upgrade: nothing scopes its
rows, though a lookup offers only the tenant's parents. The studio notes
that shape and does not refuse it, because a policy may mean every row is
shared (0011).

Every read is decided over a description of the form's table that its own
statement carries (0041), and a child form's rows exist only through a
parent its policy admits (0043), whose record said that a list, when one
came, would carry the throughs from its first statement.

Neither adapter bounds a statement's time. `connectSqlServer` sets no
request timeout, so mssql 12.7.4's default applies -- 15000 ms, read in its
`lib/tedious/connection-pool.js` on 2026-10-11 -- and a read the driver ends
is `unavailable` (`errors.ts`, held for a read by
`records-failures.integration.test.ts`). PostgreSQL has no statement timeout
of this module's.

## Decision

`POST /v1/forms/:id/records/list` answers one page of the records a person
may read, `{ rows, hasMore }`, each row exactly what `records/read` returns
for its token, in a total order, with no total. A POST, so the search never
appears in a URL a proxy logs. The audit operation is `list`, with no
record, and the event never holds the search, the sort or the parent (0023).

- **A list is a read.** It needs `operations.read`, runs under the root's
  read filter and every through, and reads the key and the readable fields'
  columns and nothing else -- what `planRead` reads. There is no list grant.
- **When a list is offered: `listable`.** The policy first -- the read
  filter, every through and the readable fields -- so a person it does not
  let read is told only that, as `GET` tells them. Then the form must be
  addressable, every identity column NOT NULL in the snapshot (otherwise
  `operation-unavailable`, on both engines); its rows scoped by something
  where a lookup's options are filtered -- a policy with no row filter and
  no through while a lookup's options are filtered (`unscopedLookups`, the
  function the studio's note asks) is `operation-unavailable`; and every
  identity column a column of a field the person may read or pinned by
  their read filter (otherwise `field-denied`): a pinned value is the
  person's own attribute. `GET /v1/forms/:id` and `planList` both ask it,
  and the form's new `list` is `null` whenever it refuses, or whenever a
  page over the description `GET` reads would be refused (below), so a
  page never offers a grid the server would refuse.
- **What a list may be sorted and searched by: `listColumns`.** Readable
  column fields; sortable when the kind has canonical text, searchable when
  it is text or integer, matched as a lookup's search matches (0028). A
  lookup field is neither: a list holds its token, not its label.
- **The body: `validateListQuery`.** `search`, `sort` (a list of
  `{ field, direction }`, each field once), `parent` (`{ field, record }` or
  `null`), `offset` and `limit`, each optional and anything else refused
  `malformed`. The search and the page are a lookup's, through
  `checkSearch` and `checkPage` in `lookup/search.ts`, which both
  validators call. `LIST_PAGE_SIZE` equals `DEFAULT_MAX_PAGE_SIZE`, so no
  page the runtime plane returns is longer than one bound, and is at most
  `MAX_RESOLVE`, so one page's tokens for one lookup field fit one resolve;
  it is not measured for a grid's rows.
- **`planList`.** After `listable`: every sort field sortable
  (`not-sortable`), a search only where a field can match (`not-searchable`),
  and the parent a lookup field the person may read (`invalid-request`), its
  token decoded by `lookupAnswer` through the root's foreign-key columns'
  codecs -- the one decision about whether a token is a value of that lookup
  -- so a value those columns cannot hold is `invalid-record-token`. The
  parent narrows to rows whose foreign key equals it, compared with the
  database's equality, and adds no permission.
- **The order.** The requested columns, then every identity column the
  request did not name, ascending, so the order is total and never names a
  column twice. NULLs go last, the lookups' rule, spelled only for a column
  the snapshot says is nullable (`listOrder`); a lookup still spells it on
  every column. Each adapter's `orderBy` moved to `sql/order.ts`, the one
  spelling both use, as their search moved to `sql/search.ts`.
- **The port.** `RecordAdapter.list(request: ListRequest): ListOutcome`, read
  through `listTerms`, which throws on an order that does not name every
  key column, a page past `LIST_PAGE_SIZE`, a search over a kind the
  engines spell apart or a parent value not spelled as its column holds it.
  One statement per page on
  each engine: the description of the table (0041) and the page, `limit + 1`
  rows from `offset`, each carrying its position in the page's order, which
  orders the statement; the description is selected once, on the page's
  first row, so the table's catalog facts are not sent once per record. On
  PostgreSQL a lateral join with LIMIT and OFFSET, asked again after the
  table's lock under a default isolation other than READ COMMITTED, as a
  read is; on SQL Server an OUTER APPLY with OFFSET and FETCH, a nullable
  column's NULLs placed by a CASE before it. `recordPage` builds the answer
  as `lookupPage` does: the extra row gives `hasMore`, a row whose key does
  not fit a token stays in its place with `record: null`, and a token twice
  on one page throws.
- **Decided as a read is, and then by its key.** The page is decided over
  the description its statement carried, `driftRefusal(…, 'list')`, and
  refused `drift` when that stops reading the form, or when it no longer
  holds the key unique and NOT NULL (`keyOrderProblem`): a key column made
  nullable, or no primary or unique key over exactly the key's columns.
  Review calls the first a note and the second a stop of update, and a read
  by token needs neither; a page does, because over two rows on one key it
  holds one record twice, and rows with a NULL key have no token and no
  order the engine defines. Its sentence, `LIST_REFUSED`, names no column;
  the log is told the changes to the key and its columns, under the
  operation `list`, which is what the audit event names. Refused, the
  page's rows never reach the body. A list the database refused as
  `schema-changed` is decided over a description asked once more, as a read
  is. An adapter that answers `unknown-outcome` for a list -- which writes
  nothing -- is a bug, answered 500 (0031).
- **The client.** `list(formId, query?, signal?)`, `LIST_PAGE_SIZE`
  re-exported, and a `form` reply without `list` is `unexpected`: a host
  that tested `list !== null` against one would offer a grid the server
  cannot serve.

## Consequences

**What it buys.** A host can show a grid of exactly what a read shows, one
statement per page, its search, paging and NULL rule a lookup's, under the
same policy and the same throughs, on both engines.

**Where the engines differ.** Text is ordered by each engine's collation,
and so is a uuid on SQL Server; the shared cases compare numeric orders
only. A search folds case as a lookup's does: PostgreSQL by its default
collation and never accents, SQL Server by the column's collation, accents
too under an accent-insensitive one. A parent over a text foreign key is
compared with the database's equality, the foreign key's own: exactly under
PostgreSQL's default collation, and case-insensitively under a
case-insensitive collation on SQL Server, where `k1:ch` narrows to the rows
of `CH` (`list: text-parent`); it narrows within the rows the person may
read either way. A through over a text key is refused (0043) because a
direct comparison of two columns of different collations fails on
PostgreSQL; a parent compares a column with a bound value, which has no
such difference. A
column that is not part of the key, made nullable since its snapshot, is
drift; until review, a list sorted by it places its NULLs as each engine
does -- last ascending and first descending on PostgreSQL, the other way
round on SQL Server -- and the key that ends the order keeps it total, so
paging stays consistent on each. A key column made nullable, or a key
dropped, refuses the page on both (above). A long list is expected to end
as `unavailable` at mssql's default request timeout on SQL Server, as a
read held by `records-failures.integration.test.ts` does -- for a list it is
inferred from the read's, not tested -- and to run to its end on
PostgreSQL.

**What it costs.**
- By how both engines run an offset and a sort, not measured here: a page
  reads every row before its offset, and a page sorted by a column no index
  serves reads every row the filter admits. Without a tenant filter, that is
  the whole table.
- Offset drift: a row inserted or removed before the offset between two
  pages shows one row twice or skips one.
- No total: a COUNT would read every admitted row on every page.
- No sort or search by a lookup's label.
- A form whose key can be NULL, or is held in a field the person may not
  read, offers no list -- only Load by a token. So does a form whose rows
  nothing scopes while a lookup's options are filtered: every child form
  published before 0043, until it is republished with `through`, and a
  policy that does mean its rows are shared while it filters a lookup's
  options, which has no way to say so and gets no grid.
- A table whose key was made nullable or dropped since publication refuses
  every page until the form is reviewed, though review reports the first
  as a note; reads by token go on.
- Lookups and lists spell NULL placement differently, one rule in two
  spellings.
- Nothing bounds a list's statement, and one the browser abandons is
  finished by the database: the routes pass no signal to an adapter.
- One more request per lookup field per page, for a host that shows labels.
- The page size is a lookup's number, not measured for a grid.
- A page, like a read, reads the table's catalog in its own statement
  (0041), and under a PostgreSQL default isolation other than READ
  COMMITTED takes the table's lock first and is asked twice.
- `RecordAdapter` has a method more, which every implementation and fake of
  it adds; the audit trail has an operation more.

**What 0034's evidence would need to add.** None of this is in the
published figures, which were measured before it existed and which this
record does not change; `node scripts/performance-stale.mjs` names this
change as a difference until somebody measures again. A measurement of
lists needs, on the sized `sales.customer`, with and without the tenant
filter: list blocks in `catalogue.ts` with their round trips pinned and
`records/list` in the server-log's route table; the rows each list reads
pinned by equality in the sized suites, as 0034 pins a lookup's -- the
first and the last page in key order, a page sorted by `name`, one by the
NOT NULL `customer_no` descending, searches whose text is common, unique
and absent, and an unfiltered sorted page; the time of the deepest offset
and of the unindexed sort on both engines against SQL Server's default
request timeout, which is what a record bounding a list's time would need;
the plan shapes on both engines of a NOT NULL sort without a NULL clause,
of a nullable one with it -- SQL Server's CASE included -- and of the
position the page is ordered by; the cost of a through's EXISTS on a sized
order and order-line set, which 0034 does not have; and `LIST_PAGE_SIZE`
for a wide row.

**What it does not do.** No keyset paging, no total, no column filters, no
labels in the answer, no list of a form whose key can be NULL or is
hidden or whose rows nothing scopes while its lookups' options are
filtered, no grant of its own. Drift review does not report that a change
stops lists: its verdict has no list, and the refusal is the page's own.
The parent is a narrowing a page asks for, never a permission; nothing here
guarantees a child grid shows the parent on the page's screen.

**What it forecloses.** A total on every page, client-side sorting of the
server's rows, and a list grant separate from read.

## Alternatives considered

**Keyset paging.** It helps only an order an index serves; SQL Server sorts a
`varchar` under a `SQL_` collation by SQL rules while the adapters bind text
as `nvarchar` (0028), which compares by Windows rules -- not probed here; it
needs cursor spelling, mixed directions and NULL branches in the core; and a
grid's infinite row model asks for any block.

**A total by COUNT.** It reads every admitted row on every page.

**AG Grid's `filterModel`.** A closed operator set per type, each needing
parity cases on both engines.

**A separate `list` grant.** It would claim to withhold what `read` already
gives: every row a list shows, a read of its token shows.

**Opaque per-request tokens, so a list could name rows whose key fields are
hidden.** A second token scheme beside `k1`, with state on the server; the
module has neither.

**Labels in the answer.** A second statement per lookup field inside one
route.

**Dropping rows with no token.** It breaks the arithmetic a grid's pages rely
on.

**GET with a query string.** The search text would land in every proxy's
log.

**Listing a form whose rows nothing scopes, as its policy says.** A policy
may say every row is shared (0011), and a read by token already reaches
every row of such a form. But before 0043 this was the only policy a child
form could have, and a list hands every tenant's rows out in one request
where a read needs a token guessed for each. Refused; the cost is a grid for
a policy that means it.

**A new policy property to say "these rows are shared".** It would let that
policy have a grid, at the price of a second spelling of `rowFilters: []`
and a policy every older server refuses. Not done until somebody needs it.

**`operation-unavailable` for a key loosened since publication.** The same
code as the snapshot's refusal; but the database changed under a published
form, which is what an administrator reviews, and only `drift` is said in
the log.

**Stops of `list` in drift review's verdict.** One decision for review and
the runtime; but the verdict is review's, the studio's and 0041's
properties', and none of them has a list. The page decides it from the same
description.

**The description on every row.** One statement either way; it would send
the table's catalog facts once per record.

**`describe` before the page, in a statement of its own.** A change
committing between the two would be decided over the old verdict -- 0041's
reason for carrying a read's description in its own statement.

**NULL placement spelled on every column, as a lookup does.** One spelling;
but a NOT NULL column holds no NULL to place, and spelled, PostgreSQL's
`desc nulls last` is by its documentation an order a plain ascending index
does not serve read backwards, and SQL Server's CASE is an expression no
index orders. Not measured here; the plan shapes are named above.

## Older records

Extended, not edited away: 0012 (a list's search is a lookup's, and its
NULLs go last as a lookup's do, spelled only on a nullable column); 0015
(`RecordAdapter` gains `list`, one statement for a page and the table it
was read from); 0016 and 0017 (each adapter's list statement, and their
shared `sql/order.ts` and `sql/search.ts`); 0018 (`planList` and
`listable`); 0022 (a list asks the policy on every request, as a read
does); 0023 (the audit operation `list`, which names no record and never
the search, the sort or the parent); 0041 (a page is decided over the
description its own statement carries, and refused there also when the
table no longer holds its key unique and NOT NULL, which review does not
stop); and 0043 (a list carries every through from its first statement, as
that record said it would, and a form whose rows nothing scopes while a
lookup's options are filtered, which that record's studio note describes,
offers no list).
