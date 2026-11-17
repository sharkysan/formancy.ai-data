# 0162 — The host page runs an action from the open record's header, after its dialog and a confirmation in place, and reads the record again

- **Status:** accepted
- **Date:** 2026-11-17
- **Deciders:** Daniel Bacher
- **Verified by:** every jsdom case below was watched failing with its
  rule taken out, the file put back byte for byte, on 2026-11-17, on
  postgres:17-alpine and mcr.microsoft.com/mssql/server:2022-latest; the
  browser gate's checks as the last paragraph says.
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
  button unnamed).
  `apps/host/src/in-flight.test.tsx`, in both renderers -- while a run is
  out, a second press of Run it and the action asked again from the header
  send nothing, a press of the order's Save says it sent nothing, and the
  order closes once (watched failing with Run it sending again while the
  run was out: "expected { runs: 2, held: 2 } to deeply equal { runs: 1,
  held: 1 }"; and with the record's forms not held while it was out: the
  pane said "Saving…", the save sent beside the run); Run it waits for a
  save of the order out, says why, and then runs over the version that
  save stored (watched failing with Run it sent while the save was out:
  "expected 1 to be +0", a run sent).
  `apps/host/src/actions.test.tsx` -- once close ran, the order is read
  again into its panes, which show what the routine stored, and its next
  Save is stored, in both renderers (watched failing with the reread taken
  out: the panes still showed the order "open"; and, without the case's
  wait for them, the pane never said "Saved.", its save refused); a run
  whose answer was lost before it reached the database checks as not
  run -- opening another order before the check asks first, naming the
  run (watched failing with the run not the guard's: "expected null not
  to be null", no notice) -- and once it commits
  after all, Run it again names the version it sent and is stale, close
  kept once (watched failing with Run it again sending the version the
  order held then: no "Not run", the second run done); a run lost after it
  committed checks as changed and offers the saved record, never Run it
  again (watched failing with every check read as unchanged: no "It ran,
  or the record was changed since you read it.").
  `apps/host/src/running.test.ts`, pure -- the states in their order, the
  version heard as Run it is pressed, a check by the record's version, Run
  it again from the version sent and never after a change, and a refusal
  by a dialog field asking the dialog again with its sentence on the
  field, which no fixture's routine gives through the server (watched
  failing with every refusal answered as "Not run": "expected { …(2) } to
  match object { next: { state: 'asking' }, …(2) }").
  `apps/host/src/leave.test.ts` -- reading the record again after a run
  drops the record's own forms alone, and the guard says a run out and one
  that may have run in sentences of their own (watched failing with the
  reread dropping every form, as Load does: "expected [ 'master react',
  'lines react', …(3) ] to deeply equal [ 'master react' ]").
  `apps/host/scripts/browser-test.mjs` (`browser/acting.mjs`), in
  Chromium, Firefox and WebKit, CI's legs, at every width down to 320
  pixels -- no rule of host.css selects anything on the dialog's paper;
  the confirmation takes the keyboard, Keep it is the next Tab, Escape
  gives the keyboard back to the action's button, the frame stands at 3:1
  or more against the glass and the two answers one under the other on a
  phone; Enter on Run it closes the order with the keyboard on what the
  server did; and "Not run" says the deployment's reason as its own. In
  Chromium on 2026-11-17, at 320 pixels, with a rule of host.css added
  over the dialog's labels and Run it drawn before Keep it, the paper's
  check failed naming `.action-ask .sheet label`, the Tab's with "the
  focus is on button "Run it"", and the answers' order on a phone too;
  the rest are measured, not watched failing.

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
   - **running**: both answers say so and do nothing; the action asked
     again from the header is this run asked again.
   - **done**: the presentation's `done` sentence, or "Done.", in the
     room's teal for a moment (0146).
   - **Not run**: the server's sentence verbatim, a reason the deployment
     worded followed by "This reason is the database's own." (0156), and
     after a stale run, Load the saved record. An answer the server
     refused by a dialog field goes back to the dialog, its answers kept
     and the error on the field.
   - **It may have run**: below.

   Each new state takes the keyboard -- once the detail is shown where a
   layout hid it -- and Keep it and Close give it back to the action's
   button.
3. **Run it waits for a save of the record out**, says so and sends
   nothing, as Delete it does (0053): the save moves the version the run
   would name. The run names the newest version the detail heard as Run
   it is pressed. While the run is out, the record's forms hold: a press
   of Save sends nothing and says "An action on this record has not been
   answered yet; nothing was sent." A session's hold is now kept by what
   holds it -- a deletion or a run -- so the answer to one never lifts the
   other's.
4. **After done, the record is read again.** Its row is listed again, and
   the record read again into its own forms through the guard, as the
   request `ran` (`leave.ts`): it drops the record's own forms and nothing
   of its children or its rows, and what was typed into them while the
   run was out is asked about first. The run moved the version, and the
   routine may have changed the values, so a page that kept its read
   would make the person's next Save stale against a move they caused.
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
  which the confirmation lists. Kept editing when the read answers, the
  forms keep the version from before the run, and their next Save is
  stale.
- **A check is one read of the record**: on PostgreSQL a run orphaned by
  a cut may commit after it, which Run it again then meets as stale --
  the guard, not a second run -- and the person reads "Not run".
- **Only the open record's detail offers actions**: a child row and a
  Drill down level offer none, and no selection of records does (PR 8 of
  the design).
- **`refresh: list` adds nothing on this page**, which lists the record's
  row again after every run.
- **The detail's header grows a button per action**, wrapping on a phone
  beside Duplicate record and Delete record.

**What it does not do.** No preview the database words before the run, no
check routine before a write, no handler's steps (the design's phase 2
and section 8.3); the studio binds no action yet.

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

## Older records

Extended, not edited away: 0031 (a run whose answer was lost is checked
by one read of its record, and run again only from the version it sent);
0047 (the guard counts a run out or unknown as the record's work, and
reading the record again after a run drops its own forms alone); and
0161 (the host page offers an action's control, so the route left the
plane test's exception).
