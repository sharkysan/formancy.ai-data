# 0103 — A browsed row follows its foreign keys either way, each follow a browse narrowed to the row's values

- **Status:** accepted; extends [0099](0099-a-browse-role-reads-any-table-or-views-rows-as-the-connections-account-does.md): a browse may be narrowed to the rows equal to given values in shown columns of a key kind, and the studio's Browse step follows a row's foreign keys through it, to what the row refers to and to what refers to it; extended by [0104](0104-a-list-and-a-browse-are-filtered-by-conditions-on-their-columns.md): a browse, a follow's page among them, is filtered by a person's own conditions on its columns, and equality there is exact, where a follow's is the database's
- **Date:** 2026-10-26
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/records/follow.test.ts` -- a
  foreign key is followed either way, each from the columns that hold the
  values, and a key from a table to itself both ways; each key that cannot
  be followed is named with why: one onto a table the account cannot see,
  one from a table outside the approved schemas, one through a column the
  account may not read, and one over an instant; what refers to an object
  is not all there is under a `referenced-by` gap or in a snapshot older
  than 0049; an object the snapshot does not hold follows nothing; and
  `followTerms` pairs a composite key's columns by position and follows
  nothing from a NULL or a value the page does not hold.
  `packages/data-core/src/records/browse.test.ts` -- a browse narrowed to
  equal values reaches `listTerms` as its `equal`; a column the page does
  not show, a timestamp, a value its column cannot hold and a column named
  twice are each `not-comparable`, the refusal never naming the value; and
  a body's `equal` is read as given, and any other shape -- a NULL among
  them, or a column named twice -- is malformed. `packages/data-server/src/routes/admin-browse.test.ts` -- an
  `equal` reaches the records port bound as the planner checked it, and a
  column the page does not show or a value its column cannot hold is 400
  `not-comparable`, with nothing read and the value not in the answer.
  Both adapters' `list.integration.test.ts`, "a row followed through a
  foreign key", the shared case `browse: follows` (BROWSE_PARITY.follows)
  on PostgreSQL and on SQL Server: tenant 1's customer 1001 is followed
  through `fk_order_customer`, a composite key, to its orders and never to
  tenant 2's, whose customer is numbered 1001 too, and each order back to
  that customer alone. `apps/studio/src/browse.test.tsx` -- what the Browse
  step offers a row either way, what a follow sends, the trail back to the
  page it left as it was, a key holding a NULL that follows nothing, the
  keys not followed named, a refusal that keeps the page on screen, and
  axe. The studio's browser gate, `apps/studio/scripts/browser/browse.mjs`,
  with a row's relations open and after a follow.

## Context

The Browse step
([0099](0099-a-browse-role-reads-any-table-or-views-rows-as-the-connections-account-does.md))
pages one table or view at a time. A foreign key's value on that page --
an order's customer number -- says nothing without the row it names, and
what refers to a row -- a customer's orders, an order's lines -- is half of
why somebody looks at data before building a form over it. Finding either
meant choosing the other table and searching for the value, and a search
matches every text and integer column of the page, as a list's does, never
a key's columns together: a composite key such as a tenant and a customer
number found both tenants' customer 1001.

Everything needed was already there. The snapshot the studio holds names
every foreign key both ways: an object's own, and since
[0049](0049-a-snapshot-says-whether-its-account-may-delete-and-what-refers-to-each-table.md)
the keys on other tables that refer to it, with a `referenced-by` gap where
the account cannot see them all. And the list statement already narrows to
the rows equal to given values in given columns: it is how a child form's
page is narrowed to its parent
([0043](0043-a-child-forms-rows-are-reached-only-through-a-parent-its-policy-admits.md),
[0044](0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md)),
bound on both engines and compared with each engine's own equality, as the
foreign key compares them.

## Decision

**A browse may be narrowed to equal values.**
`POST /v1/connections/:id/browse` takes `equal`, a list of
`{ column, value }`: the rows whose value in each column is the one given,
spelled as the column holds it. `planBrowse` accepts a column only when the
page shows it and it is of a key kind -- text, integer, decimal, uuid or
date, the kinds whose values have one spelling on both engines -- with a
value its column can hold (`isKeyValue`); anything else is 400
`not-comparable`, whose sentence names the column and never the value. The
terms are the list's `equal`, checked by the adapter's `listTerms` and
bound, as a parent's are. Equality is the only comparison, and NULL is not
a value: a body holding one, or naming a column twice, is malformed.

**The studio offers each row's foreign keys, either way.**
`browseRelations` (data-core's `records/follow.ts`) derives them from the
snapshot the studio holds: the object's own keys, to the row each refers to,
and the keys in its `referencedBy`, to the rows that refer to it; a key
from a table to itself is both. A key is offered where its follow would be
planned: both ends in the snapshot, and every column of it, at both ends,
one the account may select, of a key kind. Every other key is named with
why, on the table's page whether or not a row can follow anything: it
refers to a table the account cannot see, its other end is outside
the approved schemas, or a column of it cannot narrow a browse. Where a
`referenced-by` gap covers the object, or the snapshot predates 0049, the
step says that the connection may not see every table that refers to it.

**A follow is a browse of the other end narrowed to the row's values.**
`followTerms` pairs the other end's columns with the row's values by
position, as a composite key pairs them. A key with a NULL in any column
refers to no row on either engine (MATCH SIMPLE) and follows nothing: the
step says so rather than offering it, since narrowing by the columns that
are left would find rows that merely share them. A follow asks for the
other end's first page, unsorted and unsearched; the page it left goes onto
a trail, and Back returns to that page exactly -- its offset, sort, search
and narrowing. Show rows starts again with no trail. The page says what
narrows it.

**The server decides every follow again.** What the studio derives is only
what it offers: the server discovers the connection for each page, as it
always did, and plans the follow over its own snapshot, so a column the
catalog no longer shows is refused there whatever the studio's snapshot
said.

## Consequences

It buys the way from an order to its customer and from that customer to its
other orders, by keyboard, without leaving the step, typing a value or
holding a second set of credentials; a composite key is followed as the key
it is, tenant and number together. It adds no statement shape: the list's
`equal` is the one a child form's page binds on both engines, through the
same check.

The costs:

Only key kinds compare. A key over a timestamp, a boolean or binary is named
and not followed: an instant has more than one spelling and the engines
keep it at different precisions, so a value equal on one could find
nothing on the other.

A key is followed only where the account may read every column of it at
both ends and both ends are in the approved schemas; a key onto a table the
account cannot see, or to or from one outside the scope, is named and not
followed. A relationship the catalog does not declare as a foreign key --
a column naming another table's row by convention, anything a view joins --
is not offered at all. A key the database does not enforce, or has not
validated, is offered as any other, and a follow through it finds what the
values find, which may be nothing.

The values compare with the database's equality, as the foreign key does:
under a case- or accent-insensitive collation a follow finds the rows the
key would match, not only those spelled the same, where a row filter
compares exactly
([0028](0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md)).

The studio offers what its own discovery holds, and its snapshot can be
older than the catalog. The server checks the columns and the values, not
that the key still exists: a column dropped or no longer readable since is
refused, 400 `not-comparable`, a table gone is 404 `unknown-object`, and
the page stays on screen; a follow through a key dropped since still
narrows by its columns. A key added since is not offered until the studio
discovers again.

Each follow is a discovery and a statement, as every browse page is (0099).
A foreign key refers to a primary or unique key, which each engine keeps an
index for, so following what a row refers to lands on one. Neither engine
indexes the referring columns by itself, so following what refers to a row
may read the whole referring table where nobody made such an index. Not
measured.

The trail lives in the page: a reload loses it, as it signs the
administrator out. There is still no count: a follow's page says whether
there is another page, never how many rows refer to the row.

The row's values are written into the page -- on each follow's button and
in the line saying what narrows the page -- and into the request's body, a
POST, so into no URL. A holder of a browse role reads them anyway. The
audit event is a browse's: it names the connection and the object, and has
no field a value could be written to
([0023](0023-the-audit-trail-is-operational-not-evidence.md)), so an
operator can tell that a table was browsed, and not which row led there.

## Alternatives considered

- **A server route for a row's related rows, given the row.** Rejected: a
  browsed row has no token -- 0099 pages any table, and a view has no key
  -- so the route would be given the row's values anyway, which is what
  `equal` already is, and would need a plan, refusals and an audit of its
  own beside the browse's.
- **Column filters with operators, now.** Not done here: a range over an
  instant, a decimal or text under a collation is a comparison the engines
  spell apart, and each operator is a decision on both engines. Equality on
  key kinds is what a follow needs; a filter a person types is a later
  step, still never SQL (0099).
- **Follow only what a row refers to, as a lookup does.** Rejected: the
  rows that refer to it -- a customer's orders -- are half of why one
  browses, and 0049 already records them.
- **Find the other end by searching for the value.** Rejected: a search
  matches every text and integer column, never a key's columns together,
  so a composite key finds rows of another tenant.
- **Keep the trail in the address.** Rejected: the trail holds a row's
  values at every step, and an address goes into the history a browser may
  sync, as 0090 found for a host's levels.
