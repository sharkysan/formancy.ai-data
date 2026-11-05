# 0135 — A lookup field filters by the record it refers to

- **Status:** accepted; amends [0104](0104-a-list-and-a-browse-are-filtered-by-conditions-on-their-columns.md): a list is filtered by a lookup field, by the record it refers to or whether it refers to one; amends [0123](0123-an-administrator-chooses-the-fields-a-forms-filter-panel-offers.md): a lookup is a field the filter offers, which an administrator may leave out; extends [0131](0131-a-person-types-a-grids-filter-as-a-line-and-sees-each-condition-as-a-chip.md): the line reads and writes a lookup's record by its label; amends [0132](0132-each-column-header-filters-its-column.md): a lookup's column has a box that searches its lookup; amends [0133](0133-a-cell-filters-by-its-value.md): a lookup's cell gives the record it shows
- **Date:** 2026-11-05
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/records/plan-list.test.ts` --
  a token on a key of two columns is planned as each column's `refers`,
  emptiness on a single nullable key as its column's `null`, a key of
  several columns offers equality alone, and a token no row could have is
  refused naming the field (watched failing with every lookup refused as
  no field the list is filtered by); `list-terms.test.ts` -- an adapter
  reads `refers` fresh and refuses one spelled otherwise;
  `presentation/views.test.ts` and `unfiltered.test.ts` -- a view and the
  administrator's choice accept a lookup; `filter-line.test.ts`,
  `filter-header.test.ts` and `filter-complete.test.ts` -- the line and a
  box read a record by the label the page shows and write it so, refuse a
  label no record shown has or two share (watched failing with each sent
  as typed), and completion inserts a record by its label. Both adapters'
  `list.integration.test.ts` hold the shared case `column filter: lookup`:
  a customer's country, a key of two columns and a line's order under its
  throughs, each by the database's equality. `apps/studio/src/list-views.test.tsx`
  -- a view offers a lookup by whether it refers to a record, and a key of
  two columns not at all (watched failing with the list's offer taken
  whole). `apps/host/src/lookup-box.test.tsx`, `cell-example.test.tsx`,
  `known-records.test.ts` and `filter-terms.test.ts`, without a server,
  and `apps/host/src/lookup-filter.test.tsx`, on both engines against the
  real server -- the box searches its lookup and applies the record
  picked, the line takes a record's label, `=` on a cell takes its record,
  each sent as the token and said by its label. The browser gate's
  `filtering.mjs` measures the box's records open over the page.

## Context

A lookup holds a token, not the label a person reads, so 0104 left it out
of a list's filter, sort and search, and 0123 refused one as a field the
filter offers. Every foreign key shown as a lookup was therefore the one
column a person could not filter by -- `approved_by is empty`, the orders
of one customer -- while the same key drawn as a bare number could be.
Part 2 of the design of 2026-11-04 makes a lookup filter first, so ticking
lookups by default later takes nothing away.

## Decision

**A lookup filters by the record it refers to.** `= <token>`, where the
token is a record the person picked, decoded through the root's
foreign-key columns as a parent's is (`packages/data-core/src/records/lookup-filter.ts`).
Each column is compared by a new `RecordFilter`, `refers`: the database's
own equality, as the foreign key and a parent's `equal` compare it, and
never the exact equality a typed value gets. Under SQL Server's
case-insensitive collation `ch` finds the customer of `CH`, where
PostgreSQL's deterministic default finds none -- the difference a parent
already has (`text-parent`), named in the parity case. `refers` is a
condition beside `equal`, so a child's parent and its lookup's filter may
name one column; the seek of a page holds no `refers` column as fixed.

**Emptiness only where one column says it.** A key of one nullable column
offers `is empty` and `is not empty`, its column's `null` and `not-null`.
A key of several columns refers to nothing when any of them is NULL,
which the grid shows as empty and no condition on one column says, so it
offers equality alone.

**The page names a record by its label.** The browser has the token; a
person has the label. A grid keeps the records it has heard of, per lookup
field (`apps/host/src/known-records.ts`): those its pages showed, those
picked in a box or taken from a cell, and those its filter names, which a
view brings without a label and the page resolves as it resolves a page's
rows. They are the lookup's values in the line, which reads `approved_by =
grace` as Grace's token and writes it back by the label, completes a
record by its label, and refuses a label no record shown has, or two
share, rather than send it; a chip says `Approved by is “Grace”`. A
lookup's column has a box of its own (`apps/host/src/header-filter.tsx`'s
`LookupBox`): a combobox that searches the lookup as the person types, as
a form's lookup does, offers whether the field refers to a record while
empty, and applies the record picked. `=` on a lookup's cell takes the
record it holds.

**The studio offers what it can pick.** Its view editor has no record
picker, so it offers a lookup by whether it refers to a record, and a key
of several columns not at all; a person's own view holds any lookup
condition the line held.

**A view's record is fitted as far as its bindings tell.** A published
view's token is checked to be a token of as many values as the key has
columns; whether each value fits its column is the list's to say, which
has the snapshot.

## Consequences

**What it buys.** Every foreign key a form shows filters by what it
refers to, in the words a person reads, three ways: its box, the line and
its cells.

**What it costs.**
- A lookup does not sort yet: its token orders nothing a person reads. A
  sort by what it shows is the next decision.
- A key of several nullable columns offers no `is empty`.
- The line names only records the grid has heard of. A record never shown
  is picked in the column's box, whose pick the line then knows.
- Under SQL Server's case-insensitive collation a text key finds the
  spellings the foreign key relates; PostgreSQL's default finds one.
- Each keystroke in a lookup's box asks the server; the one before is
  abandoned, and stops in the database (0061).
- The studio's views offer no record of a lookup.
- A view's record that does not fit its column is refused when the list
  is asked for, not when the view is published.

**What it forecloses.** Nothing: the server still receives tokens and
decides what they name.

## Alternatives considered

**Filter by the label.** `customer contains Muster` reads naturally, but
it is a condition on another table, under the lookup's own row filters,
which is the related filter the design sets after this one; and two
records may share a label.

**Exact equality on the key.** The condition `equals` already plans: it
would find no row a SQL Server foreign key relates by case, which is the
record the person picked.

**`is empty` as any column NULL.** A predicate no `RecordFilter` says; one
adapter's OR of `is null` per column is a new shape on both engines for a
key the fixture model does not have, and no test could hold it on both.
