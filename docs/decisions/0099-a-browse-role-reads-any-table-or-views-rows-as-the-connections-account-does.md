# 0099 — A browse role reads any table or view's rows, a page at a time, as the connection's account reads them

- **Status:** accepted; extends [0020](0020-administration-is-a-separate-plane.md): the administrator's plane reads rows, for a role of its own; extends [0033](0033-the-administrator-plane-is-audited.md): the administrator's event names the object a browse read; extends [0044](0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md): a list's statement pages an object no form is published over; extended by [0103](0103-a-browsed-row-follows-its-foreign-keys-either-way.md): a browse may be narrowed to the rows equal to given values in shown columns of a key kind, and the studio follows a row's foreign keys through it either way
- **Date:** 2026-10-26
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-server/src/routes/admin-browse.test.ts` --
  with no browse role set an administrator's browse is `403
  browse-role-required` and nothing reaches the records port; the
  administration answer refuses `browse` from the same decision; under
  review a browser browses and a publisher without the role does not; an
  object the server's own snapshot does not hold is 404 and never read; the
  trail names the object and never the search or a value (watched failing
  with the grant answering every caller: four cases).
  `packages/data-server/src/browse-roles.test.ts` -- unset is nobody, and a
  list naming no role, or a role that is not an administrator role, stops
  the server. `packages/data-core/src/records/browse.test.ts` -- which
  columns are shown, what ends the order, and every request one the
  adapters' `listTerms` accepts. Both adapters' `list.integration.test.ts`,
  the shared `browse:` cases (BROWSE_PARITY) on PostgreSQL and on SQL
  Server: the fixture's view pages in the order of every column, a sort
  keeps that order among its ties, a search finds its row, and
  `sales.country` is read without its binary and unsupported columns
  (watched failing on PostgreSQL with the keyless order removed: the three
  view cases, refused by `listTerms`). `apps/studio/src/browse.test.tsx` --
  the Browse step waits for a browse role and for a discovery, and what it
  sends and shows, axe clean. The studio's browser gate,
  `apps/studio/scripts/browser/browse.mjs`, at every width down to 320
  pixels: a table wider than the window scrolls in its grid's region and
  never the page, a sort from a header by keyboard keeps the focus there,
  and every text of the grid is measured for contrast, scrolled into view
  where the region has scrolled it out (watched failing in Chromium before
  the header's names moved to `aria-label`: 672 pixels of sideways scroll,
  the visually hidden text positioned outside the region's clip).

## Context

Somebody setting up a form wants to look at the data first: what is in a
table, whether a view returns what its name says, which column a lookup
should show. Until now the studio showed what discovery reports -- columns,
types, keys, gaps -- and never a row. Reading a row meant a database client,
a second set of credentials, and leaving the tool.

The administrator's plane was built not to read records (0020): publishing a
form and reading a business record are different permissions, and a form's
policy (0011) decides who reads which rows of it. A browser that read every
table for every administrator would undo that quietly. The runtime plane is
the wrong place too: it serves published forms to the host's people, each
read decided by that form's policy, and a table nobody published a form over
has no policy to ask.

The list statement already exists on both engines (0044): one guarded
statement, canonical values out, a search and an order both engines spell
alike, a page of fifty and whether more follow. What it needs is a target
whose identity ends a total order.

## Decision

`POST /v1/connections/:id/browse`, on the administrator's plane, answers one
page of any table or view the connection's account can see, as that account
reads it: its grants and its row security decide which rows and columns
exist, and nothing else filters them. A holder of a role named by
`FORMANCY_DATA_BROWSE_ROLES` (an embedder's `admin.browseRoles`) may call it,
each such role also an administrator role, review or not; unset, nobody may.
It writes nothing.

Each page discovers the connection again, and `planBrowse` (data-core)
plans it over that snapshot: the object must be one it holds; the page shows
every column the account may select that has canonical text, and names the
rest; the order is the requested columns, then the primary key or the first
unique key whose columns are shown and NOT NULL, or -- for a view, or a table
with no such key -- every shown column. The request is a list's, run by the
adapter's own `list` and checked by its `listTerms`. The studio's Browse
step, listed last, chooses the object from the discovery, searches, sorts by
one column from its header, and pages.

## Consequences

It buys a look at the data without leaving the studio or holding a second
set of credentials, on both engines through statements both adapters
already prove, and no new statement shape: an object, a search, an order
and a page, every name from the server's own snapshot (0011).

The cost is what it reads. A holder of a browse role reads every row of
every table and view in the approved schemas that the connection's account
can read -- no form, no policy, no row filter and no field rule between --
and a connection is often an account that may read everything, since forms
are scoped by their policies rather than by the account. Give the role to
few people, or browse through a connection whose account may read less;
nothing here narrows it.

Every page costs a discovery of the whole scope and then the page's
statement: nothing is cached between pages, so a page is never decided over
a catalog older than the request, and a catalog with many objects makes
every page slower. Not measured.

A view, or a table with no key the account may read, is ordered by every
column the page shows. Rows equal in all of them may trade places between
pages: they look the same on the page, and a column left out -- binary,
unsupported, or not readable -- may tell them apart. The studio says so on
such a page.

Binary, rowversion and unsupported columns are not shown: neither adapter
reads canonical text for them (0016, 0017). A column the account may not
select is not shown either. Both are named on the page with the reason.

A search matches text and integer columns as a list's does (0044), and text
orders by each engine's collation (0012). There is no count of rows, no
filter beyond the search, no export and no editing. The studio sorts by one
column at a time; the route takes several.

The page's own description is not compared with the discovery that planned
it: a column dropped between the two fails the page, as the adapter
reports it, and one added is not shown until the next page.

The trail names the connection and the object, once the snapshot holds it,
and never the search, the sort, a row or how many (0023). An operator can
tell who browsed which table, and not what they saw.

## Alternatives considered

- **Every administrator browses.** Rejected: it would grant reading every
  row to everybody who may publish a form, which 0020 keeps apart, and a
  deployment that upgraded would find its administrators reading data they
  could not read the day before.
- **Browse on the runtime plane, through a generated policy per object.**
  Rejected: the runtime serves published forms to the host's people, each
  read decided by that form's policy; a policy made up for an object nobody
  published would be a policy nobody wrote.
- **Refuse a view or a keyless table.** Rejected: it would hide every view,
  which is often what somebody wants to look at. Ordered by every column, its
  paging is as total as its rows can be told apart on the page.
- **Cache the discovery between pages.** Rejected for now: a cached snapshot
  would read an object or a column the account has lost, or plan over a key
  that is gone. A deployment that measures discovery as the bottleneck is the
  reason to revisit it.
- **Show binary as hexadecimal or base64.** Not done here: neither adapter
  reads canonical text for binary, and choosing one is a codec decision,
  with its own record, not a browser's.
- **A filter or a query typed by the person.** Never: no SQL and no raw
  identifier comes from the browser (0011).
