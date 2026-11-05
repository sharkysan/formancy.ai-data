# 0141 — A lookup's record opens below the record

- **Status:** accepted
- **Date:** 2026-11-05
- **Deciders:** Daniel Bacher
- **Verified by:** `apps/host/src/lookup-opens.test.ts` -- a lookup offers
  one Open per form the server names for it, carrying its answer; where
  two forms share a title each says its form's id (watched failing with
  the title alone); an empty answer, or one that is no token, offers none
  (watched failing with the answer unchecked), and so does a field no form
  is named for; a read refused as no such record says the form does not
  show it, and anything else is the server's sentence (watched failing
  with the server's sentence passed through).
  `apps/host/src/lookup-addition.test.tsx`, around each renderer -- the
  Opens are drawn through the field addition under the lookup alone, on
  the answer the engine holds now, and go when it is emptied (watched
  failing in React and in Angular with the addition not given to the
  renderer's form); a press hands the page the field, the form, the token
  and the button pressed (watched failing in each with the press handed
  nowhere). `apps/host/src/open-lookup.test.tsx`, on both engines against
  the real server -- in React and in Angular, a line's order opens below
  the line in either order form, from Side by side, which becomes Drill
  down, the trail naming both and leading back up to the line's typing
  (to be watched failing in CI with the record's panes given no offer, and
  with Open from another layout left in it); in each, an empty lookup
  offers nothing and passes axe, and the order picked for a new line,
  unsaved, is the one that opens (to be watched failing in CI with the
  answer unchecked in `openChoices`); a refused read stays on the record,
  in its layout, the keyboard on the Open, its line saying the form does
  not show the record (to be watched failing in CI with the refusal
  unsaid); and Open again shows the level below as it was, while another
  form asks about its typing first (to be watched failing in CI with the
  level below read again whatever it holds). That file needs Docker,
  which the machine it was written on could not run, so its failures are
  CI's to watch.

## Context

A form names, under each lookup, the forms the person may read its record
in ([0140](0140-a-form-names-the-forms-each-lookups-record-opens-in.md)).
The design of finding records put Open in a strip above the form and the
record it opens in a tab of its own, because the paper had nowhere under a
field to hold it: the host's browser gate fails any rule of the page's own
that reaches the paper. formancy 0.13.0 added that place, the field
addition, dressed by every theme
([formancy.ai 0233](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0233-a-host-may-add-content-under-a-field.md)).
The record's tabs are not built yet. Drill down's levels already hold
another form's record below the open one, with its own sessions, the
unsaved-changes guard and a trail back up
([0090](0090-a-hosts-workspace-can-drill-down-one-level-at-a-time-with-a-trail-back.md)).

## Decision

**Under each lookup of a record, one Open per form the server names for
it,** drawn by both renderers through the field addition, on the answer the
field holds now: the engine's, so a customer picked and not yet saved is
the one offered. "Open in Customers"; where two of the forms share a title,
each says its id too, "Open in Order (pg-order)", as the Forms list names
every form. Nothing where the answer is empty or no form is named. The
theme dresses the buttons; the page adds no rule inside the paper. The
record and every Drill down level offer it; a child row on a section's
rail and a section of the record
([0109](0109-a-form-whose-key-is-its-parents-is-a-section-of-the-parents-record.md))
do not.

**Open goes one Drill down level below the record it was pressed on**, into
the record the answer names, in the form chosen: the form's definition and
the record, read by the answer as its token, asked side by side as Open is
pressed. The level is a child row's level without the parent: its heading,
status line, Delete where its form offers it, its form in the renderers
chosen with no field preset, the child sections the menu names for its
form, and Open under its own lookups. From another layout the layout
becomes Drill down, the entry written over at the record, and the level is
an entry of its own, so Back goes up a level as in Drill down. The trail
names the level as it names any (0090); going up keeps it, and the same
Open again shows it as it was, typing kept. Another record, or the same
one in another form, replaces the levels below through the guard, as going
down from a section does -- the guard's `drill` request, whose notice says
"Opening k1:4711 closes these forms:".

**A refused read stays where it was**, in its layout, the keyboard on the
Open, and the record's line says why: a record the server does not find --
gone since, or outside the form's row filters, which it answers the same
-- as "Order does not show you this record."; anything else in the
server's words.

## Consequences

**What it buys.** A person on an order line opens its order -- in the form
over orders that they choose -- without leaving the line, and goes back up
to it as they left it.

**What it costs.**
- Open from Side by side, Stacked or Separate views leaves that layout for
  Drill down, and Back goes up the levels rather than back to the layout
  chosen, which the Layout group gives back.
- Each Open asks the form's definition beside the read -- two requests --
  and a definition reads every published bundle (0140); nothing is cached.
- A record open at one level and opened again a level below, through a
  lookup, is two panes with their own sessions: a save in one makes the
  other's next save stale (0029), which says so and offers the stored
  record.
- A level's save renames its crumb, but the lookup above still shows the
  label it was read with -- a customer renamed below shows its old name on
  the order -- until the record above is read again; no grid above lists
  the level's record to refresh.
- A child row on a rail and a section of the record offer no Open: only
  the record and the Drill down levels do.
- Where two forms share a title, the buttons say their ids, which name the
  form for an administrator more than for the person.
- A lookup drawn disabled -- a child row's parent field -- still offers
  Open, which opens the record of the level above again, a level further
  down.
- The Opens are the page's, drawn into the renderers' field addition; a
  host with a page of its own draws its own from `opens`.

**What it forecloses.** Nothing: the record's tabs, when they come, can
show the same level.

## Alternatives considered

**The record in the lookup's tab, as the design named it.** The tabs do not
exist yet, and a tab would need what a level already has -- sessions, the
guard, a way back -- built a second time. The level is what a tab can hold.

**Navigating to the other form**, the record open there. The person leaves
the record they came from: its typing is asked about and discarded, and
the way back is the menu and a search.

**Open in a strip above the form**, the design's place before formancy
0.13.0. The strip was there because the paper had no place under a field;
Open beside the field whose record it opens is where a person looks for
it.

**Open only in Drill down.** The layout a person arrives in on a wide
window, Side by side, would offer nothing, and a lookup would open its
record only for a person who had found the fourth layout first.

**One Open per lookup, its form chosen by a rule.** Two forms over one
table are both the person's to choose between (0140).
