# 0097 — Back goes on past the open form's own entries in every layout

- **Status:** accepted; amends [0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md)'s address and [0090](0090-a-hosts-workspace-can-drill-down-one-level-at-a-time-with-a-trail-back.md)'s entries popped in another layout
- **Date:** 2026-10-22
- **Deciders:** Daniel Bacher
- **Verified by:**
  `apps/host/src/address.test.tsx`, on both engines against the real
  server. *Back in another layout goes past Drill down's levels to the form
  before* -- the order line form chosen, then the order form, Drill down,
  a record opened, Stacked chosen: one Back lands on the order form's
  first entry, which now says Stacked, and the next opens the order line
  form (watched failing before this record: the page went forward again
  after each Back, and the order line form never came back). *Back and
  Forward move between the views of Separate views* and *… the levels of
  Drill down*, whose last steps now hold that Back after Stacked lands one
  entry back and the page stays in Stacked. **Not mechanically enforced:**
  that nothing else writes an entry of the open form the layouts read
  differently; each new kind of entry is a case for this file, held by
  review.

## Context

The page pushes an entry when a form is chosen, when Separate views
changes its view, and when Drill down changes its level; a layout chosen
replaces the entry it is on (0047, 0090). So the entries behind the one
the person is on can ask for a view or a level that the layout now shown
does not move between: Separate views' record view, seen from Stacked, or
Drill down's level 2, seen from Side by side.

Such an entry was answered as an address the page did not write: the page
went forward again to its own entry (`restore` in
`apps/host/src/address.ts`). That keeps the history as it was, which is
why 0047 chose it for an address typed or left by an earlier sign-in. For
the open form's own entries it meant every Back came back to where it
started: in Stacked after any Separate views or Drill down navigation of
the same form, the person could not leave the form by Back at all. Found
after 0090 and deferred; Separate views had it since 0047.

## Decision

**An entry of the open form that the page itself wrote, and that no layout
rule moves to, is taken over: it becomes the page's entry, written over
with what the page shows.** One Back lands on it and stays; the next goes
on to the entry before. An entry of another form still goes through the
guard; an entry the page did not write, or an earlier sign-in's, is still
answered by going forward again or written over in place, as 0047 says;
and Separate views' views and Drill down's levels still move as before.

## Consequences

**What it buys.** Back always moves, one entry a press, and leaves the
form after its entries, in every layout.

**What it costs.** A Back that lands on such an entry shows nothing new:
the person presses Back once for each view or level change made in the
other layout, and those entries are rewritten to the layout shown, so
Forward over them no longer brings back the view or level they asked for.

## Alternatives considered

- **Go back again by itself until an entry means something.** It skips
  the entries in one press, but the page would move the history on its
  own across entries it cannot see, and a guard question on the way would
  land wherever the skipping stopped.
- **Change the layout back to the entry's.** Back would undo a layout the
  person chose, which the page otherwise never does.
