# 0142 — A record's child forms are tabs beside it

- **Status:** accepted
- **Date:** 2026-11-05
- **Deciders:** Daniel Bacher
- **Verified by:** `apps/host/src/tabs.test.ts` -- a record's tabs are
  every child the menu names but its sections, in the menu's order, each
  keeping its place in the menu's list (watched failing with the sections
  given a tab of their own), none where every child is a section (watched
  failing the same way); a form reached twice is named by the field it is
  reached through, as its heading is (watched failing with the field never
  said); Right and Left go round the ends (watched failing with the ends a
  stop), Home and End reach them (watched failing with neither handled),
  and every other key is left alone (watched failing with Down taken for
  Right). `apps/host/src/tab-list.test.tsx`, the pattern in jsdom -- an
  arrow selects the tab it reaches, with the keyboard on it (watched
  failing with the arrows moving the keyboard alone); the row is one Tab
  stop, from which Tab goes into the panel shown (watched failing with
  every tab a stop, and with the panel taking no keyboard); a panel is
  drawn the first time its tab is shown and kept with its typing while
  another is (watched failing with a panel drawn only while shown, and
  with every panel drawn at once); another record starts again on the
  first tab with no other panel drawn (watched failing with `start`
  ignored); one tab draws no row (watched failing with a row of one tab);
  a panel's `show` selects its tab and says it was hidden (watched
  failing with `show` selecting nothing); and axe and a name on every tab
  and panel (watched failing with the panels unnamed). Neither file needs
  a database, but every host file runs under the suite's `globalSetup`,
  which starts both: they were run and watched failing under a copy of
  `apps/host/vitest.config.ts` without it, which was not kept.
  `apps/host/src/grid-sizing.test.ts`, run and watched failing the same
  way -- a first page, a refit and columns shown while nothing was listed
  are owed while the grid is hidden and made once it is shown (watched
  failing with the size made while hidden, as before); a later page, or a
  resize with nothing owed, sizes nothing (watched failing with a later
  page sized again, with every resize sizing, and with a size owed paid
  while still hidden); nothing is sized with no rows (watched failing with
  that check gone); and a well is hidden under any hidden element (watched
  failing with the well's own attribute read alone).
  `apps/host/src/record-tabs.test.tsx`, on both engines against the real
  server -- an order's own tab first and shown, then a tab per child form
  in the menu's order, no child's grid drawn nor its page asked until its
  tab is shown, and the floor passed (watched failing in CI with
  every panel drawn as the record opens); the arrows select a tab, Tab
  goes into its panel, and a tab left keeps a line open on its rail with
  its typing and its row marked, asking nothing (watched failing in
  CI with the arrows moving the keyboard alone); another record opens on
  its own tab (watched failing in CI with the selection kept for
  another record); a party whose one child is a section of it draws no
  tabs (watched failing in CI with a section given a tab); a Drill
  down level's children are tabs of its own, each level keeping its tab
  while the person goes up and down again (watched failing in CI
  with a level drawing its sections under its panes, as before); and, on
  SQL Server, a line's delete answered with "Not deleted" while the
  order's tab is shown shows the lines' tab again with the keyboard on
  the question (watched failing in CI with a section's `onShow`
  showing its view alone); in each, a line's save refused as stale while
  the order's tab is shown shows the lines' tab with the keyboard on its
  notice (watched failing in CI with a pane's notice focused where
  it is, its tab hidden); and typing in a line on the lines' tab is named
  by the guard when another order opens from the order's tab (watched failing in CI with the guard counting the forms of the tab
  shown alone) -- eight breaks chosen so that each fails its own case and
  no other. The suites that reach a child section --
  `children.test.tsx`, `drill.test.tsx`, `delete.test.tsx`,
  `delete-rows.test.tsx`, `export.test.tsx`, `filter.test.tsx`,
  `columns-panel.test.tsx`, `remembered.test.tsx`, `view-picker.test.tsx`,
  `leaving.test.tsx`, `races.test.tsx`, `unknown-child.test.tsx`,
  `open-lookup.test.tsx`, `page.test.tsx` and `plane.test.tsx` -- now
  press its tab first (`showChild` in `test-host.tsx`); `page.test.tsx`
  holds the row and the lines' panel to the floor and checks the record's
  tab selected again after a Load, and `children.test.tsx` and
  `drill.test.tsx` read the floor in every tab, axe reading only the panel
  shown. The browser gate's `demo.mjs`, `exporting.mjs`, `drilling.mjs` and
  `workspace.mjs` press it in Chromium, Firefox and WebKit, measuring the
  record's tab and each child's in the states they reach for reflow down
  to 320 pixels, target size and contrast, and no rule of
  `styles/tabs.css` reaching the paper (not watched failing: pressing a
  tab is what they now do to reach a section); and `drilling.mjs` holds a
  customer's orders until their tab is hidden again, lets the page land
  there, shows the tab and finds no cell of it cut (watched failing
  in CI with the size made while hidden, as before). The page cases
  were watched failing on both engines in one run of their eight breaks,
  and the gate check in all three browsers in a run of its own, each
  since reverted.

## Context

Since [0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md)
the open record's child forms are drawn below it, a section each with its
grid, its rail and its own forms, and a section of the record
([0109](0109-a-form-whose-key-is-its-parents-is-a-section-of-the-parents-record.md))
among them as its one row. An order with lines and deliveries is its form
and two grids under it, and an employee its form and three: a person
scrolls past every child to reach the one they want, and every child's
grid asks the server for its first page as the record opens, looked at or
not. Drill down's levels
([0090](0090-a-hosts-workspace-can-drill-down-one-level-at-a-time-with-a-trail-back.md))
draw their own children the same way, through the same section.

The design of finding records put the record and its children in tabs
below the grid: the record, one tab per foreign key with a record to show,
and one per child form. [0141](0141-a-lookups-record-opens-below-the-record.md)
then opened a lookup's record a Drill down level below, which holds
another form's record with its sessions, the unsaved-changes guard and a
trail back, so a foreign key needs no tab to show it.

## Decision

**Where a record has a child the menu names that is not a section of it,
the record and its children are one tablist under the record's header**,
as WAI-ARIA's tabs pattern has it, named by the record's heading
(`apps/host/src/record-tabs.tsx`, `tab-list.tsx`, `tabs.ts`). The first
tab is the record's own, named as its heading names it -- "Order k1:4711",
"New record" -- holding its form in the renderers chosen and its sections
(0109), which are part of it; then one tab per other child, in the menu's
order, named as its section's heading names it -- "Order line", "Order,
Approved by". The header -- the heading, Go to its row, Duplicate record,
Change from a date, Delete record, the status line, the renderer switch and
Open by record token -- stays above the tabs, whichever is shown. A record
with no such child -- none at all, or only sections of it -- draws no
tablist, as before; nor does the detail with no record open.

**Keyboard first, activation automatic.** The tab shown is the row's one
Tab stop; Left and Right move round the row and Home and End to its ends,
each selecting the tab it reaches; Tab goes on into the panel shown, which
takes the keyboard itself, as the pattern's example does, and Shift+Tab
comes back to the tab.

**A panel is drawn the first time its tab is shown, and kept after**,
hidden: a child's grid asks for its first page the first time its tab is
shown -- an arrow passing over a tab shows it -- and keeps its page,
cursor, sort, filter and open row, a child row on its rail and the typing
in it, while another tab is shown. A tab shown again asks nothing;
changing tabs drops nothing, so it asks the unsaved-changes guard nothing.

**A grid sizes its columns where it is drawn** (`apps/host/src/grid-sizing.ts`,
`use-grid-sizing.ts`). AG Grid measures a cell in a hidden panel as
nothing, so a grid sized there would keep its headers' least widths: one
whose first page lands, or whose separator is let go, while its tab is
hidden owes the size, and makes it when its well is drawn again. Hidden
means under an element the page hides by its `hidden` attribute -- a tab's
panel, a view of Separate views, a Drill down level -- which is read from
the document rather than measured, since jsdom measures every box as
empty.

**Another record starts again on its own tab**, with no other panel drawn
until its tab is shown: any record the detail is given -- a row opened,
Load, New record, Duplicate record, Change from a date, the record read
again after its delete was refused, a record its first save created.
Saving, deleting and a child's own Drill down behave as before. What
takes the keyboard in a tab another hides shows that tab first, as
Separate views shows the record view for a deletion: a section's deletion
that asks something, a save refused in one of its panes -- its notice, or
the renderer's summary of a refused answer -- and a child row opened by
Enter, or New, whose answer lands while another tab is shown.

**A Drill down level is drawn the same way**: its record's own tab and a
tab per child of its form, through the same component, each level keeping
its own selection while the person goes up and comes down again.

**A foreign key has no tab.** Its record opens a Drill down level below
the record, from under its field (0141).

The row is host chrome, in `apps/host/src/styles/tabs.css`, in the room's
variables as the Forms list and the Layout group are; no rule of it selects
inside a paper or a grid.

## Consequences

**What it buys.** A record's children are one press away and never a
scroll, each named in one row a keyboard crosses with the arrows; a child
whose tab is never shown asks nothing of the server; and a child row's
work survives a look at the record's form.

**What it costs.**
- A child's rows are no longer on screen with the record's form: an order's
  lines are one press away, and a person going through orders' lines
  presses that tab for each, since another record opens on its own tab.
- A record its first save created is another record by that rule: a person
  who moved to a child's tab while the save was out is taken back to the
  record's own. New record pressed again, over a new record, starts again
  too.
- A child's grid asks for its first page when its tab is first shown, so
  the wait moves from the record's opening to the press, and arrowing
  across the row to its last tab asks every child passed over for its
  page; a tab shown keeps its grid and forms in the page's memory, hidden,
  until another record opens.
- What only says something is not heard in a tab another hides: a save's
  "Saved." and a delete's "Deleted …" said there wait in its panel. Only
  what asks something of the person shows its tab.
- Each panel is a Tab stop of its own, as the pattern's example has it:
  from the record's tab, Tab stops on its panel before the first field of
  its form, one stop more than before, the tab itself another.
- A child's panel holds its section as before, heading included: a screen
  reader hears its name as the tab's, then as the panel's, then as the
  heading's. The heading is kept: it names the grid and is where the
  keyboard goes once a row there is deleted.
- A level's section heading, where the keyboard goes once a row the level
  below held is deleted there, is hidden when the person showed another
  tab of that level and came back down by Back or Forward; the keyboard is
  then left on nothing.
- A foreign key's record is never a tab: to look at it beside the record,
  a person opens it a level below and goes back up.
- The tabs are the host page's; a host with a page of its own draws its
  own from the menu's children.

**What it forecloses.** Nothing: the order of the tabs is the menu's, which
a later decision can change without changing the pattern.

## Alternatives considered

**A tab per foreign key too, as the design had it.** Open under a lookup
goes a level below (0141), into a level that holds the record with its own
sessions, the guard and a trail back; a tab would draw the same record a
second way, with a second set of those to keep in step.

**Manual activation**: the arrows moving the keyboard alone, Enter or Space
selecting. The pattern recommends automatic activation where a panel is
shown without a noticeable wait; a panel shown before is shown at once, and
one shown first asks one page. Manual, every change of tab is two keys, and
the tab with the keyboard says one thing while the panel shown says another.

**Every panel drawn as the record opens, hidden.** Every child's first page
asked with every record, as the sections below the record asked it, now
for grids nobody looks at.

**A panel drawn only while its tab is shown.** A child row's typing would be
dropped by a look at the record's form, or asked about first: a question
for looking.

**The tab kept for another record.** A person going through orders' lines
would stay on the lines; but the next order would open on a tab the person
chose for another, its form hidden where Enter on a row puts the keyboard
on its heading.

**The header inside the record's tab.** Delete record, the status line and
the renderer switch would go with a child's tab shown, and the record's
heading -- where Enter on a row and New record put the keyboard -- would be
hidden.

**Drill down's levels left as they were.** The level's record and children
are drawn by the same component as the open record's; a level drawn apart
would look unlike the record above it.
