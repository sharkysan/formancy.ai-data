# 0090 — A host's workspace can drill down one level at a time, with a trail back

- **Status:** accepted
- **Date:** 2026-10-21
- **Deciders:** Daniel Bacher
- **Verified by:**
  `apps/host/src/drill.test.tsx`, on both engines against the real server:
  an order's line opened from the order goes down a level, not onto a rail,
  and the trail's crumbs go back up with the keyboard on the level's
  heading; a click and Space go down as Enter does; a read the server
  refuses stays on the section and says why; a read answered after the
  person went up is dropped; three levels below an employee, the trail
  names each, an employee by its name and an order and a line by their
  tokens; an employee under an employee under an employee mints no element
  id twice and passes axe; a crumb keeps the levels below, and the same row
  shows them as they were, typing included; another row asks first when a
  level below holds work, naming it, and so does another record at level
  1; a new row is named new until its save names it by what was stored;
  another layout keeps the levels below, and Drill down returns to the one
  left; Back onto a level that is gone shows the deepest one held; every
  level passes axe with a name on every control; on a phone the trail
  draws its ends and a button that draws the rest, leaving the keyboard on
  the first crumb it drew. On SQL Server, where an order line can be
  deleted (0050): a delete at level 2 goes to level 1, its section saying
  the row is gone; the held row's Delete in the grid asks about the levels
  below first; a delete answered after the person went up moves nothing;
  and a delete at level 1 takes every level below with it. Each case was
  watched failing with the rule it holds broken, one at a time: the
  same-row shortcut removed, going down discarding nothing, the record
  sparing the levels, Back's clamp removed, the levels unmounted in other
  layouts, a level's sections given level 1's ids, the record named by its
  token, a save naming nothing, a deleted level kept, the held row deleted
  without asking, the record's delete keeping its levels, the level above
  shown whenever a level went, the crumbs' text left out; and the phone's
  button, pressed, first left the keyboard on the page.
  `apps/host/src/layout.test.ts` — `level` is written only in Drill down's
  record view, read as a whole number from one, and never where a person
  arrives. `apps/host/src/leave.test.ts` — every owner says its level, and
  going down drops every level below and nothing at or above it.
  `apps/host/src/crumbs.test.ts` — a crumb's name is the first required
  plain text field that is not the parent, a lookup or a select.
  `apps/host/src/address.test.tsx` — Back and Forward move between Drill
  down's levels, and a typed level is written over.
  The host's browser gate, `apps/host/scripts/browser/drilling.mjs`, in
  Chromium, Firefox and WebKit: a customer, its order and that order's
  line, the trail by Tab and Enter, the browser's own Back, and on a phone
  the trail's ends and a button for the rest, with axe's contrast and
  target-size rules and nothing past either edge down to 320 pixels.

## Context

The host page's workspace
([0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md))
shows a form's records, the open record's form and, under it, a section
per child form the menu names
([0045](0045-the-runtime-plane-lists-the-forms-a-person-may-read-and-nothing-about-the-others.md)),
each a grid of that record's child rows; a child row opens on a rail below
its grid. That is one level: from a customer a person reaches its orders,
and to see an order's lines they go to the order form in the menu and find
the order again.

The maintainer asked for a master-detail view with a breadcrumb trail and
navigation, as an option beside the three layouts there are.

## Decision

**A fourth layout, Drill down, shows the open form one level at a time.**
Level 0 is its records, level 1 the record with its child sections, and
each level below a child row of the level above, opened from one of that
level's sections: its form, with the parent's field preset and drawn
disabled, and the sections the menu names for its own form. In Drill down
every way a grid opens a row goes down a level -- a click, Space and
Enter -- and so does a section's New; a section's rail is not drawn. A
form that is its own child drills as deep as its rows go.

**A trail names every level down to the one shown.** Each crumb above is a
button, since no level has an address of its own; the one shown is text,
`aria-current="page"`. A record's crumb is its form's title and its name:
the first field, in the form's order, that is required plain text -- no
pattern, no format, neither a lookup nor a select -- and is not the
level's parent field; otherwise its token, which names any record. The
name is read from what is stored, when the level opens and after each
save, never from typing. On a phone, past three crumbs, the trail draws the
first, a button that draws the rest, and the last two.

**The levels are in memory, and stay mounted.** Going up -- a crumb or
Back -- only changes which level is shown, and drops nothing. Going down
into the row the level below holds shows it again as it was; into any
other, or a New, the levels below are replaced through the unsaved-changes
guard, which asks when one of them holds work and names it. What replaces
the record at level 1 replaces every level under it, as it replaces the
child sections. Every level's panes, sections and deletions are owned
under its number (`apps/host/src/leave.ts`), so the guard drops a level
with every level above it, and no element id is minted twice.

**The address says the level, never a record.** Going down and pressing a
crumb push an entry, `#form=…&layout=drill&view=record&level=<n>`, and
Back and Forward move between the levels held, as they move between
Separate views' views. An entry asking for a level no longer held shows
the deepest one above it and is written over to say so. A reload, a
shared link or a typed address with a level arrives on the records, as
every layout does
([0023](0023-the-audit-trail-is-operational-not-evidence.md): a record token spells its key).

**Delete at a level goes to the level above**, replacing the entry, its
section's grid saying the row is gone and the keyboard on that section's
heading, the levels below with it. The row a level below holds, deleted
from its grid, asks about the levels below first.

**The other layouts are unchanged.** Another layout shows level 1 as it
always did; the levels below stay mounted and hidden, their work still the
guard's, and Drill down again shows the level the person left, while it is
held.

## Consequences

**What it buys.** A visitor of the live demo goes customer → order →
delivery or order line and back, by the trail, by Back, and by keyboard
alone, on a phone too, without losing typing they did not choose to lose.

**What it costs.** The levels are in memory only: a reload, or a link sent
to someone, opens the records, and the path down has to be walked again.
One Back after a delete at a level can show nothing new, since the entry it
lands on was the level the delete replaced. A row open on a section's rail
in another layout and the same row opened a level down in Drill down are
two panes with their own sessions, so typing in one is not in the other,
and the guard names both. A crumb's name comes from a rule over the form's
fields, which can name a record by a field a person would not have chosen,
and names it by its token when no field qualifies. On a phone the four
layouts take two rows. The host's other layouts open a child row on a rail
one level deep, as before: Drill down is the one way past it.

**What it does not do.** It changes nothing in the server, the client or a
published form: the host page asks the runtime plane what it always
asked, each level's grid is its own form's list under its own policy, and
a child the server does not list for the person is left out at every
level.

## Alternatives considered

- **The levels in the address.** A deep link would reopen the path, but
  the path is a record at every level, and a record token spells its key;
  the address goes into the history a browser may sync (0047, 0023).
- **A rail inside a rail.** Each child row would open its children's
  sections on its own rail, under the one above. Past two levels the page
  is a staircase of nested panels, and a phone has no width to give it.
- **The child form opened on its own, filtered by the parent.** The menu
  already opens an order line on its own; what is lost is the parent the
  person came from, and the way back to it.
