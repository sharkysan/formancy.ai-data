# 0138 — The studio offers every lookup it can by default

- **Status:** accepted; extends [0024](0024-the-studio-speaks-only-the-admin-plane.md): the Choose step starts with every foreign key it can offer ticked as a lookup
- **Date:** 2026-11-05
- **Deciders:** Daniel Bacher
- **Verified by:** `apps/studio/src/choose.test.tsx` -- choosing
  `sales.order` on a connection that may read every target ticks the
  customer, created-by and approved-by keys, each with the column it
  suggests, and one unticked stays so when the step is left and come back
  to (watched failing with nothing ticked); a key whose target the
  connection cannot see stays unticked and disabled.
  `apps/studio/src/guide.test.tsx` -- the getting-started guide's studio
  steps, followed control by control on each engine as its own account,
  the writer, which reads no employee -- SQL Server's captured for it,
  `apps/studio/src/fixtures/sqlserver-writer.json` -- find the customer
  lookup ticked by default where the guide says to keep it (watched
  failing with nothing ticked by default).

## Context

The Choose step offered every foreign key as a box and ticked none: a key
left unticked became a bare number in the form. That was the safe default
while a lookup could neither be filtered nor sorted -- a number could be
both. Part 3 of the design of 2026-11-04 makes lookups the default once a
lookup filters by its record (0135) and sorts by what it shows (0136), so
ticking them takes nothing away.

## Decision

**Every key the step can offer is ticked when a root is chosen**, each
with the column it already suggests -- the first text column of the
target that is not its key, else its first column, of those the
connection may show (`apps/studio/src/choice.ts`'s `choiceFor`,
`suggestedDisplay`). A key the step cannot offer -- `lookupBlocker` says
why, a target out of sight or a key the account may not read -- is not
ticked, as before, and neither is one whose target has no column the
connection may show, which is still offered for a person to tick and
choose for. Two lookups into one table read by their columns, not both
by the table's name
([0137](0137-two-lookups-into-one-table-are-told-apart-by-their-columns.md)). The administrator unticks what they do not want;
the default is a choice made for them, shown, never one sent unseen.

## Consequences

**What it buys.** A form generated with no change in the Choose step shows
a related record by what a person recognises it by, and filters and sorts
by it.

**What it costs.**
- Each lookup ticked by default needs its rows decided in the Policy step
  before the form publishes, as any lookup does: the studio leaves that
  decision to a person rather than offering every row unasked.
- A form whose administrator wanted a key as a number unticks it.

**What it forecloses.** Nothing: the generation request is the one it
always was.

## Alternatives considered

**Tick only a lookup whose target has a text column.** The suggestion
already prefers text, and a target with none still has a column a person
recognises it by, its first.

**Tick none, and suggest.** The behaviour before: a key a person did not
think about stayed a number, now less useful than its lookup.
