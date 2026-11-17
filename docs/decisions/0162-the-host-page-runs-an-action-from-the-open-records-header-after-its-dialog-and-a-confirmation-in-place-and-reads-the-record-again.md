# 0162 — The host page runs an action from the open record's header, after its dialog and a confirmation in place, and reads the record again

- **Status:** accepted
- **Date:** 2026-11-17
- **Deciders:** Daniel Bacher
- **Verified by:** every jsdom case below was watched failing with its
  rule taken out, the file put back byte for byte, on 2026-11-17, on
  postgres:17-alpine and mcr.microsoft.com/mssql/server:2022-latest; the
  browser gate's checks as the last paragraph says. Held by no test:
  `refresh: children` listing the sections' grids again, since no form
  of the actions schema has a child section; and that a child row's
  detail and a Drill down level offer no action, since no form with an
  action has either.
  `apps/host/src/plane.test.tsx` -- the whole journey, on both engines and
  through the live demo's path, now closes an order of the actions schema
  through its dialog and its confirmation, and the run's route left the
  set of routes the page may leave unsent (watched failing with the
  exception taken out before the page ran an action: "expected [ 'action'
  ] to deeply equal []" on every door); every request it sends is a route
  of the runtime plane with the token in its header alone, as before.
  `apps/host/src/page.test.tsx` -- every state of an action passes axe and
  names every control: its dialog drawn by React and by Angular, its
  confirmation, the confirmation with a save of the order out, the run
  out, done, "Not run" in the deployment's words and stale, and "It may
  have run" before and after its check; the confirmation takes the
  keyboard, is described by the sentence its presentation wrote, and the
  next Tab reaches Keep it, then Run it (watched failing with Run it drawn
  before Keep it: "expected 'Run it' to be 'Keep it'"; and with the
  dialog's Keep it drawn without its words: axe's button-name, and the
  button unnamed). It also presses Escape in the confirmation, reads
  done's description, finds Close on a check that found the order
  unchanged, and finds the keyboard on the region while Run it again is
  out -- rules watched failing in the suites below.
  `apps/host/src/in-flight.test.tsx`, in both renderers -- while a run is
  out, a second press of Run it and the action asked again from the header
  send nothing, the region taking the keyboard again when asked again, a
  press of the order's Save says it sent nothing, and the order closes
  once (watched failing with Run it sending again while the run was out:
  "expected { runs: 2, held: 2 } to deeply equal { runs: 1, held: 1 }";
  with the record's forms not held while it was out: the pane said
  "Saving…", the save sent beside the run; and with the region not
  focused when asked again: "expected 'Close the order' to be 'Close the
  order: Order k1:1?'"); Run it waits for a save of the order out, says
  why, and then runs over the version that save stored, the newest the
  detail heard as Run it is pressed (watched failing with Run it sent
  while the save was out: "expected 1 to be +0", a run sent); and Escape
  in the confirmation is Keep it, nothing sent, and nothing while the run
  is out (watched failing with the confirmation's Escape taken out:
  "expected 'Close the order: Order k1:5?' to be 'Close the order'"; and
  with Escape acting while the run was out: "Unable to find an accessible
  element with the role "region" and name "Close the order: Order
  k1:5?"").
  `apps/host/src/actions.test.tsx` -- once close ran, the order is read
  again into its panes, which show what the routine stored, and its next
  Save is stored, in both renderers, the region the keyboard lands on
  described by what the server did (watched failing with the reread taken
  out: the panes still showed the order "open"; and with the done region
  described by nothing: "expected '' to be 'The order is closed.'"); close
  answered while the guard asks about another order loaded meanwhile
  leaves the keyboard on that question, and its read waits for the
  person's answer -- kept editing, the panes hold what the routine stored
  and the next Save is stored, in both renderers (watched failing with
  the read dropped while the question waited: the panes still showed the
  order "open"; and with the region taking the keyboard as close
  answered: "expected 'Close the order: Order k1:3' to be 'Unsaved
  changes'"); until the order is read again, its Save sends nothing and
  says so, and a read refused is said, describes the region, and offers
  the saved record (watched failing with the forms let go as close
  answered: the pane never said the order was being read again, every
  status line of it empty); the question that read asks, replaced by
  another order loaded, lets the forms go, and that order's Save is stored
  (watched failing with the replaced question letting nothing go:
  "expected [] to have a length of 1 but got +0", the Save sent nothing);
  under Both the dialog is React's alone, the confirmation names a form
  typed into since it asked before anything is sent, focused again and
  clean under axe, and the read after close asks only about a form typed
  into while it ran, whose next Save, kept editing, is stale (watched
  failing with the confirmation not asked again: "expected 'It closes the
  order, and the database…' to contain 'Order k1:8, React: changes that
  are n…'"; and with what it listed asked about again: "expected 'Order
  k1:8, React: changes that are n…' to be 'Order k1:8, Angular: changes
  that are…'"); an action with no dialog starts at its confirmation, in
  the page's own sentence, and says "Done.", clean under axe (watched
  failing with the page's sentence left out: "expected '' to be 'It runs
  in the database, over this re…'"); a run whose answer was lost before it
  reached the database checks as not run -- opening another order before
  the check asks first, naming the run (watched failing with the run not
  the guard's: "expected null not to be null", no notice) -- and once it
  commits after all, Run it again names the version it sent and is stale,
  close kept once, the keyboard on the region while it is out (watched
  failing with Run it again sending the version the order held then: no
  "Not run", the second run done; and with the run again leaving the
  keyboard where Run it again was: "expected 'the page itself' to be
  'Close the order: Order k1:10?'"); a run lost after it committed checks
  as changed and offers the saved record, or Close, never Run it again
  (watched failing with every check read as unchanged: no "It ran, or the
  record was changed since you read it."; and with no Close there: "Unable
  to find an accessible element with the role "button" and name "Close"").
  `apps/host/src/running.test.ts`, pure -- the states in their order, the
  version Run it is given, a check by the record's version, Run it again
  from the version sent and never after a change, and a refusal by a
  dialog field asking the dialog again with its sentence on the field,
  which no fixture's routine gives through the server (watched failing
  with every refusal answered as "Not run": "expected { …(2) } to match
  object { next: { state: 'asking' }, …(2) }"); the action asked again
  while its dialog asks keeps that dialog (watched failing with a dialog
  asked again built anew: "expected { schema: [Function schema], …(27) }
  to be { schema: [Function schema], …(27) } // Object.is equality"); and
  the run out carries what its confirmation listed, a run again none
  (watched failing with the run out carrying nothing: "expected { state:
  'sending', …(5) } to match object { state: 'sending', …(1) }"). That a
  press of Run it again while its run is out sends nothing is a guard in
  `action-flow.ts` that no case reaches: the button is gone before a
  second press can land.
  `apps/host/src/leave.test.ts` -- reading the record again after a run
  drops the record's own forms alone, never its deletion, and asks about
  none its confirmation listed; and the guard says a run out and one that
  may have run in sentences of their own (watched failing with the reread
  dropping every form, as Load does: "expected [ 'master react', 'lines
  react', …(3) ] to deeply equal [ 'master react' ]"; with the deletion
  dropped too: "expected [ 'master react', …(2) ] to deeply equal [
  'master react', 'master angular' ]"; and with nothing agreed spared:
  "expected [ 'master react', 'master angular' ] to deeply equal [ 'master
  angular' ]").
  `apps/host/src/session.test.ts` -- a session held by a deletion and by
  an action is let go by each apart (watched failing with one hold for
  both: "expected { kind: 'saved', message: 'Saved.' } to deeply equal {
  kind: 'held', …(1) }").
  `apps/host/scripts/browser-test.mjs` (`browser/acting.mjs`), in
  Chromium, Firefox and WebKit, CI's legs, at every width down to 320
  pixels -- no rule of host.css selects anything on the dialog's paper;
  Escape there gives the keyboard back to the action's button; the
  confirmation takes the keyboard, Keep it is the next Tab, the frame
  stands at 3:1 or more against the glass, the two answers stand one under
  the other on a phone, and Escape there gives the keyboard back to the
  action with the order still open; Enter on Run it closes the order with
  the keyboard on what the server did; and "Not run" says the deployment's
  reason as its own. In Chromium on 2026-11-17, at 320 pixels, with a rule
  of host.css added over the dialog's labels and Run it drawn before Keep
  it, the paper's check failed naming `.action-ask .sheet label`, the
  Tab's with "the focus is on button "Run it"", and the answers' order on
  a phone too; the rest are measured, not watched failing. The run out, a
  stale run and "It may have run" are the jsdom suites', not the gate's.

## Context

0159 bound a routine to a form as an action, 0160 ran it over the open
record in both adapters, and 0161 served the actions a person may run in
`PublishedForm.actions` and ran one through `POST
/v1/forms/:id/actions/:action/run` and `runAction` -- and nothing on the
host page called it: `plane.test.tsx` held the route out of the set the
page must send until it had a control (0161). The design's section 8
decided that a page draws an action's dialog and then its confirmation
from what it is served, and sends one run; the server keeps nothing
between them, and asks for no proof that a confirmation was shown. Its
section 12 put record actions in the detail's header, beside Delete and
Duplicate, their region in place under it as a delete's is (0053), and
said what the page does after a run and after a lost answer.

## Decision

1. **The detail's header offers each action the server serves**, one
   button each, named by its label, on an open record
   (`apps/host/src/action-region.tsx`): `PublishedForm.actions` is the
   whole list, so an action this person may not run, or one drift stops,
   is never drawn. The open record's detail alone: a child row's detail
   and a Drill down level below it offer none.
2. **Its region is in place under the header, with no overlay** -- 0053's
   pattern -- and goes through `apps/host/src/running.ts`'s states,
   which `action-flow.ts` runs against the server:
   - **asking**: the dialog as served, drawn by the renderer the person
     chose to show -- React where both are shown -- on white paper in
     Blueprint, its submit Continue; no rule of the host's reaches the
     paper. An action with no dialog starts at its confirmation.
   - **confirming**: always asked, even where the administrator wrote no
     sentence, which the page's own then replaces -- "It runs in the
     database, over this record. This page cannot take it back." --
     focused, described by that sentence and by the record's forms that
     hold work, which reading the record again drops, listed as a delete
     lists them; the next Tab reaches Keep it, never the button that
     runs, and Escape is Keep it. Typed into since it asked, the list is
     said again before anything is sent.
   - **running**: both answers say so and do nothing, and so does
     Escape; the action asked again from the header is this run asked
     again, its region focused again. The same action asked again while
     its dialog asks keeps what was typed into it.
   - **done**: the presentation's `done` sentence, or "Done.", in the
     room's teal for a moment (0146), describing the region the keyboard
     is taken to, so it is said as it lands.
   - **Not run**: the server's sentence verbatim, a reason the deployment
     worded followed by "This reason is the database's own." (0156), and
     after a stale run, Load the saved record. An answer the server
     refused by a dialog field goes back to the dialog, its answers kept
     and the error on the field.
   - **It may have run**: below.

   Each new state takes the keyboard -- once the detail is shown where a
   layout hid it, and unless the guard is asking the person something
   meanwhile, which keeps it -- and Keep it and Close give it back to the
   action's button. Run it again is a new state too, so its run out takes
   the keyboard where the button was.
3. **Run it waits for a save of the record out**, says so and sends
   nothing, as Delete it does (0053): the save moves the version the run
   would name. The run names the newest version the detail heard as Run
   it is pressed. While the run is out, the record's forms hold: a press
   of Save sends nothing and says "An action on this record has not been
   answered yet; nothing was sent." A session's hold is now kept by what
   holds it -- a deletion or a run -- so the answer to one never lifts the
   other's. Run it again does not wait for a save out: it names the
   version the lost run sent, so whichever of it and the save is sent
   second is refused as stale, and nothing is written twice.
4. **After done, the record is read again.** Its row is listed again, and
   the record read again into its own forms through the guard, as the
   request `ran` (`leave.ts`): it drops the record's own forms and nothing
   of its children, its rows or its deletion. What the confirmation
   listed, the person agreed to drop when they ran it, so it is not asked
   about again; a form that holds work only since is asked about first.
   Until the read has opened, been refused, been kept from or had its
   question replaced by another request, the record's forms still send
   nothing on Save, and say "The record is being read again after an
   action ran on it; nothing was sent." A question
   the guard asks meanwhile about something else -- another row the
   person asked for while the run was out -- keeps the keyboard and does
   not drop the read, which waits for the person's answer and opens
   unless that answer moved the detail on (`opening.ts`). A read refused
   is said in the region, which then offers the saved record. The run
   moved the version, and the routine may have changed the values, so a
   page that kept its read would make the person's next Save stale
   against a move they caused.
   `done` carries tokens, not versions, since a routine may move a
   version after the run did (0161); the read gives the right one. An
   action whose `refresh` names `children` lists the grids of the
   record's sections again too; `list` is the records grid, which the
   record's row already lists again.
5. **A run whose answer was lost** is "It may have run" with the
   sentence the client or the server gave, and Check whether it ran,
   which reads the record once (0031), a second press while it reads
   sending nothing:
   - at the version the run sent: "The database shows it has not run",
     and **Run it again**, which sends that version and the same answers
     -- never a version read since -- with no second confirmation: if the
     first committed after all, as a PostgreSQL transaction orphaned by a
     cut can (0031: `unchanged` is not visible yet), the second is stale;
   - at another version: it ran, or the record was changed since, and
     Load the saved record -- no run again;
   - not found: said, and Close;
   - the read refused: its sentence, still unknown, and Check again.

   There is no "Run it again anyway": a run can always be checked.
6. **The guard counts a run** out, or one that may have run and is not
   checked, as the open record's work (0047): `running` and `run-unknown`,
   said "an action the server has not answered yet." and "an action that
   may have run, not yet checked." What drops the record asks first, and
   Discard drops the page's track of the run, whose answer is then heard
   by nobody. A dialog's answers are not work: another request closes the
   region and drops them, as it closes a delete's confirmation.

## Consequences

**What it buys.** A person runs an administrator's action from the
record they have open, in either renderer, its dialog drawn by the same
renderer as their forms, with the same confirmation a delete asks, a
lost answer checked rather than guessed, and a next Save that is not
stale because of their own run.

**What it costs.**

- **Every run asks first.** One press more than a button that runs, even
  for an action whose administrator wrote no confirmation; an action with
  a dialog is two steps, the dialog and then the confirmation.
- **Under Both, the dialog is React's.** Angular draws it only where it
  is the renderer shown alone.
- **A dialog's answers are dropped without asking** by any request of the
  person's -- another row, a layout, a renderer -- as a delete's question
  is closed.
- **Reading the record again drops what its forms held** before the run,
  which the confirmation lists, without asking again. Kept editing when
  the read asks about a form typed into since, the forms keep the version
  from before the run, and their next Save is stale. Until the read
  answers, a Save sends nothing.
- **A check is one read of the record**: on PostgreSQL a run orphaned by
  a cut may commit after it, which Run it again then meets as stale --
  the guard, not a second run -- and the person reads "Not run".
- **Only the open record's detail offers actions**: a child row and a
  Drill down level offer none, and no selection of records does (PR 8 of
  the design).
- **`refresh: list` adds nothing on this page**, which lists the record's
  row again after every run; `refresh: children` is held by no test.
- **The detail's header grows a button per action**, wrapping on a phone
  beside Duplicate record and Delete record.

**What it does not do.** No preview the database words before the run, no
check routine before a write, no handler's steps (the design's phase 2
and section 8.3). Binding a routine as an action in the studio is
[0163](0163-the-studio-binds-a-routine-as-an-action-offering-each-parameter-only-what-the-generator-binds-and-says-what-it-does-before-it-is-granted.md)'s.

**Forecloses:** nothing.

## Alternatives considered

**Run at once where the administrator wrote no confirmation.** Lost: the
run moves the version and reads the record again, dropping what was
typed, and the confirmation is where that is named; Run it's wait for a
save out needs a place to say so too.

**One step: the dialog's submit is Run it.** Lost: Keep it is the next
Tab from the focused region, before the button that runs, so with the
dialog's fields between them either Keep it comes before the questions
or the button that runs is met before Keep it.

**Draw the dialog in both renderers under Both**, as the record's forms
are. Lost: two dialogs for one run, whose answers could differ, and two
Continues.

**Run it again from the version a check, or a read before the press,
finds.** Lost: a first run that commits after the check would run a
second time, which the version sent refuses as stale.

**Leave the reread to the person**, through Load the saved record. Lost:
the person's next Save would be stale against a move they caused, and
the panes would show values the routine changed as they were.

**One hold slot for the session, as the delete had.** Lost: a run
answered while a deletion of the record is out would lift the deletion's
hold, and a save could race the delete.

**Drop the read after a run when the guard is asking, as a read the
person asked for is dropped.** Lost: a person who then keeps editing
holds the record at the version from before their own run, and their
next Save is stale, with nothing on the page saying so.

**Ask about the forms the confirmation listed when the read answers.**
Lost: the person is asked twice for one decision, and the natural answer
the second time, Keep editing, leaves their next Save stale.

## Older records

Extended, not edited away: 0031 (a run whose answer was lost is checked
by one read of its record, and run again only from the version it sent);
0047 (the guard counts a run out or unknown as the record's work, and
reading the record again after a run drops its own forms alone); 0053
(the session's hold for a deletion is kept apart from an action's, so
the answer to one never lifts the other's); and 0161 (the host page
offers an action's control, so the route left the plane test's
exception).
