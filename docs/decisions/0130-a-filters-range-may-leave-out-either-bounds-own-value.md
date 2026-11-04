# 0130 — A filter's range may leave out either bound's own value

- **Status:** accepted; extends [0104](0104-a-list-and-a-browse-are-filtered-by-conditions-on-their-columns.md): a range's bounds were inclusive, and may now each be exclusive
- **Date:** 2026-11-04
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/records/filter.test.ts` -- a
  body's range says which bounds are exclusive, read as given and refused
  when it names a bound that is not there or another word (watched failing
  with `exclusive` not a property of a range: every one was malformed); an
  exclusive bound of a number or a date is planned as the column's strict
  comparison, and a timestamp's as the midnight it means, after a day from
  the next midnight on and before a day below its own (watched failing
  with `above` missing from the plan); after 9999-12-31 is said in a
  sentence (watched failing as a range with no lower end).
  `packages/data-core/src/records/list-terms.test.ts` -- the adapter's copy
  holds one lower and one upper bound, and no exclusive lower bound on a
  timestamp (watched failing with the two-bounds check removed).
  `packages/data-core/src/presentation/views.test.ts` -- a stored view keeps
  `exclusive` through being fitted and offered (watched failing with the
  range rebuilt from its bounds alone). `COLUMN_FILTER_PARITY` in
  `packages/data-fixtures/src/column-filters.ts`, run by both
  `list.integration.test.ts` suites -- an exclusive range on an integer, a
  decimal, a date, an instant and a zoneless timestamp finds the same rows
  on PostgreSQL and SQL Server (watched failing on both engines before
  either adapter compared `above`; the fixtures' own check, which works
  each expectation out from the rows, failed too until it read
  `exclusive`). `apps/host/src/filter-terms.test.ts` -- a condition with an
  exclusive bound is named "over", "under", "after" or "before" (watched
  failing with every lower bound named "at least").

## Context

A grid's filter is about to become a line a person types
(`status = placed and amount > 1000`), and a line has `<` and `>` as well
as `<=` and `>=`. 0104's range had only inclusive bounds -- at least
`from`, at most `to` -- and a request carried nothing else. Inside the
planner a timestamp already had an exclusive upper bound, `before`, the
next midnight, because its range is whole days; nothing a request could
ask for reached it.

## Decision

**A range condition may name its exclusive bounds.** `FilterCondition`'s
range gains `exclusive`: `from` (above it, rather than at least it), `to`
(below it, rather than at most it) or `both`, left out where neither is
(`RangeExclusive`, `packages/data-core/src/runtime.ts`). `readFilter`
reads it as given and refuses one naming a bound the range does not have.
A stored view's range carries it too, an administrator's (0105) and a
person's own (0126), and keeps it through being fitted and offered.

**The planner compares it exactly.** `RecordFilter`'s range gains
`above`, an exclusive lower bound, beside `from`, `to` and `before`; a
range has at most one lower and one upper bound. An exclusive bound of an
integer, a decimal or a date is `above` or `before`, the column's own
strict comparison on both engines. A timestamp's bounds are days: after a
day is at least the next midnight, and before a day below its own
midnight, so a row late on the day named is outside either way. After
9999-12-31 has no midnight both engines store, and is refused with a
sentence; before 0001-01-01 is a range that holds nothing.

## Consequences

**What it buys.** `amount > 1000` on a `numeric(14, 2)` means above 1000,
and `1000.00` is not in it; a line prints back what the person typed.

**What it costs.**
- A request, a view and the adapter's copy each carry one more optional
  property, and both adapters one more comparison.
- A server of an earlier release refuses a filter or a view holding
  `exclusive` as malformed, so a host that sends one upgrades its server
  first.

**What it forecloses.** Nothing: a range without `exclusive` means what it
did.

## Alternatives considered

**Turn `>` and `<` into inclusive bounds in the browser** -- above 1000 as
at least 1001. Exact for an integer and a date only: a decimal's next
value depends on a scale the page is not told, and the line would print
`>= 1001` back for `> 1000`.

**New operators, `above` and `below`, beside `range`.** A field is named
once in a filter (0104), so `order_date >= a and order_date < b` could not
be said at all.
