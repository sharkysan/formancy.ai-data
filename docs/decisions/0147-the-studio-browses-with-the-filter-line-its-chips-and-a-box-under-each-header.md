# 0147 — The studio browses with the filter line, its chips and a box under each header

- **Status:** accepted; extends [0099](0099-a-browse-role-reads-any-table-or-views-rows-as-the-connections-account-does.md): a browsed page's table has a row of filter boxes under its headers; extends [0104](0104-a-list-and-a-browse-are-filtered-by-conditions-on-their-columns.md): a browse's filter is typed as a line, said as chips and set in a column's box, and the Browse step's Filter rows panel is gone; amends [0132](0132-each-column-header-filters-its-column.md): a box's text is read with its field's name in the line in front, not its key
- **Date:** 2026-11-06
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/records/filter-header.test.ts`
  -- a box on a field whose key is not one word, `Order Date`, is read by
  the name the line calls it, `order_date`, its condition on that field
  (watched failing with the key put in front: "No field is called Order
  Date: it is order_date in the line.").
  `packages/data-core/src/records/filter-line.test.ts` -- `nameableFields`
  leaves out a field no one word says alone -- two whose labels give one
  name and whose keys are two words, two whose names differ only in case,
  one whose name is an operator -- and names the rest again over
  themselves (watched failing with a stub that kept every field).
  `filter-header.test.ts` also reads a host-shaped field -- a key unlike
  its label's name, `total` for "Order total", a field through a lookup,
  `customer.name`, and one labelled "And" -- to the terms the key in front
  read: with the key put back they pass, the two readers agreeing on every
  one-word key, which is the claim that nothing changes for a host field;
  watched failing with the label's name put in front without `lineNames`
  (`customer_name`, which names nothing) and with the label itself.
  `apps/studio/src/browse-line.test.tsx`, against the real server behind
  the fake `fetch` -- the host's `filter-line.test.tsx` case for case where
  a browse has what a case is about: a line applied as the terms it reads,
  in the body and in no URL; a line it cannot read said under it, every
  character and the caret kept, nothing sent; the server's refusal in the
  step's alert, the line kept; completion from the keyboard; `/` from the
  table, and Esc twice back to it; a chip removed and Undo, the keyboard
  on the next Remove, on the Remove put back and on Undo; Clear the filter
  and an emptied line, each with Undo; and the boxes -- applied with the
  line and the chips saying it, a refusal in the alert with the typing
  kept, Esc and leaving, a boolean's select, a column the line cannot name
  with no box -- the line following the filter however it was applied,
  and what is typed into the line or a box while the page it asked for is
  on its way kept (watched failing with both emptied of it once the page
  arrived). Its presses while a page is on its way, each watched failing
  against the step that dropped them: a second box left is sent after the
  first's page, its text kept (failing with it dropped, the box emptied
  and nothing said); a select stepped twice ends on its second value, in
  the select, the chips and the page, and one chosen during a sort is
  sorted too (failing with true sent, false dropped and the select saying
  false); Clear the filter clicked after typing in a box is sent after the
  box's page, and Undo puts both back (failing with the page more filtered
  than before); a box the server refused keeps the alert through a sort,
  marked invalid and described by it, sends nothing when left again, and
  is said no longer once changed (failing with the alert gone at the
  sort); a removal the server refused offers no Undo, and one pressed
  during a sort's page is sent after it and does (failing with it
  dropped). An input method's Enter and Esc are its own in the line and in
  a box (watched failing with each guard taken out). Each case was watched failing against the step before it had a
  line (no combobox named Filter, no box named Filter and a column); the
  first also with the fake records port reading no `above`, which listed
  the tenant whose limit is the bound itself (`apps/studio/src/test-server.ts`'s
  `holds` reads it now); the nameable case also with every filterable
  column given a box, and with data-core's box reader putting the key in
  front. `apps/studio/src/browse-filter.test.tsx` -- what each column is
  offered in the line and in its box, a column that offers nothing and one
  the studio has not discovered named nowhere, page one asked with the
  sort kept and paging and sorting keeping the filter, each condition sent
  as its column takes it, whole days at both midnights and after a day, a
  bare word a contains, a follow starting unfiltered with Back returning
  the filter in the line, the chips and the boxes and no Undo, and Show
  rows starting afresh -- each watched failing against the step before it
  had a line. `apps/studio/scripts/browser/browse.mjs`, in Chromium,
  Firefox and WebKit -- `/` from the grid onto the line, the completion
  open over the grid, a line applied by Enter with the keyboard kept, one
  it cannot read and one the server refuses each keeping what was typed,
  Esc putting back the filter and the keyboard on the grid, Tab from the
  last header onto the first box, a box applied by Enter with the keyboard
  kept and the line saying it, Esc giving its edit up, and a chip's
  Remove, the last one's and Undo each leaving the keyboard on what takes
  its place, every state measured for axe, contrast, target size and no
  sideways scroll down to 320 px; not run on the machine it was written
  on, and watched failing in CI by one break per check.

## Context

The host's grids are filtered by a line a person types (0131), a box
under each column's header (0132), and chips that say each condition,
and the panel that built a condition from menus is retired there (0134).
The studio's Browse step kept 0104's Filter rows: a disclosure holding a
form that adds one condition -- a column, an operator, a value, Apply --
and the conditions it applied listed under Filtered by, each with a
Remove. The design the user agreed on 2026-11-04 said the Browse step
adopts the line and the header boxes later, separately, from the same
filter language in data-core. A browse names columns, never a field
through a lookup (0139), and its table is a plain HTML table (0099), not
a grid library's.

## Decision

**The line, over the page's columns.** Above the table, an ARIA 1.2
combobox named Filter reads `country_code = CH and credit_limit > 125.50`
by data-core's `parseFilterLine`, over a field for each column the page
shows that `filterOffer` offers anything, from the studio's own
discovery (0104): keyed and labelled by the column's name, offered what
its column offers. The keys are the host's line's: completion at the
caret, ArrowDown and ArrowUp, Enter taking the option moved to and
otherwise applying, Esc closing completion and a second Esc putting back
what is applied and giving the keyboard to the table, `/` outside a text
box putting it on the line. A line it cannot read keeps every character
and the caret, marks what it is about and says why under it, sending
nothing. While the person is not editing it, the line shows the filter
the page was asked with, written by `printFilterLine`. What was typed
stays until the page it asked for has arrived, so a line the server
refuses is still there to correct, and what is typed on while it is on
its way is kept; the refusal is said in the step's alert, as every
refusal of the server's on the step is.

**Chips.** Under the line, each condition in the step's own words, the
status line's -- `credit_limit > 125.50`, `country_code is NULL`, a range
of days with the clock its days are on, `whole days in UTC` or `as
stored`, as the host's chips say it -- with a Remove named for it, then
Clear the filter. A chip removed, Clear the filter and the line emptied
offer Undo until the filter changes some other way, never on a timer
(WCAG 2.2.1). A removal puts the keyboard on the next Remove, or Undo
once none is left; Undo puts it on the Remove of the condition it put
back. Undo is offered in the render that shows the page the removal asked
for, so a removal the server refused offers nothing, and one pressed while
a page was on its way offers it once its own page has arrived.

**A box under each header.** A second row of the table's header holds a
box under each column the line can name, named Filter and the column's
name, read by data-core's `headerCondition`: the line's condition on that
one column, a bare word a contains in text and an equality elsewhere.
Enter or leaving it applies it; Esc gives the edit up; a refusal, the
line's or the server's, is said in the step's alert and the typing kept.
A boolean's box is a select of Any, true and false. The line, the chips
and the boxes read and change one filter, the one the page was asked
with.

**A column the line can name.** A column's name is the database's, which
may be two words or differ from another's only in case. The line names it
as data-core's `lineNames` names a field: lower-cased, every run of
anything that is not a letter or a digit one `_` -- `order_date` for
`Order Date` -- and, where two names give one, each by its own name
instead. data-core's new `nameableFields` keeps a field whose name is then
one word that reads as it alone and leaves out the rest: `Order Date`
beside `order_date`, whose own name is two words, and both of `Code` and
`code`; a column left out has no name to type, no completion and no box. `headerCondition` now puts a
field's name in the line in front of a box's text, not its key, so a box
on `Order Date` reads; for every host field the two are one word that
reads the same.

**A press while a page is on its way** is not dropped
(`apps/studio/src/browse-pages.ts`): it is sent once that page has
settled, on the page as it then stands -- the one that arrived, or the one
on screen where it was refused -- and a further press while it waits
builds on it, so a box left and then Clear the filter is the box's
condition and then none, and a select stepped twice ends on its second
value, which it shows meanwhile, being controlled by the filter as it will
stand. A press that no longer applies where the page then stands -- a
second press of a follow, a box or a sort of a page a move is leaving --
is dropped. What a box typed stays until its page has arrived, and is not
taken by another page arriving first. A box's refusal, the line's or the
server's, is owned by the box: the step's alert keeps saying it through
other pages, the box marked invalid and described by it, until the box
changes, is given up or applies.

**What stays.** Paging and sorting keep the filter, Show rows drops it, a
follow starts the other end unfiltered, and Back returns the page left
with its filter; the line, the chips, the boxes and Undo are mounted
afresh for every page a move reaches. A page none of whose columns can be
named says so and has no line and no box.

Not in this change: a condition through a foreign key (a browse names
columns), a saved view of a browse, a condition taken from a cell, and
the host's offer to try a list nothing matches without its last
condition.

## Consequences

**What it buys.** The administrator types what they want to see in the
order they think it, in the language the host's people use, and can read
the filter at a glance in three places that never disagree.

**What it costs.**
- Two comboboxes over one reader: the host's and the studio's keys could
  drift apart. The studio's suite holds the host's cases one for one,
  but nothing fails when the host's line gains a key the studio's lacks;
  review holds that.
- A column with no name in the line -- one whose own name is not one word
  where another's gives the name it would have had, `Order Date` beside
  `order_date`; two names that differ only in case; one with no letter or
  digit that is not a word, `=` -- can be browsed and sorted but not
  filtered.
- Presses made while a page is on its way are sent one after another, the
  later on the page as the earlier leave it; one made on a page a move is
  leaving is dropped, and nothing says so but the page reached.
- A box's refusal is said in the step's alert in the line's or the
  server's words, which do not always name its column, and on a phone the
  alert may be out of view of the box.
- The panel's hints are gone: that equality on text is the whole value,
  case and spaces counted, and that text of no characters is a value, not
  NULL. Completion says what each operator means; the chips say NULL.
- A boolean's box and chip say true and false, the line yes and no, which
  data-core prints and reads for every boolean.
- The row of boxes widens a table: one that fitted the page now scrolls
  sideways in its own region, as a wide one already did.
- A box applies what was typed when it is left, as the host's does, so
  text typed into one and clicked away from filters the page.
- `/` anywhere on the step outside a text box takes the keyboard to the
  line.

**What it forecloses.** Nothing on the server: a browse's body is what
the panel sent.

## Alternatives considered

**One React package for the line, the chips and the boxes, shared by the
host and the studio.** Rejected for this: the decisions -- what a line
means, what completion offers, what a box's text is -- are already one
implementation, in data-core; the combobox around them is per app, as
each app's focus helper is, and the host's draws its boxes in AG Grid's
floating filter row, which a plain table has nothing of. Cost if wrong:
the two lines' keys drift; the studio's `browse-line.test.tsx` asserts the
same keyboard contract as the host's `filter-line.test.tsx`, case for
case where it applies.

**Keeping Filter rows beside the line,** as the host kept Build a
condition until its boxes came (0131, 0134). Here the boxes come in the
same change, so nothing the panel built is lost with it.

**A key of the studio's own for each column,** `c1`, `c2`, so every key
is one word. The line reads a key as well as a name, so `c1 = 5` would
filter, and every term would need mapping back to its column.

**Giving the box a field keyed by its name, in the studio,** rather than
changing `headerCondition`. The box's reader would then be decided in two
places, data-core and the studio, the second one quietly.
