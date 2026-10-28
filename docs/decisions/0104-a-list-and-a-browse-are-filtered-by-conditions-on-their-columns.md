# 0104 — A list and a browse are filtered by a person's conditions on their columns, each value spelled as its column holds it

- **Status:** accepted; extends [0044](0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md): a form's list takes a filter, and a form's description says what each field offers one; extends [0079](0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md): an export holds the records the same filter admits; extends [0099](0099-a-browse-role-reads-any-table-or-views-rows-as-the-connections-account-does.md): a browse takes a filter by column, beside a follow's equal values ([0103](0103-a-browsed-row-follows-its-foreign-keys-either-way.md))
- **Date:** 2026-10-27
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/records/filter.test.ts` --
  what each kind offers, a timestamp a range of days and no equality, a
  float or a time only its NULLs; each value spelled as its column holds
  it, text exactly as typed, a value its column cannot hold refused and
  never rounded, an operator not offered refused; a range inclusive, a
  timestamp's whole days and one to the last day open above; `dayAfter`
  across months, leap years and the calendar's edges; and `readFilter`
  refusing anything but each operator's exact shape.
  `records/plan-list.test.ts` and `records/browse.test.ts` -- only a
  readable column field or a shown column is filtered, by what it offers,
  the refusal naming it and never the value; `records/list-terms.test.ts`
  -- a planned filter reaches the adapter fresh, and a condition the
  planner would not plan is thrown. Both adapters' `list.integration.test.ts`,
  the shared cases `column filter: *` (`COLUMN_FILTER_PARITY`, held to the
  rows the suites write by `packages/data-fixtures/src/column-filters.test.ts`)
  on PostgreSQL and on SQL Server: text, integer, decimal, boolean and uuid
  equality, `contains`, NULL, several conditions each of which removes a
  row, a filter beside a search, a parent and a follow, a column under a
  case-insensitive collation, and day ranges on an instant, a zoneless
  timestamp and a date, the last three again in a session whose zone and
  date order would move a day (Pacific/Chatham with `SQL, DMY`; German with
  DATEFORMAT dmy); and SQL Server's "a day range on each of SQL Server's
  zoneless clocks", `datetime`, `smalldatetime`, `datetime2(7)` and
  `datetime2(0)` at midnight exactly and a range from 0001-01-01.
  `packages/data-server/src/routes/runtime-lists.test.ts`,
  `runtime-exports.test.ts` and `admin-browse.test.ts` -- each condition
  reaches the port as the planner spells it, on every page of a file; a
  condition not offered is 400 `not-filterable` in the planner's sentence,
  never the value, with nothing asked; and no value reaches the log or the
  audit trail. `packages/data-server/src/e2e.integration.test.ts`, "a
  person's filter on $engine (0104)", over HTTP on both engines: a
  filtered list, a filtered file of two pages and a filtered browse hold
  exactly the rows every condition holds for, each derived from the
  unfiltered answer. `packages/data-client/src/transport.test.ts`,
  `lists.integration.test.ts` and `exports.integration.test.ts` -- the
  filter in the body of a POST and no URL, and a form whose list says
  nothing of filters refused. `apps/host/src/filter.test.tsx`, on both
  engines, and `filter-terms.test.ts` -- a grid lists only what every
  condition holds for, on every page and in its file and in a child
  section's, each condition removed on its own, the keyboard kept, a
  refusal in the server's words with what was typed kept, and axe;
  `apps/host/src/plane.test.tsx` -- the filter is in no URL.
  `apps/studio/src/browse-filter.test.tsx` -- what the Browse step offers
  each column, what it sends, the whole days at both midnights, removing
  and clearing by keyboard, a refusal, a follow starting unfiltered and
  Back returning the filter. The browser gates,
  `apps/host/scripts/browser/filtering.mjs` and
  `apps/studio/scripts/browser/browse.mjs`, with a panel open, a filter
  applied, refused and removed.

## Context

A form's list has a search, a sort and a parent
([0044](0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md)),
and the studio's Browse step a search, a sort and a follow's equal values
([0099](0099-a-browse-role-reads-any-table-or-views-rows-as-the-connections-account-does.md),
[0103](0103-a-browsed-row-follows-its-foreign-keys-either-way.md)). A
search matches its text in every text and integer column at once, so it
finds "Muster" and cannot find the orders placed last month, the customers
with no credit limit or the shipments over a weight. Those are what a person
asks of a grid of records, and the answer was a database client.

0103 left column filters for later because each operator is a decision on
both engines: what equality means under a collation, what a range means for
a decimal of a given scale or for an instant the page shows cut to the
second, what NULL is. The answer here is a closed set of operators, each
decided once for both engines and for both planes.

## Decision

**A filter is a list of conditions, structured and never SQL.** A list's,
an export's and a browse's body take `filter`: each condition names a field
(a form's) or a column (a browse's) once, and an operator from a closed set
with exactly that operator's properties:

| Operator | Properties | Means |
|---|---|---|
| `equals` | `value` | the column's value is this one |
| `range` | `from`, `to`, either `null` | at least `from` and at most `to` |
| `contains` | `text` | the column holds this text, as the list's search matches it |
| `null` | -- | the column is NULL |
| `not-null` | -- | the column is not NULL |

Every condition must hold, beside the search, the parent or the follow, and
inside the policy's row filters and throughs: a filter narrows and never
permits. `readFilter` (data-core's `records/filter.ts`) reads a body's
filter by field or by column, and anything else -- an unknown operator, a
property too many or too few, a field named twice, a range with neither
bound -- is `malformed`. What `contains` finds is read as a search is,
trimmed and at most 200 characters, and text a search could not be is 400
`not-filterable`, in a sentence of the condition's own: a page that heard
a search's code would blame a search box the person never typed in, or
offer to ask again.

**What a column offers depends on its kind, decided once.** `filterOffer`
is asked by `listColumns`, so `GET /v1/forms/:id` names in `list.filterable`
each field a person may filter by, its operators, what a value is typed
as and, for a timestamp, whose clock its days are on (`days`, `utc` or
`wall`), so a page never guesses it from the control a form draws; by
`planList` and `planBrowse`, so an offer is never refused; and by the
studio:

| Kind | Operators | A value is |
|---|---|---|
| text | `equals`, `contains` | text, exactly as typed |
| integer, decimal | `equals`, `range` | a number |
| date | `equals`, `range` | a date |
| timestamp | `range`, of whole days | a date |
| uuid | `equals` | a uuid |
| boolean | `equals` | `true` or `false` |

`null` and `not-null` are offered on any of these, and on a float or a
time, wherever the snapshot says the column holds NULLs. A float, a time,
binary, a rowversion and an unsupported column offer nothing else. A form's
lookup field offers nothing: its value is a token, not the label a person
reads.

**A value is spelled as its column holds it before anything is bound.**
`columnFilter` plans each condition for the adapter. Text is taken as typed,
a trailing space included. A number is trimmed and spelled without a plus or
leading zeros, and a decimal's fraction is padded to its column's scale:
`50` for a `numeric(14,2)` is `50.00`. A decimal with more fraction digits
than its scale, or a number outside its column's range or precision, is
refused, never rounded or clamped: a rounded bound admits values the person
left out. A uuid is lowercased, a date is `YYYY-MM-DD`. A refusal is 400
`not-filterable`, and so is a field the person may not read or an operator
its column does not offer; its sentence names the field or column and never
the value.

**Equality is a row filter's** ([0028](0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md)):
the column's canonical value is the value, unit for unit, whatever its
collation, so `Muster AG` is not `muster ag` on either engine, where SQL
Server's case-insensitive default would match them with a bare `=`. A
follow's equality stays the database's, as the foreign key compares
(0103). Case-folded matching is `contains`, which is the list's search on
one column: its `%`, `_` and `[` match themselves, and each engine folds as
its search does (0044).

**A range includes both bounds.** A timestamp's range is whole days: from
the start of `from` to the end of `to`, compared with the stored value as at
least `from`'s midnight and below the midnight after `to`, in UTC for an
instant -- the page shows instants in UTC -- and on the wall clock for a
timestamp in no zone. A row at 23:59:59.9 on the last day is inside, which
an inclusive bound at the second the page shows would miss, and midnight is
exact in every timestamp type both engines have. A timestamp offers no
equality for the same reason: a person types what the page shows, cut to
the second ([0040](0040-instants-and-times-are-read-to-the-shape-and-an-unedited-one-is-never-written.md)).

**NULL is `null`.** Text of no characters is a value, and `null` does not
find it.

**The adapter reads the filter through `listTerms` and binds every value.**
Anything `columnFilter` would not have planned is thrown before a statement
is built. Each condition is one predicate on the column, never the column
converted: an equality is the row filter's own spelling, exact on both
engines (each adapter's `records/filter.ts` says how); a range's bounds are
bound as the column's own type, so the comparison is that type's own
operator; `contains` is the search's own spelling; `null` and `not-null`
are `is null` and `is not null`. A boolean is bound as `bool` on PostgreSQL
and `bit` on SQL Server. The one bound not of its column's type is SQL
Server's zoneless midnight, a `datetime2` of the column's scale read in ISO
8601: the snapshot cannot tell `datetime` from `datetime2(3)` nor
`smalldatetime` from `datetime2(0)`, and a bound of their own type would
fail the statement (242) for a day they cannot hold. Every bound is written
year first, so neither engine's session -- its zone, its date order, its
language -- moves a day.

**The export takes the same filter**, so the file holds the records the grid
shows ([0079](0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md)).

**The host's grid and the studio's Browse step each have a filter panel of
their own**, not a grid library's filter menus. In the host (`apps/host/src/filter-panel.tsx`), Filter, under a grid's search
and in each child section, opens a panel over the fields `list.filterable`
names, by their labels: a field, a condition it offers -- is, is between,
contains, has no value, has a value -- and a value, or a range's From and To,
as the field takes them: a date box for a date or a timestamp, Yes or No for
a boolean. Apply puts the condition in place of the one its field had and
lists the grid again from its first page; each condition is listed with a
Remove of its own, Clear filter removes them all, the grid's line says which
fields filter it, and Download CSV saves the records it lists. In the studio
(`apps/studio/src/browse-filter.tsx`), Filter rows does the same over the
columns the page shows, each offered what `filterOffer` gives it in the
studio's own discovery, and a column that discovery does not hold nothing.
Neither page checks more than a condition's shape -- a range has a bound, a
`contains` has text: whether a value fits its column is the server's to say,
and its sentence is shown with what was typed kept in its box. Paging and
sorting keep a filter. A follow starts the other end unfiltered, since the
page it left has conditions on columns of its own, and Back returns that
page with its filter, as it returns its sort and search.

## Consequences

It buys the questions a person asks of a grid -- last month's orders,
customers without a credit limit, shipments of a carrier -- answered by the
database, a page at a time, under the policy, in the host and in the
studio, and the same records in the file a person downloads. It adds no
statement shape: each condition is one more predicate in the list's own
statement, bound as a parent's or a row filter's is.

The costs:

Conditions are joined by AND and there is no OR, no "not equal", no "starts
with" and no range over text, whose order is each engine's collation
([0012](0012-a-lookup-token-is-a-reference-not-a-permission.md)).
A float and a time are filtered by NULL alone, a timestamp by whole days
and never its time of day, and a lookup field not at all. One condition per
field: a range is the way to say
two things about one column.

Equality on text is exact on both engines. A person who types `muster ag`
finds nothing under a collation that would call it equal, and uses
`contains` for that. On PostgreSQL an unconstrained `numeric` keeps the
scale each value was given, so `12.5` does not equal a stored `12.50`
(0028); a range compares them as numbers.

An instant's days are UTC's, as the page shows them. A person thinking of
their own day in another zone gets a range shifted by their offset.

A range to 9999-12-31 has no midnight after it that SQL Server stores, so it
has no upper end: on PostgreSQL it also holds a timestamp after the year
9999, which SQL Server cannot store, and whose text no field accepts.

A decimal with more fraction digits than its column holds is refused rather
than rounded: `10.005` on a column of two decimals is refused, and the
person types `10.00` or `10.01` as they mean it.

`contains` folds case on both engines and accents too on SQL Server where
the column's collation does, never on PostgreSQL: the list search's own
difference (0044).

Nothing is measured. An equality or a range on an indexed column may be
served by its index, as the row filters' measurements suggest (0028), and
`contains` reads every row the other conditions leave, as a search does. On
SQL Server a `datetime` or `smalldatetime` column is converted to
`datetime2` to meet its bound, which may keep an index on it from being
sought.

A field the person may not read is never offered, since a filter on it
would tell its values one question at a time. A condition the server
refused stays in the host's list of conditions, and so in its grid's
request and its file's, until the person replaces or removes it; the grid
says the refusal until then.

`@formancy/data-client` refuses a form whose list says nothing of filters,
as it refuses one that says nothing of deleting: a host upgrades its server
before its client.

The values travel in the request's body, a POST, so they are in no URL; the
audit events name the form or the object, never a value
([0023](0023-the-audit-trail-is-operational-not-evidence.md)). A filter is kept in no address and by
nothing else: a reload, another form, another parent for a child section
and Show rows each start without one, and nothing saves a filter a person
used.

## Alternatives considered

- **A query language, such as `amount > 100 and status = 'placed'`.**
  Rejected: a parser is a second SQL to keep safe, and every operator in it
  is still a decision on both engines. Structured conditions are checked
  one by one against the server's own snapshot (0011).
- **The grid library's column filters.** Rejected: their menus speak the
  library's words in the grid, where the host's status line speaks for it
  ([0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md)),
  their model has operators -- "not equal", "starts with", ranges over
  text, OR between two conditions -- that the engines spell apart, and the
  studio has no such grid.
- **Equality with the database's own, as a follow compares.** Rejected for
  a condition a person types: SQL Server's case-insensitive default finds
  `ACME` for `acme` and PostgreSQL's deterministic default does not, so one
  filter would find different rows on each engine. A follow compares as the
  key does because the values came from the database.
- **A timestamp's range to the second.** Rejected: the page shows an
  instant cut to the second and SQL Server's `datetime` keeps 1/300 of one,
  so a bound typed from the page misses the rows under it. Whole days
  compare exactly on every type.
- **Round a decimal to its column's scale.** Rejected: a rounded bound
  admits values the person left out -- a `to` of `10.005`, rounded to
  `10.01`, admits 10.01 -- and an equality with a value its column cannot
  hold is one no row has.
- **OR between conditions.** Not now: it is a grouping of conditions to
  design and to show, and AND covers narrowing.
