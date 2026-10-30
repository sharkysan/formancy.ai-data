# 0108 — A form's list pages after the last row it showed, found again by its key, not by an offset

- **Status:** accepted; narrows [0044](0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md): a form's list pages after a row instead of at an offset, which only a browse keeps; extends [0079](0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md): a file pages the list the same way, and is refused `moved` when the row a page continues after is gone; extends [0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md): the grid keeps each page's cursor and starts again at its first page when one has nowhere to start
- **Date:** 2026-10-30
- **Deciders:** Daniel Bacher
- **Verified by:**
  both adapters' `list.integration.test.ts`, against the fixture's default
  images, each case declared with `covers()` and its expectation written
  once in `LIST_PARITY` (shared cases `list: pages`, `list: after`,
  `list: collated`): tenant 1's customers three to a page, each page asked
  for after the one before's `next`, and a page after the last row empty
  with no more; walked two at a time under seven orders -- the key both
  ways, a nullable decimal both ways, a mixed direction, text both ways --
  the pages are the one page of every row, row for row (watched failing on
  both with NULLs placed the other way in the seek: the walk never reached
  the customers with no credit limit; with the direction left ascending: a
  descending walk turned back after its first page, 2006, 2005, 2006; and
  with the seek left out: the walk never ended); a customer inserted before
  where the next page starts, or one deleted there, leaves the next page
  what it was (watched failing with the seek left out: the next page began
  at the first row again); a page after a row deleted meanwhile, and one
  after tenant 2's customer, are `gone`, hold no rows and are refused
  `cursor-gone` (watched failing with the row looked for without the read
  filter: tenant 2's customer was found and the page after it held tenant
  1's customers past 1001; and with the row said found whatever the
  statement found); a `varchar` under the database's collation walked a
  label at a time is the one page of every label -- on SQL Server under
  SQL_Latin1_General_CP1_CI_AS, whose varchar order the same labels
  compared as nvarchar do not have, which the case holds too (watched
  failing with the comparison made as nvarchar: the walk went from `co-op`
  to `cop`, skipping `coo` and `coop`). Both `uuid.integration.test.ts` --
  sixteen deliveries walked five at a time in each engine's own order of
  uuid, a uniqueidentifier compared by its byte groups as it is ordered.
  Both `lookups-sized.integration.test.ts`, on the sized `sales.customer`
  (0034) -- tenant 1's page after its 50,001st customer in key order holds
  the 50 that follow and reads 52 rows of the table, the row it continues
  after found by its key and the page with its extra row, where the same
  request at the offset that reaches that page reads 50,052; on PostgreSQL
  by an Index Only Scan and an Index Scan of `pk_customer` from the row,
  serially, on SQL Server by Clustered Index Seeks; the counts from
  `sizedListPage()` in `@formancy/data-fixtures`, each one more on
  PostgreSQL 15, whose window reads a row past the page
  (`VERSION_FACTS.windowReadsAhead`, measured on 15, 16 and 18), and the
  same on SQL Server 2019 and 2025, the matrix's other legs (watched
  failing on both with the tenant compared in the seek too: 50,053).
  `packages/data-core/src/records/list-terms.test.ts` -- the key a page
  continues after is every identity column in order, spelled as it holds
  it, never beside an offset; the seek is the order less every column the
  trusted filters, the parent and a person's equals hold to one value
  (watched failing with every column kept). `records/cursor.test.ts` -- a
  cursor reads back as the key it spells, past a token's bound, and a
  token, another version, another key or another spelling is refused.
  `records/plan-list.test.ts` -- a cursor naming no key of the form is
  `invalid-cursor` after the policy is asked, a page's `next` is its last
  shown row's key, a row with no token included, and a page whose
  statement found the row gone is `cursor-gone` (each watched failing:
  the cursor taken from the extra row, bounded as a token, read as a
  token, the outcome left unread). `records/list-query.test.ts` -- an
  `offset` in a list body is `malformed`, and a cursor is text (watched
  failing with `offset` among the properties).
  `packages/data-server/src/routes/runtime-lists.test.ts` -- the port is
  handed the cursor's key with an offset of 0, a page gives its `next`,
  `invalid-cursor` is 400 and `cursor-gone` 409 with no row in the body,
  both before or without the port as they should be (watched failing with
  the cursor dropped, with `invalid-cursor` unmapped: 500, and with the
  outcome left unread: 200). `routes/runtime-exports.test.ts` -- every page
  after the last row of the one before; a row deleted before that one
  between two pages moves nothing, every record written once (watched
  failing with the pages asked at offsets: the 51st customer was never
  written); the row itself deleted refuses the file `moved` (watched
  failing with the outcome left unread: a file of the first page, 200).
  `e2e.integration.test.ts`, on both engines through the real server and
  drivers -- the page after a page of one is the second of a page of two.
  `packages/data-client/src/transport.test.ts` -- a page without `next`,
  or with one that disagrees with `hasMore`, is `unexpected` (watched
  failing with `next` unchecked). `lists.integration.test.ts` -- exactly
  `after` travels in the body, never an `offset`, and a filtered list
  walked by its cursors holds the rows both conditions hold for.
  `apps/host/src/workspace.test.tsx`, on both engines -- Next asks for the
  page after the last row shown and Previous the first page again (watched
  failing with no cursor kept: Next showed the first page again, "Rows
  51–100; more follow."); the row the next page comes after deleted by
  another application, Next starts again at the first page and says why
  (watched failing with `cursor-gone` said as any refusal: the server's
  sentence, beside Ask again). `grid-datasource.test.ts` -- a block's
  request is its cursor and its size. The host's browser gate asks each
  view's first page after no row.

## Context

A form's list paged by offset (0044): `limit + 1` rows from `offset`, in a
total order the key ends. 0044 wrote down what that costs. A page reads
every row before its offset, so the hundredth page of a tenant's customers
reads five thousand rows to show fifty, and a person paging through a
large table pays more for each page than the last. And an offset counts
rows, not records: a row inserted before it between two pages shows the
last row of the page before again, and one deleted there skips a row. A
file of records (0079) pages the list from the first record to the last,
so a row deleted meanwhile before the next page's offset was simply left
out of the file, unseen, while one inserted there made a record appear
twice, which refuses the file.

0044 considered paging after a row and turned it down, for four reasons.
It helps only an order an index serves. SQL Server orders a `varchar`
under a `SQL_` collation by that collation's own rules, while the adapters
bind text as nvarchar (0028), which compares by Unicode's -- so a value
read from the last row and bound back could compare otherwise than the
order placed it; not probed then. It needs a cursor's spelling, mixed
directions and NULL branches decided somewhere. And a grid's infinite row
model asks for any block. The backlog asked for keyset paging instead of
offset all the same.

Since 0044, two of those changed. The host's pager steps a page at a time
-- Previous rows and Next rows, with no jump (0047) -- so every block the
grid asks for is the one after a block it was answered, or one it was
answered before. And a value's spelling turned out to be the hard part:
what a read returns is formancy's shape, not the stored value -- an
instant to the second and a time to the minute (0017, 0040), SQL Server's
`datetime` rounded to the millisecond and indistinguishable in the
snapshot from `datetime2(3)` (0026) -- so a cursor of the last row's
values would have to be read and bound at a precision nothing else here
reads, one way per type and engine.

## Decision

**A page continues after a row.** `POST /v1/forms/:id/records/list` takes
`after` where it took `offset`: `null`, or left out, for the first page;
otherwise the `next` of the page before. A page answers `next` beside
`hasMore` -- the cursor of its last row when more follow, `null` when none
do. A cursor is that row's key, every identity column, spelled as a record
token spells one (0012) under the prefix `c1:` and without a select's
200-character bound (`records/cursor.ts`), so a page ending on a row whose
key fits no token is continued all the same. It is the server's spelling,
read by nothing else, and like a token a reference, never a permission. An
`offset` in a list body is `malformed`: a client still sending one is
told, rather than shown the first page for every page it asks for.

**The row is found again in the page's own statement.** By its key, under
the person's read filter and every through, as a read finds it -- never
under the parent, the person's filter or the search, which a row that
stopped matching them leaves its place in the order. The page holds the
rows after it in the order, each compared with it column against column:
a value of the same column of the same table, so each type's own
comparison and each column's collation decide, exactly as they decide the
order, and no value is spelled, bound or converted. Each adapter spells
the comparison beside its ORDER BY (`after` in `sql/order.ts`), from the
same terms: term by term, past the row on this column, or tied with it and
past it on the rest; NULLs last both ways, so a NULL is past every value
and tied with a NULL. A row the statement does not find -- deleted, or
moved out of the person's read scope, or another tenant's whose key a
person spelled -- leaves the page nowhere to start: the outcome says
`gone`, the page holds no rows, and it is refused `409 cursor-gone`. A row
the person may not read is answered as one that is gone, so its place in
the order is never told.

**The comparison leaves out every column the scope holds to one value.** A
trusted filter's equality, the parent's columns and a person's `equals`
each hold a column to one value on every row the page could hold, which
therefore ties there with the row it continues after and never comes
after it by that column (`seekOf`, `records/list-terms.ts`). The order
keeps them; the comparison does not. Compared anyway, the tenant that leads
the customer's key makes the comparison an OR no index range serves, and a
page deep in the tenant reads every row before it, as an offset does
(measured, below).

**A file pages the same way.** Each page of an export (0079) is the list's
request after the last row of the page before, read back from that page's
own `next`. A row inserted or deleted before it meanwhile moves nothing;
the row itself gone refuses the file `409 moved`, as a record that would
appear twice already did.

**The host keeps each page's cursor.** The grid's datasource keeps every
answered block's `next` by the row the block after it starts at, the first
block's by row 0 as none, and keeps it anew each time a block is answered
-- after a save, a delete, Ask again. Previous asks after a kept cursor.
A block whose start no answer gave, or whose row the server found gone,
is answered as failed, and the grid starts again at its first page with a
line saying why: "The record those rows came after is gone, so the list
starts again at its first page." The line's row numbers count the rows of
this walk.

**A browse keeps its offset** (0099). A view or a table with no key it may
read is ordered by every column it shows; it has no key to find a row by,
and two rows equal in every shown column could not be told apart by one.
`ListRequest` carries both: a form's list after a key at offset 0, a
browse at an offset after none, and `listTerms` refuses both at once.

**The client** sends `after`, never `offset`, and takes a page only with a
`next` that is text exactly when `hasMore` holds.

## Consequences

**What it buys.** A page in an order an index serves reads from the row
it continues after, whatever its depth. Measured on the sized
`sales.customer` (0034) -- a million customers, tenant 1's hundred
thousand and one first -- with `lookups-sized.integration.test.ts` on
2026-10-30, on Docker Desktop on an arm64 Mac, against the fixture's
default `postgres:17-alpine` and `mcr.microsoft.com/mssql/server:2022-latest`:
tenant 1's page after its 50,001st customer in key order reads 52 rows of
the table on both engines, one to find the row and 51 for the page and its
extra row; the same request at an offset of 50,001 reads 50,052. On
PostgreSQL 15 each count is one more: its window reads a row past the
page before it stops, which 16 and later do not. Rows read
are counted by each engine's actual plan, as 0034 counts a lookup's, not
timed; a count does not depend on the machine. And no row inserted or
deleted before a page moves it: the grid's Next is the rows after the last
one shown, and a file no longer leaves out, unseen, a record deleted
before a page.

**What it costs.**
- A page continues after where its row is now. That row edited between
  two pages -- a sorted column changed -- moves the next page with it:
  rows between its old place and its new are skipped, or shown again. The
  host asks a page again after its own save, which gives the page after
  it a fresh cursor; another person's edit does not. A file refuses a
  record that would appear twice, never one skipped this way.
- A page after a row deleted meanwhile is refused, and the grid starts
  again at its first page; a file is refused `moved`.
- Pages are walked, never jumped to: no page can be asked for but the
  first and the ones after a row a page showed. The grid never jumped.
- An order no index serves still reads every row the scope admits and
  sorts them, for every page, as an offset did: a page by name reads the
  tenant's customers. By how both engines sort, not measured here; 0044's
  first reason stands, and is now a cost rather than a reason.
- The comparison is an OR of branches. An index serves it where the first
  column it compares leads an index -- the key's second column, after a
  tenant the scope holds -- and is otherwise a filter over the rows the
  order reads. Only the key's order is measured.
- Finding the row costs one probe by its key, inside the page's
  statement.
- A cursor spells a key in clear, as a token does: whoever holds it reads
  the key of the row. `listable` lists only a form whose key the person
  may read.
- The host and the server are upgraded together: this release's server
  refuses an older client's `offset` as `malformed`, and this release's
  client refuses an older server's page, which has no `next`, as
  `unexpected`.
- A browse still pages by offset, with the drift and the cost this record
  removes from a list.
- `ListRequest` holds `after` and `offset`, one of them always unused by
  its caller.

**What 0034's evidence would need to add.** The published figures time
lookups and were measured before this; the sized suites now pin the rows a
deep page in key order reads, and nothing times one. A page in an indexed
order other than the key's, a mixed-direction page, and a page by a
nullable column after a NULL are not counted.

**What it forecloses.** A page asked for by its number, and a total of
pages; a jump to the last page.

## Alternatives considered

**The last row's values in the cursor, bound back as each column's type.**
The textbook form, and an edited row would not move the next page. But
what a read returns is formancy's shape: an instant cut to the second, a
time to the minute (0017, 0040), so a cursor from a read would continue inside
a run of rows that share the second and repeat or skip them; read at full
precision, it would need a spelling and a binding per type per engine
that nothing else here uses. SQL Server's `datetime`, which the snapshot
cannot tell from `datetime2(3)` (0026), compares a value bound as
datetime2 apart from the one it read. And text bound as nvarchar compares
a `varchar` under a `SQL_` collation by Unicode's rules: measured with
`list: collated`'s labels, a walk compared as nvarchar went from `co-op`
to `cop`, skipping two. Each would be a place the engines differ, held by
parity cases a type at a time; the row found again has none.

**The row's version in the cursor, refusing a page when it changed.** It
would turn a moved row from a skip into a refusal. But it refuses for any
edit of the row, not only one of its order, and a form without a
concurrency column has no version to compare.

**Row-value comparison, PostgreSQL's `(a, b) > (x, y)`.** One index range
for any order of one direction. SQL Server has none, it does not place
NULLs, and a mixed direction is not one comparison.

**A `before` cursor for Previous.** The grid keeps the cursors it was
given and steps back to one; a cursor of the first row of each page would
be a second spelling of where a page is.

**Keeping `offset` beside `after` for a list.** A client could go on
paging by offset, with its drift, and the server would have two pagings
of one list to keep right.

**One snapshot for the whole file** (0079's own alternative). It would
hold a connection and the database's row versions for the file's length.
Not done.

**A browse after a row too.** A view has no key; a browse of a table with
one could, at the cost of two pagings in the studio. Not done.

## Older records

Narrowed or extended, not edited away: 0044 (a form's list pages after a
row; its offset, its offset drift and its alternative "Keyset paging" are
this record's; the order, the NULL rule, `listable`, `recordPage`'s extra
row and the description in the page's statement stand); 0079 (a file
pages after a row; a record deleted before a page is no longer left out;
the row a page continues after, gone, refuses the file `moved`); 0047 (the
grid keeps each page's cursor, and starts again at its first page when
one has nowhere to start); 0099 (a browse keeps its offset); 0028 (text
compared with text of its own column, never with a bound value, so the
collation question 0044 left open does not arise, and `list: collated`
holds it).
