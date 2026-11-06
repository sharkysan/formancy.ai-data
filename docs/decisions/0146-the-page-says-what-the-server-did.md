# 0146 — The page says what the server did, and keeps the demo's controls out of the way

- **Status:** accepted; extends [0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md): the rows on screen stay, dimmed, while the next page or a new list's first page is asked for, a status line says what the server answered in the room's teal for a moment and is muted after, and the renderer switch and Open by record token are one disclosure, For the demo, kept per viewer; extends [0080](0080-a-host-downloads-the-records-its-grid-lists-and-the-browser-saves-the-servers-file.md): Download CSV's line says a file made in teal for a moment, and is muted after
- **Date:** 2026-11-06
- **Deciders:** Daniel Bacher
- **Verified by:** `apps/host/src/grid-datasource.test.ts` -- a page asked
  for first is asked once, after the row the page before ended with, and
  AG Grid's block at that row is answered from it, the line told only then
  (watched failing with the kept answer ignored: two requests for rows
  51-100); what was asked first answers that block once, and the next ask
  goes to the server (watched failing with the answer kept after it was
  taken: the second block was the first answer's rows); a block AG Grid
  asks for under another order than the list's is answered with the rows
  on screen, asking nothing (watched failing with that block failed, as
  before: no rows); a page asked first and refused is told as one, and
  nothing of it is kept (watched failing with `ahead` false).
  `apps/host/src/prefs.test.ts` -- the demo's controls closed until the
  viewer opens them and as they left them after, closed being nothing kept
  (watched failing with them read as open whatever is kept), a value the
  page did not write opening nothing (watched failing with any value kept
  read as open), and storage that throws. `apps/host/src/use-held-rows.test.tsx`
  -- a new list refused stands, and a turn or a reload asks for it again
  until a list is shown (watched failing with a turn paging the list
  shown: rows 51-100 of the last list asked for); a page AG Grid does not
  move to dropped and the wait ended (watched failing with the move taken
  as made); a page refused forgotten once the grid has asked or been
  answered since (watched failing with the refusal kept: Ask again asked
  for rows 51-100); the list shown and the list asked for heard and no
  other (watched failing with every list heard); and a reload while a new
  list is on its way asking for that list, not the list shown (watched
  failing with the reload left to AG Grid); and a list given to AG Grid
  between presses, never during one (watched failing with the list given
  at once: shown while the pointer was down). `grid-datasource.test.ts`
  also: the rows on screen answered as having more where they had (watched
  failing with their count given as the last row); a page asked first and
  dropped asking the server after (watched failing with the drop doing
  nothing); and every hook naming the list it comes from (watched failing
  with it left unsaid). `apps/host/src/demo-tools.test.tsx`
  -- one closed disclosure on arrival, the Renderer group and Record token
  out of the tree, Enter opening it with the keyboard staying on it and the
  next Tab on the renderer chosen, axe and a name on every control
  (watched failing with the panel drawn open whatever the disclosure
  says); kept in the browser and as the viewer left it on the next opening
  (watched failing with the state unkept); shown by the page for a refused
  Load and not kept open (watched failing with the page's opening kept as
  the viewer's); and Load's refusal said inside what it shows (watched
  failing with the alert outside the panel). `apps/host/src/server-did.test.tsx`
  -- what the server did is drawn in an element of its own inside the
  line's live region, a new one each time (watched failing with the key
  left off: the same element both times), marked still under reduced
  motion (watched failing with the query never asked).
  `apps/host/src/view-save.test.tsx` -- a view kept and a view removed are
  said in teal, a refusal not (watched failing with the line drawn as
  before: no element held the words). Every host file runs under the
  suite's `globalSetup`, which starts both databases; these need neither,
  and were run and watched failing under a copy of
  `apps/host/vitest.config.ts` without it, which was not kept. On both
  engines against the real server, to be watched failing in CI:
  `apps/host/src/held-rows.test.tsx` -- Next rows held: the first page's
  rows still in the grid and its well marked waiting, then the next rows
  and nothing waiting (with the rows taken away while the page is asked
  for, as AG Grid's empty block did before, and given back once it
  answers); a page asked first and refused, no longer waiting, and Ask
  again asking for that page and showing it (with Ask again asking AG
  Grid's own page again: "Rows 1–50; more follow." came back); a second
  press of Next rows while the first is asked for sending nothing (with
  the second press asking again: two requests held); a new search refused
  leaving the list before it on screen, no longer waiting (with the rows
  taken away when a new list is refused); a page the server answered, and
  "No records match", in teal, and the page's own "Record … is not on this
  page." not (with the page's own sentences counted as the server's); and
  a save the server answered in teal, "Saving…" not (with no save said as
  the server's); a new search refused standing, Previous rows and Next
  rows `aria-disabled` and described by the line and its help, and a press
  sending nothing (with the pager left to the last list); Ask again after a
  page refused, an answer and a refusal since asking for the grid's own
  page (with the grid never telling the hook it was asked or answered:
  "Rows 51–53."); and a save while a new sort is on its way listing what
  was saved (with a save's reload left to AG Grid: the row's notes from
  before the save); and a row pressed while a new search is on its way
  opening its record, the search's rows after (with the list given at
  once: the record never opened, as `delete.test.tsx`'s "Not deleted"
  case found on PostgreSQL in CI run 42203470148, whose `searchRecords`
  took the last list's one row, still on screen, for the search's, and
  pressed it as the answer came). `test-host.tsx`'s `searchRecords` now
  also waits until the grid no longer says it is busy, not watched failing
  on its own. `apps/host/src/choices.test.tsx` -- the renderer chosen
  drawing the record with the demo's controls closed, on this page and the
  next (with the record drawn by the switch only while it is shown: React
  alone, once closed). Changed to the new controls and not watched
  failing on their own: `apps/host/src/test-host.tsx`'s `chooseRenderer`
  and `load`, which open the demo's controls first through `openDemo`, and
  every case that goes through them; `choices.test.tsx`'s first case;
  `page.test.tsx`'s refused Load, which finds For the demo open; and
  `guide.test.tsx`, which opens it where it is closed, as the guide says.
  The browser gate, in Chromium, Firefox and WebKit, to be watched failing
  in CI: `apps/host/scripts/browser/waiting.mjs`'s "Rows kept while a sort
  is asked for", in which a header is pressed with the list it asks for
  held -- the gate's plane holds less than a page of orders, so no page is
  turned there -- and the rows shown stay (with that block failed, which
  also fails the datasource's own case above), the well is dimmed while it
  is asked for and not once it answers (with the dim at 1), every text in
  the dimmed well is at 4.5:1 or more -- axe's audit of the well, which
  reads its opacity, and the header's and a cell's text, which axe cannot
  decide behind AG Grid's layers, composed at the well's opacity from the
  pixels painted before and during the dim (with the dim at 0.5), AG
  Grid says it is busy and then not (with `busy` left unset while a block
  is asked for), the line says the answer in the colour room.css gives
  `--server`, held at the start of its moment, which axe finds enough on
  its glass (with the moment drawn in the room's violet); "What the server
  did, under reduced motion", in which, three fifths through its moment,
  the colour has faded from where it began, and under reduced motion,
  emulated, has not (with the fade stepped whatever the person asks:
  `step-end` on every `server-did`); and `workspace.mjs`'s "A row open,
  side by side", in which the demo's controls are one closed disclosure
  where a person arrives (with them open by default), and Enter on it
  changes it, read as a change from what the arrival drew, with the
  keyboard staying there (with the keyboard taken off it after every
  press). The fade and its stillness under reduced motion
  are one check, since one break of the timing cannot fail either alone in
  one stylesheet. Each break fails its own case or check and no other page
  case or check; the breaks of the rows kept under a sort and of the
  disclosure's arrival and keyboard fail the datasource's and
  demo-tools.test.tsx's cases of the same behaviour too. Every state is
  measured after, as before: the
  gate waits for every animation to finish before its audit, so axe there
  reads a line in its own colour, and the teal is measured by the check
  above.

## Context

The design of finding records (agreed with the user on 2026-11-04) asks
for a page that is easy to use and fun, and names two points this decides:
"the previous rows stay, dimmed, while the next page loads, so the screen
never blanks", and "a save, a move or a filter applied says so in the
room's teal, briefly; motion respects `prefers-reduced-motion`". Its
layout keeps the renderer switch and Open by record token, "out of the
way: they are the demo's, not a person's".

What the page did. AG Grid's own overlays were already off and its loading
cells empty ([0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md)),
and the grid already said it was busy while a block was asked for
(`aria-busy`). The blank was AG Grid's own: its infinite row model makes a
block of empty rows the moment it needs one -- a page turned to, a new
datasource for a search, a filter, a view or a parent, a sort pressed on a
header -- and fills it when the datasource answers, so the grid held no
rows for as long as the server took. The lines that say what the server
answered were the room's teal for good, `.status[data-kind='answer']` and
the pane's `.saved`, whatever they said and however long ago. The renderer
switch and Open by record token, its own disclosure, sat under the
record's status line, each a control of its own; neither the disclosure's
state nor anything about it was kept.

## Decision

**A page is asked for before AG Grid is shown it** (`askFirst` in
`apps/host/src/grid-datasource.ts`, `apps/host/src/use-held-rows.ts`).
Previous rows and Next rows ask the server for the page while AG Grid
shows the one it has, and move it there once the page has answered; a new
list -- a search, a filter, a view, a sort, another parent -- asks for its
first page while AG Grid shows the last list's rows, and is given to AG
Grid once that has answered. AG Grid then asks its datasource for the
block, as it always does, and is answered from what came, asking nothing
again. A header pressed starts AG Grid's list again under its new order
before the section has a list in it, and the list shown answers that
block with the rows on screen, asking nothing, until the section's new
list replaces them; a list with nothing on screen yet answers as failed,
as before. Every request is the one it was: a view picked is still one
first page.

**While it is asked for, the rows are dimmed and the grid is busy.** The
grid's well is marked `data-waiting` while its line says what is asked,
and the room's stylesheet dims it to 0.8 a fifth of a second after the
ask, so an answer quicker than that draws no dim at all. 0.8 is the most
the well is dimmed with every text in it at 4.5:1 or more: the header's
muted text is the least, 4.90:1 over the glass, where 0.75 leaves it at
4.45:1 -- worked out on 2026-11-06 from `@formancy/themes` 0.13.0's
room.css and `grid-theme.ts`'s colours, the well composited at its opacity
over the glass over the ground, and held by the browser gate, which
measures every text of the dimmed well. The rule selects the well, never
anything inside it, as every host rule must (0047). AG Grid says the grid
is busy, as it did. A page AG Grid does not move to -- one it counts no
rows for -- is dropped, and the line says again what it said before the
ask, nothing dimmed or busy.

**A refusal leaves the grid as it was.** A page or a list asked first and
refused leaves the rows on screen, no longer dimmed, and the server's
sentence on the line with Ask again, which asks for what was refused --
that page, that list -- not AG Grid's own page; once AG Grid has asked
for a block of its own, or a block has answered, a page refused before is
not what Ask again asks for. A press of Previous rows or Next rows while a
page or a list is asked first sends nothing: the answer coming is the one
the person waits for, and a page asked from one not yet answered would
have no row to start from (0108).

**A new list refused stands, and nothing pages or lists the one before
it.** The rows on screen are then the last list's, which the search, the
filter, the view or the sort on screen no longer name. Previous rows and
Next rows wait -- `aria-disabled`, still focusable, described by the line
and its help, which says the rows shown are the list before and Ask again
lists the one asked for -- and a press sends nothing; a save's or a
delete's reload asks for the refused list again, as Ask again does, until
a list is shown or another asked for. A reload while a new list is on its
way asks for that list again, so what it shows is what was saved. The
grid hears what the list shown and the list asked for say, and nothing a
list replaced says. What has answered is given to AG Grid between presses,
never during one: AG Grid draws the rows it is given over those on screen,
and a press begun on a row it redrew would end on none, so the click would
open nothing; a press is let go wherever the pointer is.

**What the server did is said in the room's teal, for a moment**
(`apps/host/src/server-did.tsx`). The lines that say it, and only when
they say it:
- a record grid's line -- the Records panel's, a child's, a Drill down
  level's -- when it says a page the server answered: the range, a filter
  or a view applied, a search, nothing matched, and what comes before the
  page, a record deleted or closed and a list started again;
- a pane's line when it says the server saved or created the record --
  "Saved.", "Created record …" -- a state's move among them, which is a
  save of its field ([0127](0127-a-host-page-draws-a-state-field-as-the-moves-its-person-may-make.md));
- the View picker's line when the server kept or removed a person's view
  ([0126](0126-a-person-keeps-their-own-list-views-on-the-server-for-themselves-alone.md));
- Download CSV's line when the file is made (0080).

Not: those lines when they say the page's own words -- the open record's
row not on this page, `=` keeping no value, a press a save waits for --
or a page still asked for, a save still out, a refusal, which is warm as
every refusal is; nor the record's own line, which says what the page
opened and is quiet; nor a notice. The words are drawn in an element of
their own inside the line, a new one each time, whose colour is the
room's teal for the first two fifths of 2.4 seconds and then fades to the
line's own; the line, its live region and its words are as they were, so
the person who hears the line hears what they heard before. Once said, an
answer is muted, as a page still asked for is. The teal is 11.34:1 on the
glass over the ground and the muted it settles in 7.04:1, and no colour
along the fade is below the muted's; with every light behind the glass at
once, which no point of the page has, 10.05:1 and 6.23:1 -- worked out from
room.css's values, as the dim's. The moment's length is chosen, not
measured.

**Under reduced motion the colour changes without a transition**: teal for
the moment, then the line's own at its end. The preference is read by the
page (`matchMedia`) and marked on the element (`data-still`) rather than by
an `@media` rule, because the host's browser gate reads only a `max-width`
in rem and stops on any other condition, so that no part of the stylesheet
goes unmeasured (`scripts/browser/styles.mjs`); the gate measures this by
emulating the preference.

**The demo's controls are one disclosure, For the demo, at the end of the
record's header** (`apps/host/src/demo-tools.tsx`). It holds the renderer
switch and Record token with Load, where Open by record token was a
disclosure of its own; closed, nothing in it is in the accessibility tree
or the Tab order. It is closed until the viewer opens it, and as they left
it after, kept in their browser (`formancy-data-host.demo`, beside the
renderer choice; closed is nothing kept). A Load refused is said inside it
and opens it, as Open by record token opened itself (UX-SPEC D10); that
opening is the page's and is not kept. The renderer chosen is the
workspace's, kept as before, and draws the record whether the disclosure
is open or not. The getting-started guide's section 5 names it.

It is host chrome, in `styles/records.css` and `styles/panes.css`, in the
room's variables; no rule of it selects inside a paper or a grid.

## Consequences

**What it buys.** A page turned, a header pressed or a search sent no
longer empties the grid while the server works, and a slow answer is
plainly a wait; what the server did catches the eye when it happens and
recedes after, so the line that is teal is the one that just changed; and
a person sees one quiet button where the demo's two controls were.

**What it costs.**
- While a sort or a new list is asked for, the rows on screen are the last
  list's, in its order, under headers, boxes and a line that already say
  the new one; they can be opened, and are the records they show.
- A list or a page that answers while a pointer is pressed on the grid is
  drawn only once it is let go, so a press held down keeps the rows before
  it on screen, dimmed.
- After a new list is refused, the rows on screen are the last list's,
  and Previous rows and Next rows wait for the refused one: nothing pages
  the list shown, and a save or a delete lists the refused list again,
  until Ask again or another search lists one.
- AG Grid makes a block's rows empty a task before it asks its datasource
  for them (`InfiniteBlock.loadFromDatasource`, ag-grid-community 36.2.0),
  so a page given to it may still be drawn empty for that task, a frame at
  most -- read from that source, not measured.
- A page asked for again after a save or a delete with no other list asked
  for, Ask again after a
  refusal of AG Grid's own first page, and a list started again because its
  row was gone (0108) are asked by AG Grid, and blank while asked, as before.
- The dim dims the whole well, its headers and their boxes too, which can
  still be typed in; its fade, 150 ms, is colour, not motion, and does not
  follow reduced motion, as the controls' transitions do not.
- An answer is muted once said where it stayed teal before, so a line read
  a moment later is quieter than it was; the README's host pictures, taken
  with animations at their end, show the muted lines.
- Reduced motion is read by the page: a browser that cannot be asked
  (`matchMedia`) fades the colour.
- The renderer switch and opening by token are one press further away, and
  a person who used them sees them again only once they open For the demo;
  kept per viewer, as the renderer choice is, a shared machine keeps the
  last viewer's.
- The README's host pictures change with the record's header: the hero,
  `host-loaded`, shows For the demo closed where the renderer switch and
  Open by record token were; `host-other-tenant` shows it open; and the
  grid's and the save's lines are muted in `host-loaded`, `host-delete`,
  `host-other-tenant` and `host-stale`.
- The browser gate holds the rows kept while a sort is asked for, not a
  page turned: its plane holds less than a page of orders. The page turned
  is held against the real server in jsdom.

**What it forecloses.** Nothing: what is asked first, which lines say what
the server did and what the demo's controls hold are the page's own, which
a later decision can change without changing the server.

## Alternatives considered

**A toast** -- a message that floats over the page and goes away -- for a
save, a page or a view kept. It covers what is under it, a screen reader
may not read it before it goes, and it says again what the line beside the
grid or the form already says; the line stays where the person looks, and
the teal is emphasis on it, not a second message.

**A spinner, or AG Grid's loading overlay, over the grid.** The overlay
blanks the rows it covers, which is what this removes, and a spinner over
the rows hides them; the dim keeps them readable at 4.5:1.

**AG Grid's client-side row model**, the page holding the rows and setting
them once a page has answered. It is how a grid naturally keeps its rows,
and it would take paging, the cursors (0108) and what AG Grid does when a
page is left empty (0053) away from the infinite row model they are
measured on.

**`refreshInfiniteCache` for every list**, which keeps AG Grid's rows while
it asks again. It keeps a last row it already knew, so a page that gains a
row after a save shows no Next rows; and it cannot move to another page or
take another sort without making an empty block first.

**The answer lines teal for good**, as they were. A line that is always
teal says nothing about now; "briefly" is the design's word.

**`@media (prefers-reduced-motion: reduce)`.** The idiomatic rule, and one
the gate refuses, since it measures the page at every condition it reads
and reads widths alone.

**Dimming only the rows.** A rule inside `.grid-bench`, which the gate
fails, or a theme parameter AG Grid applies to every row of every grid,
which cannot change while one grid waits.

**Removing the renderer switch, or opening by token.** Showing a form under
both renderers is what the host page demonstrates (0029), and the guide's
"No such record." step needs a token loaded; so does a person handed one.

**Two disclosures**, the renderer switch's and the token's. Two presses for
what one holds, and two controls in the header for what is the demo's.

**The disclosure kept per form.** The renderer choice it holds is the
viewer's across forms, and so is whether they want the demo's controls.
