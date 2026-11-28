# 0179 — A grid edits the open record's cells, and saves its row when it is left

- **Status:** accepted; narrows [0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md): its "no cell is editable" holds for every row but the open record's, whose cells the Records grid edits as the record's form's draft; extends [0122](0122-a-host-page-draws-a-saved-record-for-the-update-and-a-new-one-for-the-create.md): the copy a pane draws a record with decides which of its row's cells are edited, and is one module both read; extends [0146](0146-the-page-says-what-the-server-did.md): the Records grid's line says a row's save stored in the room's teal, and what a save did not store as a refusal, each sentence a new element
- **Date:** 2026-11-27
- **Deciders:** Daniel Bacher
- **Verified by:** written on a machine without Docker on 2026-11-27: the
  cases that need no database ran there, each watched failing; the host's
  suites that start the databases, and its browser gate, have never run,
  and CI is their first run.
  Ran and watched failing, with a configuration of their own without the
  databases the package's suites start, which they do not use:
  `apps/host/src/grid-edit.test.ts` -- each rule of which cells are edited
  where, read from the copy a pane draws the record with: text, a number,
  a date, a checkbox and a select of the copy's options in the cell; a
  textarea, a time, a timestamp and a lookup in the record's form; never a
  row with no token or no version, a box or a Delete, a field the
  published form disables, one written on create only on a saved record
  (and not on a new record's copy), one this person may only read, any
  where they may not update, an ended version, a state field with no move
  from its state (and a select of its moves where it has some), a computed
  field, and, on the open row, a field the engine's snapshot disables or
  hides; the row's mark, its state after each answer, when leaving it
  saves, where Tab and Shift+Tab go, and the line's words for each answer
  (watched failing against a module holding none of the rules, seventeen of
  eighteen failing, and the box-and-Delete case with its rule taken out).
  `apps/host/src/cell-editors.test.tsx` -- AG Grid as the page configures
  it, the page's edit over a real session and engine, no server: F2 opens
  an editor named for its field and record, which passes axe and the name
  check, its typing the engine's at once; Shift+Tab and Tab move among the
  row's editable cells past the one the form edits, the row drawing what
  was typed; Escape puts the cell back with the keyboard on it; a
  character, Delete and Backspace start and clear nothing; F2 says why on a
  cell never edited and shows the record on one the form edits; the row's
  words say what F2 does there; Enter saves the row, the lost answer said
  on its first cell and the line; and a submit the engine refuses puts the
  keyboard back in the invalid cell's editor, `aria-invalid` and described
  (watched failing without `CustomEditorModule` -- "error #200", no editor
  -- and again with F2 handed to no one, AG Grid's own keys let through
  and the row's words left as they were: every case failed). Added there
  after review, each watched failing before its fix or with its rule
  taken out: a keystroke that makes a problem once a save has touched
  every field keeps the keyboard in its editor, described, the form's
  error summary drawn beside the grid (failing: the keyboard on the
  summary, the editor gone); Escape gives the row's state back, so
  leaving the row sends nothing the form alone typed and a lost save's
  mark stays (failing: "Saving Order k1:1…" sent); a double click edits a
  cell as F2 does, and on a row's Delete presses it and edits nothing
  (failing with the double click handed to no one); in Drill down F2
  shows the record (failing with that rule taken out); and, in
  `grid-edit.test.ts`, leaving waits for the form's Save of a row the
  grid edited (failing: "save" where "wait" was wanted).
  `apps/host/src/session-work.test.ts`, `widgets.test.ts`,
  `grid-theme.test.ts`, `choose-column.test.tsx` and `grid-widths.test.tsx`
  ran and pass, the copies taken out of `session.ts` into
  `drawn-copies.ts` and the editors' theme parameters among what they read.
  First run in CI, never run: `apps/host/src/grid-editing.test.tsx`, on
  both engines -- in React and in Angular, F2, Shift+Tab, Tab, Escape and
  Enter editing a row whose save is stored in place with no page read
  again, the record's form holding what the cell typed; F2 on another row
  opening it to edit, and Tab past the last cell saving the row and
  editing the next; a stale save said on its row and line, its changes
  kept, the notice opened without taking the keyboard, in both renderers;
  an invalid answer putting the keyboard on its cell and sending nothing;
  a declined save in the deployment's words, record-wide and on a field
  the form edits; a refused save in the server's sentence; a lost one
  saying it may have been saved; a save out holding F2 and another row
  until its answer; Space on another row saving the edited row first,
  the update sent before the other record's read; a cell retyped after
  the row was saved keeping the keyboard in its editor, in both
  renderers; the form's Save of a row the grid edited holding Space on
  another row until it stored; a cell given up with Escape leaving what
  the form alone typed to the guard, nothing sent; a row not stored left
  through the unsaved-changes question, nothing sent again; a double
  click on another row opening it to edit; under Both, the React form's
  draft alone; and a lookup changed in the form shown by its token in the
  row, and by its label once the row's save stored.
  `apps/host/src/in-flight.test.tsx` -- a save the grid sent is the form's:
  its Save is busy while it is out, F2 waits, the floor holds, and it is
  stored once. `apps/host/src/grid-keys.test.tsx` -- F2 says why on Id,
  goes to Notes in the form and edits Group in its cell, a character
  starting nothing; and an editor opened and given up writes nothing on
  the console. `apps/host/src/page.test.tsx` -- axe and a name on every
  control with a cell in edit, its row saving and its row not saved.
  `apps/host/scripts/browser/editing.mjs`, in Chromium, Firefox and WebKit
  -- the editor in the well, axe passing it while it is open, Shift+Tab
  and Tab, Enter saving with the keyboard on the cell, Escape, and a stale
  save marked on its row, axe passing the page with the mark drawn and
  its contrast decided.
  CI's first run of them (run 46067210291) failed three, each mended
  since: `apps/host/src/actions.test.tsx`'s paging, a page turned back to
  listed while AG Grid still drew the page left, because the row's words
  asked the row model for the focused row of a page no longer shown,
  which made a block for it (the row is now read from the rows drawn);
  `apps/host/src/drill.test.tsx`'s row words, which had not been told of
  F2; and the live demo's gate, which took the grid showing a note typed
  in the form as its save stored -- the open row draws the draft -- and
  pressed New record while the save was out, which the guard asks about
  (`apps/host/scripts/browser/demo.mjs` waits for the form's Saved. now).
  That wait is run by CI's live-demo job alone and has not run yet.
  `grid-editing.test.tsx` holds the page it rests on, not the wait: the
  form's own Save holds New record only until its answer, whatever the
  row shows, and one status in the record's region then reads Saved., as
  the gate's strict wait needs (the case written in the gate's old order
  fails, New record never drawn; the count fails with a second Saved.
  planted on the detail's line). Run on 2026-11-28 on a machine with
  Docker, one file at a time, on both engines: `actions.test.tsx`,
  `drill.test.tsx`, `grid-editing.test.tsx`, `in-flight.test.tsx`,
  `grid-keys.test.tsx` and `page.test.tsx`, each passing; the browser
  gates and the live demo's gate were not run there.
  Added to `grid-editing.test.tsx` after review, each watched failing on
  both engines before its fix: a row asked for while the row's save is
  out goes with the form New record replaces, Discard and continue
  pressed, and does not open at the next Save of another record's form
  (failing: that row read once the other form stored); and React's save
  out, Angular shown with React's draft discarded, leaves the row no mark
  and another row opening on a press (failing: Saving… on Angular's row,
  and no answer to end it). Run after the fix on 2026-11-28, one file at
  a time on both engines: `grid-editing.test.tsx`,
  `cell-editors.test.tsx`, `in-flight.test.tsx`, `grid-keys.test.tsx` and
  `page.test.tsx`, each passing.

## Context

The Records grid lists a page of records and the detail beside it holds
one in each renderer's form (0047); a change is typed into the form and
saved by its Save. Correcting one field on each of several records means
opening each, finding the field and pressing Save, which is the slowest
way through a list that is mostly right. 0047 made no cell editable, so
the page had one draft per record and one route for every save.

The form already holds everything an edit needs: the copy of the record
for the write it may send (0117, 0122), the state field as its person's
moves (0127), the engine's rules, the session's outcomes and the guard.
A second set of rules for the grid would be a second answer to "may this
person write this field", which nobody would notice drifting.

## Decision

The Records grid edits the open record's cells, and only the open
record's: an edit starts on F2 or a double click, which opens a record
that is not open first, as Space does; the row draws the engine of the
session the detail draws -- the React pane's under Both -- and an editor
writes into it. Which cells are edited in the cell, which in the record's
form and which never is decided by the copy that session draws the record
with, read by one module (`grid-edit.ts`) over the copies `session.ts` is
drawn from (`drawn-copies.ts`). A row the grid edited is saved when it is
left -- by the keyboard or a press moving to another row, Tab past its
last editable cell, Enter -- through the form's own Save, said in the
form's pane and on the grid's line and the row's first cell, and stored
in the row in place with no page read again.

## Consequences

- **One draft, one truth.** The row and the form are the same answers, so
  nothing merges and the guard counts the row's typing as the form's. A
  save from either is the same create and update plan, route and outcomes
  (0015, 0029); the form's Save and the row's are each other's busy, and
  while the form's Save of a row the grid edited is out, another row asked
  for waits for its answer as it waits for the row's own. A row's state
  and a row waiting on its save are the form's they were set in -- its
  session, its record and the generation of its form -- so a form
  replaced while the save is out, by New, Load or the other renderer
  shown with its draft discarded, takes both with it: the row asked for
  is not opened by a later save, and the other renderer's form of the
  record starts with no mark.
- **The keyboard path is as before** -- arrows, Space, Enter, `=`, one Tab
  stop -- with F2 added. Typing a character starts nothing, since `=` is
  the filter's (0133) and a screen reader's quick keys would edit by
  accident; Delete and Backspace clear nothing. AG Grid's live region says
  "F2 edits it", or "F2 edits it in the record's form", after what Space
  and Enter do. Escape gives a cell's typing up and the row's state with
  it, so a row whose only typing in its cells was given up is not saved
  by leaving it. An editor keeps the keyboard while it is open: the
  renderer's error summary, which focuses itself when a first problem
  appears -- as a keystroke can make one once a save has touched every
  field -- gives it back, and the editor's description says the problem.
- **What it costs.** Every row entered by F2 is a read of the record before
  its editor opens, so an edit starts a beat after the key. Only the open
  row holds a draft: a row a save did not store is left only by mending it,
  by the form's Discard or Load the saved record, or through the guard. A
  row saved in place keeps its place until the page is read again -- a
  page turn, Ask again, a sort, a filter, the form's Save -- so a list
  sorted by the field just changed is out of order until then. A textarea,
  a time, a timestamp and a lookup are edited in the record's form; a date
  is typed as its canonical text; and a lookup changed in the form shows
  its token in the row until its save asks for its label. Under Both, the
  grid edits the React pane's draft alone and the Angular pane stays a
  draft of its own, as two panes are (0029). In Drill down every cell is
  edited in the form, the grid being hidden once a record opens there.
  Child sections' grids, Drill down levels and the together tab are not
  edited in cells, a new record is not a row (a later record's), and there
  is no copy and paste, fill or undo past Escape. While a cell is in edit
  the form's error summary holds the keyboard for a moment only, so a
  screen reader may begin to say it before the editor is said again; and
  a press on the summary's own region, not on one of its links, gives the
  keyboard back to the editor too. While the form's Save of a row the
  grid edited is out, the row does not say Saving…: the pane does.
- **What it forecloses.** A grid holding drafts of several records at once,
  each saved on its own: the guard would have to count rows, and a form
  open on one of them would be a second draft of it to keep apart.

## Alternatives considered

- **Each grid row a draft of its own**, the detail free to show another
  record, editing the row whose record is open with typing refused. It
  saves the read per row entered and allows several unsaved rows, for two
  drafts of one record to keep apart, a form stale after a grid save until
  read again, and per-row engines the guard must count. Lost to one draft
  and one truth by construction.
- **AG Grid's own editors and its value**, the row's data changed by AG
  Grid and sent from there. Its text editor would hold a numeric(18,4) as
  a JavaScript number where the form holds the stored spelling, its select
  would not offer the state field's moves, and the grid's data would be a
  second copy of the answers. The page's editors write into the engine
  instead, and `readOnlyEdit` keeps AG Grid writing nothing to a row.
- **A save on every cell**, as some spreadsheets do. A record is saved
  whole and guarded by its version (0015): a save per cell would be several
  versions of one record's change, each able to go stale against the last.
- **Reading the page again after a grid save**, as the form's Save does.
  The row would move under the keyboard wherever the sort follows the
  field, which is where the person is typing.
