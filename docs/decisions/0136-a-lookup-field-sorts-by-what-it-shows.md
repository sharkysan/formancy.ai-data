# 0136 — A lookup field sorts by what it shows

- **Status:** accepted; amends [0135](0135-a-lookup-field-filters-by-the-record-it-refers-to.md): a lookup field sorts, by its first display column; extends [0044](0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md): a list's order may name a lookup's label; extends [0105](0105-a-forms-list-offers-views-its-administrator-named.md): a view may sort by a lookup
- **Date:** 2026-11-05
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/records/plan-list.test.ts` --
  a sort by a lookup is planned as its label: the target, the key's
  pairing, the lookup's own read filter scoped on the target, and its
  first display column, NULLs last, the key after it; offered only where
  that filter resolves for the person (watched failing with every lookup
  refused as not sortable); `list-terms.test.ts` -- an adapter reads a
  label fresh, keeps it in the seek, and refuses one shaped otherwise
  (watched failing with a label refused as an order by no named column);
  `presentation/views.test.ts` -- a view ordered by a lookup is stored and
  carried by a regeneration (watched failing: it was dropped). Both
  adapters' `list.integration.test.ts` hold the shared case `list: label`:
  a child listed by its parent's name over a text key, ascending and
  descending, a parent of another tenant -- hidden by the lookup's filter
  -- and a child with none both after every name by their keys, and the
  same order page after page. `packages/data-server/src/routes/runtime-lists.test.ts`
  -- the form offers the lookup as sortable and a sort by it reaches the
  port as its label. `apps/studio/src/list-views.test.tsx` -- a view's
  Sort by offers a lookup (watched failing without).

## Context

0135 made a lookup filter by the record it refers to, and left its sort
out: the token a lookup holds orders nothing a person reads. A grid of
orders should sort by its customer the way a person sees the customer, by
name.

## Decision

**A lookup sorts by its first display column.** The value the grid shows
first in its label, read from the target for each row's foreign key
(`packages/data-core/src/records/scope.ts`'s `sortLabelsFor`), under the
lookup's own read filter -- the one the page's labels are read under
(`lookupRowFilter`), scoped on the target. A lookup whose filter this
person does not resolve, an attribute it names missing, is not offered as
sortable to them; the form's description and the planner ask the same
function (`listable`), and a view's store and a regeneration offer every
lookup that shows a display column (`displayedLookups`).

**A label is a term of the order, not a scope.** `ListSort` is a column's
sort or a `LabelSort`, carrying what a `Through` carries -- the root's
foreign-key columns, the target and its key -- with the lookup's filter
and the display column, and read by the adapter through
`records/sort-label.ts`. It decides nothing of which rows exist: the
lookup's filter is inside the label's own subquery, never in the page's
condition or the anchor's, so a row whose target the filter hides, or
holds no row for, sorts with the rows that show no label -- after every
label, both ways, by its key -- and is still listed. A page after such a
row is not refused as gone.

**Read once per row, matched exactly.** Each adapter reads the label in a
lateral join of its own -- PostgreSQL's `cross join lateral`, SQL Server's
`cross apply` -- a scalar subquery, one value per row, so it multiplies
none, and orders, numbers and seeks by that column; SQL Server's window
then orders by a column rather than a subquery. A text key is compared
under the database's default collation, and on SQL Server byte for byte as
well, so a row sorts by exactly the label its page shows -- a token is
labelled only on an exact match -- and a key whose two columns differ in
collation is compared under one rather than refused, as a through's is.
The label's text is ordered by its column's collation, as any text is.

## Consequences

**What it buys.** Every lookup a person may read sorts the way they read
it, on both engines, page after page.

**What it costs.**
- A label of several display columns sorts by its first alone.
- Under SQL Server's case-insensitive collation, a key spelled in another
  case than its target's sorts with the rows that show no label, as the
  grid shows it unlabelled.
- A target key that stopped being unique since the form was published
  fails the list (21000 on PostgreSQL, 512 on SQL Server): a list
  describes its root, not a lookup's target.
- A lookup whose filter names an attribute the person does not carry is
  not sortable for them.
- Each label sort adds a subquery per row of the page's statement; its
  cost is not measured.

**What it forecloses.** Nothing: the order is the planner's, as every
order is, and the browser names a field.

## Alternatives considered

**A join to the target.** Ordered by the joined column, a target key that
is not unique would multiply rows, and the lookup's filter in the join's
condition would decide which rows a list shows.

**The order of the token.** The token is the key's text; a person sorts
by what they read.

**The scalar subquery in the order itself.** One copy in the window's
order, the page's order, each side of the seek and SQL Server's NULL
placement -- some eight copies of one subquery -- and a subquery in a
window's order that SQL Server may refuse; a column of a lateral join is
read once.

**A through's EXISTS.** A through compares no text key without a collation
to name, and its filter decides which rows exist.
