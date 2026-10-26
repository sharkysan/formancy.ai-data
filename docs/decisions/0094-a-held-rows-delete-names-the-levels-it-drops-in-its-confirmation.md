# 0094 — A row a Drill down level holds names the levels it drops in its Delete's confirmation, and drops nothing before Delete it

- **Status:** accepted; amends [0090](0090-a-hosts-workspace-can-drill-down-one-level-at-a-time-with-a-trail-back.md)'s delete of a record a level holds
- **Date:** 2026-10-22
- **Deciders:** Daniel Bacher
- **Verified by:**
  `apps/host/src/drill.test.tsx`, on SQL Server against the real server,
  where an order line's rowversion proves a delete (0050). *The held row's
  Delete names the levels below in its confirmation, and Keep it keeps
  their typing* -- an order line typed into a level down, its row's Delete
  pressed in the order's section: no unsaved-changes notice, the
  confirmation "Delete Order line k1:…?" lists "Order line k1:…, React:
  changes that are not saved.", Keep it, and going down into the line again
  shows the typing; then Delete it, and the row and its level are gone.
  *A held row deleted in another layout names its level, and takes it* --
  the same from Side by side's section grid, then Drill down shows no level
  for the deleted line. Both watched failing before this record: the
  guard's question came first, and no confirmation was there to find.
  `apps/host/src/delete.test.tsx`'s confirmation cases, which hold the open
  record's list of forms, run unchanged. **Not mechanically enforced:**
  that no other way to delete a record a level holds goes round the
  confirmation; every row and detail Delete on the page asks through
  `useDeleteFlow`, held by review.

## Context

0090 decided that a record a Drill down level holds, deleted from a grid
in any layout, "asks about that level and the levels below first, and once
gone takes them with it". It asked through the unsaved-changes guard,
before the delete's own confirmation (0053): Discard and continue dropped
the levels' typing at once, and only then asked "Delete …?". A person who
then pressed Keep it had lost the typing for a delete they did not make.
The final review of 0090 found it, and it was deferred.

The open record's own Delete already did it the other way: its
confirmation lists the record's forms that hold work -- "Unsaved changes in
these forms are discarded with it:" -- and nothing is dropped until the
record is gone (0053, `apps/host/src/delete-flow.ts`).

## Decision

**A row's Delete lists the levels that hold its record in its
confirmation, as the open record's lists its forms.** `HeldLevels.atRisk`
(`apps/host/src/use-drill.ts`) names the forms of the level that holds the
record, and of every level below it, that hold work -- leave.ts's
`drill-delete` request, through the guard's registry (`formsAtRisk`,
`apps/host/src/guard.ts`) -- and `useDeleteFlow`'s `held` option adds them
to what the confirmation lists. Keep it changes nothing. Delete it is
checked again first: a form typed into since is named before anything is
sent, as for the open record. The levels go only once the record is gone,
through `recordGone`, as before.

## Consequences

**What it buys.** One question for one delete, in the place the person
asked it, and typing kept until the record it belongs to is gone.

**What it costs.** The guard's notice no longer stands between a row's
Delete and the levels below, so a deletion still out when the person goes
down into that row and types there takes the new typing with it once it
is done, without a word -- as it did before this record after Discard and
continue. A delete the server refuses leaves the levels and their typing
where they were.

## Alternatives considered

- **Keep the guard's question, and drop the levels only after the
  delete.** Discard and continue would then not discard, which is the
  guard's one promise everywhere else on the page.
- **The confirmation first, then the guard's question.** Two questions for
  one delete, and the second appears after the person already said Delete
  it.
