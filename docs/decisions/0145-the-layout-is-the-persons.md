# 0145 — The layout is the person's: Stacked first, its height shared by a line they move, and the layout they chose kept

- **Status:** accepted; extends [0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md): Stacked draws a line of its own between the records and the record, a window with nothing kept arrives in Stacked rather than Side by side, and the layout a person chooses is kept in their browser; extends [0090](0090-a-hosts-workspace-can-drill-down-one-level-at-a-time-with-a-trail-back.md): Drill down chosen in the Layout group is kept as any layout is, and Drill down entered by a lookup's Open is not
- **Date:** 2026-11-06
- **Deciders:** Daniel Bacher
- **Verified by:** `apps/host/src/prefs.test.ts` -- Side by side's split
  through the axis it now shares, its numbers as before: 55 until moved,
  its limits from the lanes' width, every arrow, Home and End; Stacked's
  line 60 until moved and kept under its own key (watched failing with
  both read from the split's key: the line came back at Side by side's
  62); its limits from the window's height, the records at least 18rem
  and the record 12rem, 32 to 75 in a 900-pixel window, the outer bounds
  with no height (watched failing with the width's leasts: 36 to 57); no
  line where the window leaves it no room to move, 480 pixels or fewer,
  while Side by side's split keeps its pinned default (watched failing
  with the limits given whatever the window: 60 to 60 at 480 pixels);
  moved by Up and Down, Home and End, and not by Left and Right (watched
  failing with Side by side's keys for both: ArrowLeft moved the line
  up); a line in Side by side and in Stacked and none in Separate views or
  Drill down (watched failing with a line for every layout); the layout
  kept as nothing until one is chosen (watched failing with the default
  written in place of nothing) and a value it does not know ignored
  (watched failing with the value taken as written); and all of it with
  storage that throws. `apps/host/src/layout.test.ts` -- arriving with
  nothing asked and nothing kept, Stacked, and Separate views on a phone
  (watched failing with Side by side kept as the default); with a layout
  kept, that one, on a phone too, and the fragment's over it (watched
  failing with the kept layout unread, and with it read over the
  fragment's). `apps/host/src/split.test.tsx` -- Stacked's line a
  horizontal separator named by the records, its value said as the
  records' share of the window's height, Down moving it and Left and Right
  not (watched failing with the line given the split's orientation, with
  the split's keys, and with the split's words, "the record 40%"); dragged
  as far as the pointer moves, as a share of the window's height, from
  where the drag began (watched failing with the split's reading, across
  the lanes' width: the drag left the line at 60; and with the share read
  from the lanes' top: 40 became 53); each line controlling the Records
  panel (watched failing with `aria-controls` left off both); a share of
  75 kept in a 900-pixel window moved to 70 as the window is made 640
  (watched failing with the share drawn as kept, unclamped, and with the
  `resize` unheard: 75 both times); no line in a 390-pixel window, and the
  line back at 900 (watched failing with the line drawn pinned at 60); and
  a `resize` that leaves the height as it was rendering nothing again
  (watched failing with the height kept as a new object at each `resize`:
  a render each). None of the three needs a database, but every host file
  runs under the suite's `globalSetup`, which starts both: they were run
  and watched failing under a copy of `apps/host/vitest.config.ts` without
  it, which was not kept. On both engines against the real server, passing
  in CI on b15fcef and to be watched failing there under a temporary commit
  of breaks: `apps/host/src/choices.test.tsx` -- the split's case, which
  now chooses Side by side first, its numbers unchanged, with Stacked's
  line still at 60 after the split was moved to 30, on the same page and
  opened again (with one share moved for both lines); Stacked's line where
  a person arrives, 60 until moved, Up and Down a step, Left and Right
  nothing, Home and End to the outer bounds jsdom gives, kept under its own
  key and not the split's, the keyboard left on it (with the split's keys
  for both lines); and the layout chosen last opened on arrival, Drill
  down chosen in the Layout group among them, an address that names one
  winning and leaving the kept one as it was (with the kept layout unread
  on arrival). `apps/host/src/open-lookup.test.tsx` -- Open under a lookup
  into Drill down keeps no layout, and the next arrival is Stacked (with
  `chose` ignored in `changeLayout`, every layout the page moves to kept).
  Each break fails its own case and no other page case. Changed to the new
  arrival and not watched failing on their own: six addresses in
  `address.test.tsx` and one in `races.test.tsx` that say `layout=stacked`
  where a person arrived with none -- one of them, a typed address, found
  failing on both engines in CI run 42169508975, since another form opened
  by a typed address keeps the page's layout -- and a refused Open in
  `open-lookup.test.tsx` that leaves the person in Stacked. The browser
  gate, in Chromium, Firefox and WebKit, passing in all three on b15fcef:
  `apps/host/scripts/browser/stacked.mjs`'s "Records, stacked" at every
  width it measures, 320 pixels among them, in which a wide window arrives
  in Stacked and a phone in Separate views, the line is drawn across, Down
  moves it a step and Home and End to its limits with the keyboard staying
  on it, its focus ring is painted over the record's glass -- one pixel
  inside the ring, past its offset, read from a screenshot against the
  outline's colour at 1.1:1 or less -- the Records panel is as tall as it
  says of the window's height, and a pointer drags it within its limits
  and the share is kept; a pass of its own at 844 by 390 pixels, a phone on
  its side, in which Stacked draws no line and the Records panel is as
  tall as what it holds; and in `workspace.mjs`'s "Records, side by side",
  which now chooses Side by side before its checks, the split's focus ring
  read the same way. In every one, as in every state, nothing scrolls
  sideways or is past either edge and axe finds nothing, target size and
  contrast among it. Each ring check brings the keyboard onto its line by
  Tab and Shift+Tab, as a person moves it, and says so where no ring is
  drawn at all: first made on a focus moved by script, both failed in
  Firefox on CI (run 42172919769, painted 10.97:1), because a focus a
  script moves after a pointer's click matches no `:focus-visible` there,
  whatever key follows, where Chromium's matches once a key is pressed --
  a difference no step of the page leans on, so it is no fact of 0058's
  table. Watched on 2026-11-06 on a page of the host's built stylesheet in
  Playwright 1.63.0's Chromium and Firefox: 1:1 with the line raised, and
  10.88:1 and 5.96:1 with its `z-index` taken away; in CI, the rings with
  each line's `z-index` taken away and the short pass with the line drawn
  in a short window are to be watched failing.

## Context

Since [0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md)
the host page has had three layouts and, since
[0090](0090-a-hosts-workspace-can-drill-down-one-level-at-a-time-with-a-trail-back.md),
a fourth: Side by side, Stacked, Separate views and Drill down. A window
with no layout in its address arrives Side by side, a phone in Separate
views. Side by side has a separator the person drags or moves with the
keys of the ARIA window splitter, its share kept in their browser with the
renderer choice; Stacked has none, the grid's well capped at half the
window's height, and 30rem at most, whatever the person wants to see. The layout itself is
kept only in the address, so a person who prefers another one chooses it
again each time they open the page from a link or a bookmark without one.

The design of finding records (agreed with the user on 2026-11-04) puts
the tables on the left, the grid above and the record below, "Stacked",
as what a person sees first, with a line between grid and record that a
person drags -- and moves by keyboard, as formancy.ai's
[0046](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0046-keyboard-before-drag.md)
asks of every drag -- to share the height, and "Side by side" behind a
switch, the choice remembered per person in the browser, as a grid's
columns and sort already are
([0106](0106-a-hosts-grid-keeps-its-columns-sort-and-view-in-the-viewers-browser.md)).
It says nothing of phones, and leaves the line's keyboard steps and its
smallest heights to the builder.

## Decision

**Stacked shares its height by a line the person moves**
(`apps/host/src/split.tsx`). Between the Records panel and the record,
Stacked draws the same window splitter Side by side does, drawn across: a
focusable `separator`, horizontal, named by the records' heading and
controlling the Records panel, its primary pane, as Side by side's now
does too, its value the records' share of the window's height in
percent, with its limits and the words "Records 60% of the window's
height" -- not the record's share, which is what the page leaves it.
Down and Up move it a step of five, Home and End to its limits; Left and
Right are not its keys, as the window splitter pattern has them for a
horizontal one, while Side by side's split still answers all four arrows
as it always has. A pointer drags it, the share moved by as much of the
window's height as the pointer moves from where the drag began, rather than read from the lanes'
top, which is no fixed place while the panel's height changes under the
pointer and a browser may scroll to keep in view what it showed; a drag
the browser cancels keeps nothing, as before. The Records panel is
drawn that tall, `--records-height` in `svh`, the window's height with a
phone's toolbar shown, which is what `documentElement.clientHeight` --
read by the limits and a drag -- gives too, so the line and the panel go
by one height as the toolbar comes and goes (reasoned from CSS Values 4,
not measured on a phone); however few rows its page holds, its grid's
well fills what the toolbar leaves, and a panel shorter than its toolbar
and the grid's least scrolls inside itself, as Side by side's does. The record
follows below in the page's flow, so the page scrolls as it did. The
window's height is kept as a number, so a `resize` that changes nothing
-- a phone's toolbar, a screenshot of the whole page, which fires one --
renders nothing again.

**Each line is drawn over the glass, and in forced colours.** Each is a
2px border down or across its middle, which forced colours draw in their
own colour, and each is positioned above the panels beside it, whose
`backdrop-filter` makes them stacking contexts the document paints after
it, so its 2px focus ring at a 2px offset lies on top of their glass, not
under it.

**Neither part collapses.** The limits come from the window's height as
Side by side's come from the lanes' width (`shareLimits` in
`apps/host/src/prefs.ts`), inside the same outer bounds, 25 to 75: the
records at least 18rem -- their heading's row and the search's, the
grid's header, its row of boxes and a row, the panel's padding and gaps
-- and the record at least 12rem, the 7.5rem the app bar and the form's
header take above the lanes on a wide window with the line and the
record's heading's row below it. The panel is drawn at the share inside
those limits, so a share kept in a taller window is moved inside a
shorter one's as the window is resized. The default, 60, is where the two
leasts meet in the shortest window that holds both, 18rem of 30. None of
these heights is measured: they are summed from the stylesheets' own and
rounded up, on 2026-11-06.

**A window too short for the line to move has none** (`lineLimits`). In
one 488 pixels tall or less at 16 to the rem, about 30.5rem -- a phone on
its side at 844 by 390, a laptop at 200% -- the limits meet, rounded to
whole percents, and leave the line nowhere to go,
and a focusable separator whose keys and drag do nothing would be a Tab
stop that lies. Stacked there draws no line, and is as it was before this
decision: the Records panel as tall as what it holds, its grid's well
capped by its own `max-height`, as Side by side drawn stacked is; the line
comes back when the window is tall enough again.

**Each line keeps its own share**, under a key of its own
(`formancy-data-host.stack` beside Side by side's
`formancy-data-host.split`), so moving one never moves the other. Letting
go of either fits the grids' columns again to the rows shown then, as
Side by side's always has: in Stacked a taller well shows more rows.
Side by side's split otherwise does what it did -- its default, steps,
limits, keys and the narrow window that hides it -- now one of two axes
of one splitter rather than a splitter of its own.

**The layout the person chose is kept** (`formancy-data-host.layout`).
Choosing one in the Layout group keeps it, whichever of the four. An
arrival whose address names no layout opens in the one kept; an address
that names one -- a shared link, a bookmark, Back, a typed fragment --
wins and is not kept, so the kept one stays the person's until they
choose another in the group. Where nothing is kept: **Stacked** on every
window but a phone, as the design has a person see first, and Separate
views on a phone, as before (UX-SPEC D14). A layout kept wins over a
phone's start: it was chosen in this browser. Order and names in the
Layout group are as they were; Stacked is its second choice.

**Drill down is kept only when it is chosen.** Chosen in the Layout
group, it is kept as any layout is, and an arrival opens in its records,
since its levels are in memory only (0090). Entered by a lookup's Open
([0141](0141-a-lookups-record-opens-below-the-record.md)), which goes a
level below the record from any layout, it is where the record went, not
a layout the person chose: nothing is kept, and the next arrival opens in
the layout chosen before, or in Stacked.

It is host chrome, in `styles/workspace.css` and `styles/records.css`, in
the room's variables; no rule of it selects inside a paper or a grid.

## Consequences

**What it buys.** A person who arrives sees the records and the record
at once, and gives either more of the window with a key or a drag; one
who prefers Side by side, or Separate views on a large screen, chooses
it once and has it every time the page opens without a layout in its
address.

**What it costs.**
- In Stacked the Records panel is as tall as its share of the window
  even when its page holds two rows or none, the grid's well filled with
  the empty grid, where it was as tall as its rows.
- A panel shorter than its toolbar and the grid's least scrolls inside
  itself, as on a phone held upright or at the line's lowest share in a
  window just tall enough for the line, rather than the page growing to
  hold it.
- In a window about 30.5rem tall or less the height cannot be shared at all:
  Stacked has no line, and the Records panel is as tall as what it holds,
  its grid's well capped as before.
- The share is of the window's height, not of what is left below the app
  bar and the form's header, so the record's top can be below the window
  at the line's highest share; and in a window narrower than 80rem, where
  Forms is a band above main, the lanes start lower and the record's
  heading need not be in view below the line at all.
- The line takes the pointer on a phone too: a scroll begun with a finger
  on it moves the line instead.
- A share's limits and default are worked out from the stylesheets'
  heights, not measured, and do not follow a toolbar that wraps onto more
  rows.
- A person arriving with no layout in the address now sees Stacked where
  they saw Side by side, and the README's host pictures, taken in
  Stacked, change with it: the line between the records and the record,
  and the Records panel at its share.
- The layout, like the renderer choice and the shares, is kept in each
  viewer's browser: a shared machine keeps the last viewer's, and a
  desktop browser narrowed to a phone's width opens in the layout kept
  there, Side by side drawn stacked with its note.
- Drill down kept opens on its records, its levels gone, which is what
  Separate views' records look like with a trail of one.
- Side by side's split still draws a share kept in a wider window as kept,
  past a narrower one's limits, as it did; Stacked's is drawn inside them.

**What it forecloses.** Nothing: the limits, the steps, which layouts draw
a line and where an arrival opens are pure functions of `prefs.ts` and
`layout.ts`, which a later decision can change without changing the page.

## Alternatives considered

**Both parts in a box the window's height, each scrolling inside itself**,
as a desktop tool splits a pane. The record's paper would scroll in a box
of its own beside the page's scroll, two scrollbars on a phone, and a
long form's focused field would sit in an inner scroller the gate's
checks and a screen magnifier both have to find.

**The share as a cap on the Records panel**, as tall as its rows up to
the share. The line would sit at the panel's foot, not where the pointer
let it go, and its value would say a share the panel does not take.

**The share of the lanes' height.** In Stacked the lanes are as tall as
the record below them, which changes with every form and record, so the
same share would draw the records at a different height for each.

**Stacked's line pinned at its default in a short window**, as Side by
side's split is where its lanes are too narrow. It would be a Tab stop
whose keys and drag do nothing, over a Records panel of 60% of a window
that has no room for it.

**`dvh` for the panel's height**, as the stylesheets' other heights are.
The limits and a drag read `documentElement.clientHeight`, the small
viewport's height, so on a phone whose toolbar moves the line and the
panel would say two heights.

**Side by side's keys for Stacked's line.** Left and Right moving a line
drawn across is not what the window splitter pattern asks, and what a
person pressing Left in it expects is nothing.

**One splitter component for each layout.** Two components making the
same decisions -- the limits, the steps, a cancelled drag kept nowhere --
would be two places for them to disagree.

**A phone's start over the layout kept.** A person who chose Stacked on
their phone would be put in Separate views each time the page opened, and
the layout would be theirs everywhere but where they chose it.

**Drill down never kept**, or kept however it is reached. Never kept, a
person who works in Drill down chooses it every time; kept when Open goes
a level below, one press under a lookup would change where every later
arrival opens.

**Side by side as the default still.** The design has a person see
Stacked first, the grid above and the record below, and Side by side is
one choice away and then kept.

**Stacked moved first in the Layout group.** Its order is the one every
gate check, test and picture reads, and the default need not be first to
be checked on arrival.
