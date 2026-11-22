# 0166 — A person chooses a page's records by a column of boxes, and runs an action over them from a bar above the grid

- **Status:** accepted; extended by [0174](0174-the-host-page-deletes-the-chosen-records-of-a-page-and-the-studio-grants-who-may.md): the column and the bar are drawn where the form offers a deletion of chosen records too, the bar's Delete the chosen… asks it, the sentence a button says with nothing chosen names no action, and a deletion's answer settles the choice, each record left marked with why; extended by [0176](0176-the-host-page-changes-the-chosen-records-of-a-page-and-the-studio-grants-who-may-and-in-which-fields.md): the column and the bar are drawn where the form offers a change of chosen records too, the bar’s Change the chosen… asks it, and its fields and its confirmation stand only while the choice holds what they asked over
- **Date:** 2026-11-18
- **Deciders:** Daniel Bacher
- **Verified by:** the studio offering the scope, the host page's choice
  of rows, and running an action over it. Written on a machine without
  Docker on 2026-11-18: the cases that need no database ran there, each
  watched failing with its rule taken out and the file put back byte for
  byte; the suites that start the databases, and the browser gate, have
  never run, and CI is their first run.
  Ran and watched failing:
  `apps/studio/src/choose-actions.test.tsx`, against the real server
  behind a fake `fetch` -- an action ticked runs over the open record,
  the other choice a page's records a person chooses, a radio group with
  its legend in view that the arrow keys move in, described by the
  generator's note of the action as bound, which for a selection says
  every record is held until the last call returns, and which sits in a
  polite live region so a radio's change is heard; the request carries
  the scope, and the Generate step says the note (watched failing with
  the radios' change left unwritten: "expected [ true, false ] to deeply
  equal [ false, true ]", with the group described by nothing, and with
  the note in no live region); the Policy step's notice before the grant
  and the Presentation step's hint say what a selection runs over, and
  the Choose step keeps the choice (watched failing with each written
  for the open record alone). `apps/studio/src/actions.test.ts` -- the
  note that describes the group is the generator's of the action as
  bound, never a field's whose key the action is named after (watched
  failing with every note of that name taken).
  `apps/host/src/running.test.ts` -- a run over the records chosen is
  headed by how many it is over and done says how many it ran over
  (watched failing with the open record's heading for every run); a
  refusal keeps the records the server named (watched failing with them
  unread); a lost run is checked by a read of each record, run again
  only when none moved, and some moved and some not is `mixed`, never
  run again (watched failing with the first record alone read).
  `apps/host/src/chosen-rows.test.ts` -- a choice is cleared by another
  page or another list and says so (watched failing with a page compared
  by where it starts alone); kept by its page drawn again, at the
  versions that read gave and the detail heard since, a record gone from
  it named, the records in the page's order (watched failing with the
  versions kept from the first read); only records a run could address
  are chosen (watched failing with a row of no token chosen); each saying
  counted, a sentence said again included (watched failing with the
  count kept); and only a version a form did not hold before heard, so a
  save sent never puts back a version older than the page's (watched
  failing with every telling heard).
  `apps/host/src/choose-column.test.tsx`, run with a configuration of its
  own without the databases its package's suites start, which it does
  not use -- each box a real checkbox named for its record, first,
  headed Choose, `tabIndex` -1, none on a row with no token, axe clean
  (watched failing with the box unnamed, and with its `tabIndex` left to
  the browser: "expected [ +0, +0 ] to deeply equal [ -1, -1 ]"); the
  arrow keys reach the box, Space ticks it and neither opens the record
  nor deselects the open row, Space on a field's cell still opens it and
  Enter on the box opens it (watched failing with Space on the box given
  to the row); a click on the box opens nothing (watched failing with a
  click inside an input heard as the row's); Tab from the box leaves the
  rows (watched failing with AG Grid's own Tab between cells); AG Grid's
  live region says on the box that Space ticks or unticks it, and on a
  row's Delete that Space or Enter asks to delete it (watched failing
  with every cell said as a field's); and a row with no box leaves Space
  to the row, and `=` asks nothing of a box or a Delete (watched failing
  with each rule taken out).
  First run in CI, never run: `apps/host/src/actions.test.tsx`, on both
  engines -- two orders of three chosen and closed together through the
  dialog in React and in Angular are both closed once, the third not, the
  page read again and the choice cleared, axe clean and every control
  named with the boxes ticked, at the dialog, at the confirmation and
  once done; one order changed since the page read it is refused naming
  it, its region described by what it says, nothing closed, no run again
  offered, and the page read again runs; the boxes and the bar only on a
  form with an action over a selection, the Columns panel neither
  listing nor moving the boxes' column, an action pressed with nothing
  chosen sending nothing and saying what to do first, again in a new
  element at a second press, Clear the choice saying there is nothing
  to clear, and the bar with nothing chosen axe clean; Next rows clearing
  the choice, saying so and closing the confirmation over it, nothing
  run; a box ticked or unticked closing the dialog or the confirmation,
  nothing run; a second press while a run is out sending nothing; and
  the open record's header still offering no action over a selection.
  The run out, a lost run and a check are held by `running.test.ts`
  alone, without a page. `apps/host/scripts/browser-test.mjs`
  (`apps/host/scripts/browser/choosing.mjs`) in Chromium, Firefox and WebKit at
  every width -- the column and the bar measured with a record chosen,
  the box reached by the arrow keys, Space on it opening nothing, Tab
  from it leaving the grid, and close-all run from the keyboard. And
  every host suite that measures the action order -- `page.test.tsx`'s
  axe over each state of an action, `plane.test.tsx`'s journey -- now
  with the column and the bar drawn on it.

## Context

0165 built the server's half of an action over a selection -- data-core,
both adapters, the route, the audit and data-client -- and left the
studio binding the open record's scope alone and the host page offering
a selection nowhere: its Decision 9 kept `apps/host/src/action-flow.ts`
to the actions over the open record, and an action over a selection
"belongs above the grid". The host's grid selects one row, the open one
(`singleRow`, 0047), and its own Space never toggles that selection,
which would deselect the open row; a row's Delete is a real button in a
cell the arrow keys reach, out of the Tab order (0053). A run is one
page at most (0165).

## Decision

1. **The studio offers the scope.** Where the Choose step maps a routine
   as an action (`apps/studio/src/choose-actions.tsx`), "What it runs
   over" is a radio group with its legend in view: The open record, where
   every action starts and every bundle before 0165 binds it, or Records
   a person chooses in the list, up to a page. Under it, once the
   generator binds the action, the generator's own note of it, which
   describes the group and says for a selection what holding every record
   costs; the Generate step says the same note. The Policy step's notice
   before the grant (`policy-actions.tsx`) and the Presentation step's
   hint (`presentation-actions.tsx`) say what the action runs over.
   Nothing is decided in the browser that the generator decides.
2. **The choice is a column of real checkboxes, not the grid's own
   selection.** `singleRow` stays the open row and Space on a row still
   opens it. Each box (`apps/host/src/choose-column.tsx`) is in a first
   column headed Choose, on the pattern of a row's Delete: a cell the
   arrow keys reach that hands the keyboard to its box, which is
   `tabIndex` -1, so the grid stays one Tab stop; its Space is its own
   and never the row's, a click on it is not the row's, and its Enter
   opens the record as any cell's does. It is named for its record in the
   words its row's Delete names it with -- "Choose Order k1:7" -- 24
   pixels square, in the room's violet, by its own style attribute. A row
   whose key fits no token, or that has no version, has none, and Space
   on its cell is the row's, which says why it cannot be opened. AG
   Grid's live region, which says what Space and Enter do as the
   keyboard reaches a row's cell, says on the box that Space ticks or
   unticks it, and on a row's Delete that Space or Enter asks to delete
   it, never that either opens the record. `=`, which keeps a field's
   value as its column's condition (0133), asks nothing on the box or on
   Delete, which hold none.
3. **Only on a form that offers this person an action over a
   selection** -- `PublishedForm.actions`, which the server fills with
   the actions this person may run -- and only on the Records grid: a
   form without one, a child section and a Drill down level draw their
   grids as before.
4. **The bar above the grid** (`apps/host/src/selection-bar.tsx`): each
   action over a selection as a button; a status line saying how many are
   chosen -- "3 chosen." -- and, when a choice is cleared by a change of
   page, that it was and why; Choose every record on this page; and Clear
   the choice. An action pressed with nothing chosen sends nothing: it is
   `aria-disabled`, described by the sentence that says what to do first,
   which the press says on the status line, as the pager and the Columns
   panel say what cannot be done; Clear the choice with nothing chosen
   says there is nothing to clear. Each saying is a new element of the
   line, as the Columns panel's is, so a second press that says what the
   first said is heard again.
5. **A choice is of the page shown** (`apps/host/src/chosen-rows.ts`). A
   page of another list -- a search, a filter, a sort, a view -- or
   another page of this one, drawn in its place, clears it and says so: a
   run is one page at most (0165), and a choice kept past its page would
   send records the person no longer sees. The same page drawn again --
   after a save, a delete, Ask again -- keeps it, and a record no longer
   on it is no longer chosen, which is said. Another form unmounts it.
   A question asked over a choice -- the dialog, the confirmation --
   stands only while the choice holds the records it was asked over: a
   box ticked or unticked, Clear the choice, or a page that clears or
   narrows the choice closes it, nothing run, and the keyboard goes back
   to the action where it was in the region. Run it sends the records
   chosen as it is pressed, never a version kept from when it asked of a
   record the page no longer shows.
6. **The version sent** for each record is the one the page read it at,
   or the one the detail heard since -- a save of the open record, or a
   read of it -- whichever arrived last: the latest this page knows. A
   form tells what it holds when a save is sent too, at the version it
   was opened at, which is nothing new and is not heard. So a
   person who saves the open record and then runs over a choice that
   holds it sends the version their save moved to, and Run it waits for
   a save of the open record out where it is chosen, as 0162's does.
7. **Running is 0162's flow** (`action-flow.ts`, `running.ts`,
   `action-region.tsx`), one flow beside the open record's, its region
   under the bar: the dialog, then the confirmation in place, headed by
   how many records it is over -- "Close the chosen orders: 3 records?"
   -- and, where the administrator wrote no sentence, "It runs in the
   database, over each of these records, in one transaction: if one is
   refused, none of them is changed." A second press while the run is
   out sends nothing. Done says the administrator's sentence or "Done.",
   and "It ran over 3 records."; the page is read again and the choice
   cleared; where the open record was chosen, it is read again into its
   forms as 0162 reads it, and its forms are held while the run is out.
   A refusal naming records -- `stale`, `not-found` -- says the server's
   sentence, "It is about Order `k1:9`.", that nothing was done to any of
   the chosen records -- the region the keyboard lands on described by
   all of it, so it is said as it lands -- and offers Read the page
   again, which keeps the choice at the versions read then. `unavailable` is Not run, as 0162
   says it for one record; a lost run is checked by a read of each
   record: every one at the version sent, Run it again with those
   versions; every one moved, it ran or each was changed; some of each,
   it did not run, since a run moves every record or none, and the page
   is read again.
8. **No Run it again anyway.** A refusal about records offers to read
   the page again, never to run again past it: the records it names were
   changed or are gone, and running again over the versions it was
   refused at would be refused again, while over newer ones is a run the
   person has not seen the records for. After the page is read again a
   run is a new one, with its own confirmation.
9. **A run over a selection is the records grid's work** to the guard,
   as a delete asked from one of its rows is (0053): out, or lost and not
   checked, it goes only with the grid -- another form, Back or Forward,
   Sign out -- which ask first; opening another record does not.

Nothing here was measured: it was written without a database or a
browser, and the suites that would measure it run first in CI.

## Consequences

**What it buys.** An administrator offers a routine over the records a
person chooses, from the studio; a person chooses them with the keyboard
or a pointer on the page they see, and runs it once, all or nothing,
told how many it ran over or which records refused it -- and the grid of
a form that offers no such action, and the open row's selection, are as
they were.

**What it costs.**

- **No choice across pages.** A person closes sixty records in two runs,
  a page each (0165), and chooses again on each page.
- **A choice is lost by paging**, and by a search, a filter, a sort or a
  view: said on the bar's line, and not kept anywhere, not even in the
  browser, so a reload loses it too.
- **A question is lost with its choice.** A box ticked while the
  confirmation asks closes it, and the dialog's answers with it: the
  person asks again over the choice as it is now.
- **One more column on those forms**, first, and a bar of the actions
  and two controls above the grid. The Columns panel neither hides nor
  moves it.
- **No header box for the page.** Choose every record on this page is a
  button in the bar, not a checkbox in the column's header, which AG
  Grid's header keys would have to be taught.
- **A lost run over a selection is checked by one read per record**, up
  to a page of reads, and where some moved and some did not, it is said
  as not run and is never run again from there.
- **The open record chosen is read again after the run**, which drops
  what its forms held where the confirmation listed them, as 0162's run
  does.
- **The version is whichever arrived last**, the page's read or the
  detail's: a page read after somebody else changed the record sends
  their version, and the person's forms, at the older one, are read
  again only where the open record was chosen.

**What it does not do.** No choice in a child section or a Drill down
level, no choice across pages, no header box, and no preview of what a
routine would do.

**Forecloses:** nothing.

## Alternatives considered

**AG Grid's `multiRow` selection.** Lost: the grid's selection is the
open row (0047), which `aria-selected` and the bar say, and its Space
toggles it; two meanings of one selection would deselect the open record
when a person chose another, or open one when they chose it.

**A choice kept across pages.** Lost: a run is one page at most (0165),
so a choice past a page could not be sent as one run; and the records
chosen on a page no longer shown are ones the person cannot see while
they confirm.

**A header checkbox for the page.** Lost for now: AG Grid's header cell
takes its keys -- Space, Enter, the arrows -- for sorting and moving,
and the header box would need them taught; a button in the bar does
the same and says what it does.

**The column on every form.** Lost: a box with no action to run over
what it chooses is a control that does nothing, and every grid would
change for every person.

## Older records

Extended, not edited away: 0047 (the Records grid's first column of
boxes on a form that offers an action over a selection, whose Space is
its own); 0162 (an action over a selection runs through its flow, its
states generalised from one record to the records chosen); 0163 (the
studio offers the scope); and 0165 (the studio binds a selection and the
host page offers one, its Decision 9 lifted).
