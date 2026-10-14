# 0053 — A host deletes a record from its detail or its row, after a confirmation in place, and says what the server did

- **Status:** accepted; extended by [0058](0058-the-browser-gates-run-in-chromium-firefox-and-webkit-and-each-fact-the-browsers-disagree-on-is-named-and-held.md): its delete states in the host's browser gate run in Chromium, Firefox and Linux WebKit
- **Date:** 2026-10-13
- **Deciders:** Daniel Bacher
- **Verified by:**
  `apps/host/src/delete.test.tsx`, on both engines against the real
  server in both renderers -- Delete record is in the header of an open
  record and nowhere else, not on "No record open" or a new record, and the
  tags say Delete; an order line's detail and grid have a Delete on SQL
  Server, whose rowversion proves a line, and none on PostgreSQL, whose
  typed key does not (watched failing with the detail's button drawn
  whenever the form was open); the confirmation is a region in place under
  the header, an h4 under the detail's h3, named by its question "Delete
  Order k1:…?", focused and described by what the delete does and also
  does -- the order's lines with it -- the next Tab on Keep it and the one
  after on Delete it, and Escape and Keep it give the keyboard back to
  Delete record and send nothing (watched failing with the focus on Delete
  it); Delete it removes the record, empties the detail, puts the keyboard
  on Records and the grid says "Deleted Order k1:…." before its page
  (watched failing with the grid not asked again: the row stayed listed);
  in Separate views the records view comes back, says it there and adds no
  step to the history (watched failing with the sentence on the detail's
  line, which that view hides); a stale delete is "Not deleted" in the
  server's words, and after Load the saved record it deletes; a record
  another row refers to is "Not deleted" in the server's words, as its
  confirmation warned from `deleting.restricted`, and Close gives the
  keyboard back (watched failing with `restricted` left out of the lead); a delete that finds nothing is "Cannot find Order k1:…",
  never "Not deleted", and Close the record says "Closed" in the grid
  (watched failing with the 404 said as deleted); the forms of the record
  that hold work are listed in the confirmation, and one typed into while
  it waits is named before anything is sent (watched failing with the list
  taken once); while the deletion is out its region says "Deleting…" with
  both answers disabled, Save sends nothing and says why, and New record
  asks first, naming the deletion (watched failing with the forms left to
  save: the update went out beside the delete); discarded, the answer that
  comes after only takes the row from the grid and says so, the new record
  and the keyboard left where they are (watched failing with the discard
  keeping the page's track of it: the answer said nothing); while a save
  of the record is out Delete record is `aria-disabled`, described by why,
  and says so when pressed, and the record's row says so on its grid's
  line (watched failing with each wait taken out), and a save pressed
  while the question waits leaves its Delete it `aria-disabled`, described
  by why and sending nothing, until the save's answer, whose version it
  then deletes by (watched failing with Delete it unaware of the save: the
  delete went out beside the update and was refused as stale); after a
  pane's own Load the saved record Delete record names the version that
  pane loaded (watched failing with the version heard only when the detail
  opened or saved: refused as stale), and after a save the version the
  save was answered with, as a line saved on SQL Server does from its
  detail (watched failing with a save's answer not heard: each refused as
  stale); in Separate views an answer that comes while the records are
  shown brings the record view back, the keyboard on it, with no step in
  the history (watched failing with the view left as it was: "Not
  deleted" drawn in the hidden detail); another row's request closes the
  confirmation and deletes nothing (watched failing with the guard
  closing nothing); a line row's Delete closes the record's question and
  asks its own (watched failing with the other owner's question left
  open: both on the page); and on SQL Server a line is
  deleted from its own detail, its confirmation an h6 under the line's h5,
  and the keyboard goes to the section's h4, whose grid says so (watched
  failing with the question an h4); a line's stale delete loads the saved
  line, and its two Deletes wait for a save of it (watched failing with
  Load the saved record reading nothing).
  `delete-rows.test.tsx`, on both engines -- a row's Delete is a real
  button named "Delete Order k1:…", reached by the arrow keys as the row's
  last cell, ArrowLeft leaves it, and its Space asks in place under the
  grid, an h4 under the Records' h3, and opens no record (watched failing
  with the Space handed to the row: no question, the row opened, and the
  keyboard fell to the page); Escape
  gives the keyboard back to the row's Delete; Delete it deletes by the
  version the row was listed with -- the request is `{ record, version }`
  exactly -- and leaves the open record open (watched failing with the
  version left out: the server refused it); the open record's own row
  lists what its forms hold and empties the detail (watched failing with
  the row asked as another record's: nothing listed); a row's stale delete
  is "Not deleted" in the server's words, and Load the saved record opens
  the record and lists the page again, after which the row deletes
  (watched failing with the page not listed again: the row kept what it
  was listed with); a row's deletion of a record not open is its grid's
  work, so opening another row asks nothing about it, and its answer is
  said in the grid (watched failing with it counted as the open record's:
  the unsaved notice asked); a read answered while a row's question waits
  leaves the question and the keyboard there (watched failing with every
  ask of the guard closing it); Keep it after a search gives the keyboard
  to the row's Delete by its record, or to Records once the row is off the
  page (watched failing with it given back by the row's index: another
  record's Delete); in Separate views a row's answer that comes while the
  record is shown brings the records back (watched failing with the view
  left as it was); a delete that empties a page that is not the first
  shows the page before it, and says nothing of the empty one (P7, below;
  watched failing with the empty page's answer said: the sentence went
  with it, and the page before said only "Rows 1–50."); and on SQL Server
  a line row's Delete asks under the lines grid, an h5 under its
  section's h4 (watched failing with every question an h4, which axe's
  heading-order lets pass: it flags a level skipped downwards, never one
  too high, so the suites assert each level). `unknown-delete.test.tsx`, on both engines, the
  answer lost between the page and the real server -- lost after it was
  done, "It may have been deleted" in the client's words, and New record
  asks first; Enter twice on Check reads once and sends no delete, the
  keyboard then on the notice (watched failing with Check pressable while
  it read: two reads); gone is the not-found wording, and Close the record
  says "Closed"; lost before it was sent, still stored at the version sent,
  and Delete it again asks again with Keep it first and sends once
  (watched failing with Delete it again sending at once); changed since,
  Load the saved record opens what is stored. `deletion.test.ts` -- the
  states and their words: what the server's `deleting` makes the lead say,
  which version a row's delete and the detail's name, each answer's state,
  a check, and which states are work (watched failing with a 404 read as a
  refusal, with Delete it again sending, and with the row's version used
  for the open record).
  `leave.test.ts` -- a deletion is its owner's work and no renderer's
  (watched failing with a deletion dropped by every renderer request); one
  asked from a row not open is its grid's, which another row, New, Load and
  a record created leave and another form, Back or Forward and Sign out
  ask about, a child grid's going with its section but not with its own
  rows (watched failing with it the detail's work: a record created in New
  asked about it); and each kind of work in its sentence. `session.test.ts` -- a session held
  for its deletion sends nothing on a press, says so, and sends again once
  released (watched failing with the hold left out of Save).
  `operations.test.ts` -- every operation the server offers is
  tagged, delete included (watched failing with 0050's filter kept).
  `plane.test.tsx` -- the journey deletes the order it made, and now uses
  every runtime route, delete's included (watched failing with the delete
  left out of the journey). `page.test.tsx` -- axe at WCAG 2.2 AA and a name
  on every control in each state of a delete: the record's confirmation,
  and it waiting for a save, a row's, and on SQL Server a line's and its row's; "Not deleted"; "Cannot
  find"; closed; "It may have been deleted" before and after its check;
  deleted. `grid-keys.test.tsx`, now
  on a form that offers delete -- Delete and Backspace clear, send and ask
  nothing (watched failing with the Delete key mapped to the row's
  Delete: the confirmation opened). `apps/host/scripts/browser-test.mjs`,
  its delete states in `scripts/browser/deleting.mjs` -- in Chromium at
  every width the gate reads: the arrow keys reach a row's Delete as a
  button named for its record, Tab from it leaves the grid, Enter asks
  under the grid with the keyboard on the question, Escape gives it back;
  the record's confirmation takes the keyboard, the next Tab is Keep it,
  its frame against the glass at 3:1 or more, and its answers one under
  the other only on a phone; "Not deleted", "Cannot find", "It may have
  been deleted" before and after its check, and the keyboard on Records
  once the order is gone -- each state with no sideways scroll, nothing
  past an edge, and axe at WCAG 2.2 AA; End on a row now reaches its
  Delete, and Tab from there still leaves the grid in one stop (watched
  failing with the answers left beside each other at 320 pixels). `pnpm
  pictures --check` -- host-delete still shows a row's confirmation.
  **Not mechanically enforced:** that no screen reader announces a
  region twice.

## Context

0050 and 0051 serve a delete on the runtime plane, and 0047's workspace
had none: "No delete: no control, no route, no key", and its tags left out
the delete the server offered, with the route test holding the journey to
every route but delete's (0050). The person asked for delete after the
workspace ("Delete dann anschliessend"), and on 2026-10-11 decided where
it is offered -- in the open record's detail header and as an action on
each grid row, the master grid's and each child grid's, each behind the
same confirmation in place, and no Delete key -- and that afterwards the
keyboard goes to the heading of the grid the record was in.

What the pieces answered, read from their code and run in jsdom 30.1.2 and
Chromium through Playwright 1.63.0, on 2026-10-13:

- **0044's list rows carry their version.** Each row is what a read of its
  token returns, version included, so a row's delete names the version the
  page read when it listed the row, and nothing is read first. A form
  without a version offers no delete (0050), so a row it lists never asks.
- **AG Grid Community 36.2.0 hands the keyboard into a cell.** A key event
  from inside a cell is the cell's, so arrows on a button there move to
  the next cell; `hasBrowserFocus` counts focus on a descendant; and with
  `tabToNextCell` refusing every move, Tab from a descendant leaves the grid
  by its guards, as from the cell. A cell whose renderer moves the focus to
  its button when the cell is focused keeps AG Grid's navigation, and a
  button at `tabIndex` -1 is no Tab stop of its own. Its infinite row
  model draws every row at one height, each at its index times that
  height (`setRowTop(rowHeight * rowIndex)` in its `main.cjs.js`), whatever
  a row holds.
- **P7: a page emptied by a delete.** `purgeInfiniteCache` asks for the
  current page again; answered with no row at an offset past the first
  page, the row count falls to that offset, and AG Grid's pagination,
  recalculating, moves to the last page there is and asks for it -- with no
  step back of the page's own, the case still passed. The empty answer
  still reaches the datasource's callback first, and said, would spend the
  grid's sentence on a page nobody sees (delete-rows.test.tsx, both
  engines).
- **No rule of the host's reaches into a grid** (0047, the browser gate):
  a button in a cell is dressed by nothing on the page.

## Decision

**A host deletes one record from its detail or from its row, after a
confirmation in place that names it and says what the delete also does,
and says what the server did, in the grid it was in.**

- **Where.** Delete record in the open record's header, after the way back
  to its row; Delete <child> in a child row's header; and a last column,
  Delete, in every grid whose form offers this person delete, each row a
  real button named for its record ("Delete Order k1:1003"), an outline in
  `--invalid`, never a fill. Only where `operations` holds delete and
  `deleting` says what it does; never on a new record, never on a key: no
  Delete or Backspace deletes.
- **The row's button.** A cell AG Grid's arrow keys reach, which hands the
  keyboard to its button; `tabIndex` -1, so the grid stays one Tab stop;
  its Enter and Space are its own, and its click is not the row's, so it
  opens nothing. Dressed by its own style attribute in room variables,
  since no rule of host.css reaches into a grid.
- **The version.** A row's own, as it was listed (0044); the open record's
  is the newest the detail heard -- read with it, answered to a save of
  any of its panes, or opened by a pane's own Load the saved record -- as
  it is when Delete it is pressed, for its header and for its row.
- **The confirmation.** A focused region, no overlay, right under what
  asked: the header, or the grid. Its heading one level below what it is
  in -- h4 under the detail's or the Records' h3, h5 under a child section's
  h4, h6 under a child row's h5 -- naming the record: "Delete Order
  k1:1003?". Described by one sentence per fact, from `deleting` alone:
  removed for everyone and not brought back; with `cascades`, "Other
  records that refer to it are deleted with it."; with `clears`, that they
  lose that reference; with `restricted`, that the database may keep it.
  For the open record, the forms of it that hold work, as the guard would
  list them; typed into while it waits, named before anything is sent.
  Keep it, then Delete it, one under the other at 40rem or less; the next
  Tab is Keep it; Escape is Keep it, and gives the keyboard back -- to a
  row's Delete found by its record, or to the grid's heading once a search,
  a sort or a page has taken the row away. Another request the person
  makes closes it; an answer that asks the guard -- a read come back, a
  record created -- does not; asking another delete closes any other.
- **While it is out.** "Deleting…" in the region, both answers
  `aria-disabled`; the record's forms hold, and Save sends nothing and
  says "A deletion of this record has not been answered yet; nothing was
  sent."; the guard counts it as work, "a deletion the server has not
  answered yet." And while a save of the open record is out, its Delete
  waits for the answer, says why, and asks nothing; a confirmation asked
  before the save waits the same way, its Delete it `aria-disabled` and
  described by why.
- **Whose work.** A deletion of the open record is its detail's, which
  what replaces the record drops through the guard; one asked from a row
  not open there is its grid's: another row, New, Load and a record
  created leave it, and only another form, Back or Forward and Sign out
  ask about it -- a child grid's going with its section, as the section's
  forms do.
- **Separate views.** An answer that asks something of the person, coming
  while the view it is drawn in is hidden, shows that view, with no step
  in the history, and the keyboard goes to it.
- **Deleted.** The record gone from the page: an open one's detail emptied,
  in Separate views the records view without a step back; the grid asks
  for its page again and says "Deleted Order k1:1003." once, before its
  page's sentence, a page left empty stepping back to the one before; and
  the keyboard on that grid's heading.
- **Not found** (404): "Cannot find Order k1:1003" and that the form cannot
  find it any more, deleted or no longer one the person may see, with
  Close the record, which takes it from the page as Deleted does and says
  "Closed Order k1:1003." Never "Deleted", never "Not deleted".
- **Refused:** "Not deleted", the server's sentence verbatim, Close; a stale
  one also Load the saved record, which reads it again through the guard,
  as Load does, and lists the grid again.
- **Unknown** (0031): "It may have been deleted", its sentence, Check
  whether it was deleted -- which does nothing while it reads -- and then
  the keyboard on the notice, its status saying what the read showed:
  gone, the not-found wording with Close the record; still at the version
  sent, Delete it again, which asks again; changed, Load the saved
  record; unread, the read's sentence and that it is still unknown. Until
  then the guard counts it, "a deletion that may have been done, not yet
  checked."
- **Discarded** while out or unknown, the page stops showing it; an answer
  that it was deleted, arriving after, takes the row from its grid and says
  so there, and moves nothing. Any other answer that comes after, and
  whatever an unknown one came to, is not heard of again.

## Consequences

**What it buys.** A person deletes the record they see, from where they
see it -- its detail or its row -- on both engines, told before what the
delete also does and after what the server did, keyboard first, and
nothing of theirs is dropped unnamed.

**What it costs.**
- **Weight.** `vite build` on 2026-10-13, in this worktree with Vite
  8.3.3, on the sources this record describes: the workspace's chunk,
  `workspace-DWuv_6-o.js`, is 1,080.17 kB (308.83 kB gzipped), where 0047
  measured 1,064.05 kB (304.53 kB) in another worktree; not measured in
  one worktree before and after.
- **Two presses for every delete**, and four for a repeat after an unknown
  outcome: Delete it again asks again.
- **A 404 is never called deleted.** "Closed" is the most the page says of
  a record it cannot find, which may be one out of sight.
- **A row's delete is as old as its page.** A record changed since the
  page was listed is refused as stale until the page is listed again or
  the record is opened, whose newest version the row's Delete then names;
  Load the saved record does both.
- **One more column** in every grid of a form that offers delete, which a
  narrow window reaches by scrolling the grid, inside its own well.
- **A second way to dress a control.** The row's button carries a style
  attribute in room variables, which the palette guard reads in no
  stylesheet; a room colour that moved would move it, a new colour would
  not be caught.
- **The record's forms hold while a delete is out**, and a deletion
  discarded is heard of again only in its grid, and only if it was done:
  a refusal or a lost answer that comes after the discard is dropped, and
  so is an unknown deletion's outcome.
- **A view moves under the person** in Separate views: an answer that
  asks something of them shows the view it is drawn in, though they went
  to the other.
- **Load the saved record after a stale delete asks first**, through the
  guard, where a pane's own after a stale save discards without asking
  (0047): the region is the detail's, and does not list what Load drops.
- **The browser gate draws no child row's confirmation.** On PostgreSQL no
  child of the fixture's order offers delete (0050); jsdom holds it on SQL
  Server, Chromium does not.
- **The getting-started guide's form grants no delete.** The studio can
  grant it since 0052, but the guide does not have you do so: it does not
  delete on the page, and its job deletes over HTTP through a second form.

**What it forecloses.** Nothing the runtime plane offers: a host that
wants a bulk delete, an undo or another place for it calls the route
itself.

## Alternatives considered

**A native `<dialog>`.** The workspace has no overlay layer (UX-SPEC §2.4),
jsdom 30's `HTMLDialogElement` has no `showModal`, Escape or inert, and
axe's WCAG tags would not check its name.

**Focus on "Delete it"**, as 0031's "Allow saving it again" is. A delete
cannot be taken back, and the next Enter would make it.

**Focus on "Keep it".** The person would hear a button, not what is at
stake.

**"Delete it again" sending at once.** One stray key press from a second
delete.

**One h4 for every confirmation.** Under a child row's h5 it reads as a
sibling of the record's own sections, out of the row it asks about. axe's
`heading-order` lets it pass -- it flags a level skipped downwards, never
one too high -- so the suites assert each level.

**The Delete key on a row, or a toolbar Delete.** The person decided no
key; a toolbar Delete is the row's action in a second place, away from the
row it names.

**A row's delete that opens the record and deletes from its detail.** Two
steps for one, and it drops the open record -- through the guard -- to
delete another.

**Reading the record before a row's confirmation.** 0044's rows carry the
version the page read; a read would name a newer one than the person saw.

**The row's button dressed by host.css.** The browser gate fails any rule
of the host's that selects an element in a grid, and a class would be a
first one; AG Grid's theme parameters do not reach a custom cell's button.

**A confirmation inside the grid.** AG Grid Community draws a full-width
row (`isFullWidthRow`, `fullWidthCellRenderer`), but its infinite row
model draws every row at one height (above), and a question with its
sentences, its list and two buttons does not fit one; and inside the
grid's cell navigation, with Tab leaving the grid in one stop (0047),
Keep it would be an arrow key away, not the next Tab.

**Giving the keyboard back by the row's place.** A search, a sort or a
page moves the rows under a question that outlives them -- none of them
drops anything (0047) -- so the place may hold another record's Delete.

**Closing a row's question on a search, a sort or a page.** None of them
drops anything, and the question names its record whatever the grid
shows.

**A row's deletion as the open record's work.** Another row, New, Load or
a record created would ask about a deletion they leave alone, and Discard
would drop what its answer said.

**The answer on the visible half's status line** in Separate views, the
region kept for when its view comes back. The keyboard would stay where
nothing asks, and the region's answers -- Load the saved record, Check --
out of reach until the person went looking.

**Opening the neighbouring row after a delete.** It opens a record the
person did not choose (the person's decision of 2026-10-11).

**The sentence on the detail's status line.** In Separate views that line
is hidden once the records are shown.

## Older records

Narrowed, not edited away: 0047, whose **No delete** -- no control, no
route, no key -- now holds for keys alone: the workspace deletes from the
detail and from each row, its tags name delete, its guard counts a
deletion as work, and its route test holds the journey to every runtime
route. Extended: 0031 (an unknown deletion reaches the page, is checked by
a read and repeated only after asking again); 0050 (the host page sends the
delete, and the tags leave nothing out); 0051 (the page words its
confirmation from the `deleting` the policy's `cascades` decide).
