# 0047 — A host's workspace lists, opens and edits records in linked grids, on the runtime plane alone

- **Status:** accepted; extended by [0050](0050-a-record-is-deleted-one-at-a-time-by-its-token-and-the-version-its-person-read.md): the open form's tags leave out the delete the server offers, and the route test holds the journey to every runtime route but the delete route, which the page sends from 0053; narrowed by [0053](0053-a-host-deletes-a-record-from-its-detail-or-its-row-after-a-confirmation-in-place.md): its **No delete** holds for keys alone -- the open record's detail and each grid row offer a delete behind a confirmation in place, the tags name delete, the guard counts a deletion out or unknown as work, and the route test holds the journey to every runtime route, delete's included
- **Date:** 2026-10-11
- **Deciders:** Daniel Bacher
- **Verified by:**
  `apps/host/src/workspace.test.tsx`, on both engines against the real
  server -- Forms holds the forms the clerk may read by title and id, and
  choosing one puts the keyboard on its heading, which names main; the
  Records grid holds tenant 1's orders and not tenant 2's; Space on a row
  opens it beside the grid and leaves the keyboard in it, Space on the open
  row leaves it open and selected, and Enter moves the keyboard to the
  record (watched failing with AG Grid's own selection -- click selection
  on and Space left to the grid: Space deselected the open row); a draft
  makes another row wait for the person, Keep editing gives the keyboard
  back to the grid and Discard and continue opens the row and says so; the
  search hint names the server's `searchable` fields by their labels, a
  search narrows the grid and sends its words in the body, a search that
  matches nothing says so with the words and Clear search lists every
  record again with the keyboard on the box (watched failing with the hint
  naming every column, and with the no-match sentence never said); a
  sortable header sorts in the server and an unsortable one has no sort
  (watched failing with every column sortable); Next and Previous ask for
  offsets 50 and 0 and the line says "Rows 51–53." and "Rows 1–50; more
  follow." (watched failing with AG Grid's default cache, which answered
  Previous from memory and left the line at 51–53); a refused list is the
  server's sentence, none of AG Grid's words, and Ask again lists again
  (watched failing with the sentence reworded); Separate views opens the
  record view on Enter, the address names the view and never the record,
  and Back to the records puts the keyboard on the open row's cell, or on
  the Records heading with "Record k1:… is not on this page." when a
  search moved it off (watched failing with the row not looked for).
  `leaving.test.tsx`, on both engines -- New record, Load, another form,
  Sign out, another child row and New Order line each ask before dropping
  a draft, and so does hiding a renderer; Escape and Keep editing change
  nothing and give the keyboard back to what asked, and Discard and
  continue carries the request out, a child row's included (watched
  failing with the Forms link opening the other form directly, the
  renderer switch hiding a pane without asking, and a child row opened
  over a child draft); work typed into another form while the notice
  waits is named before Discard drops it (watched failing: Discard dropped
  the React draft the notice never listed). `races.test.tsx`, on both
  engines, with the answers held between the page and the real server --
  a row's read answered after New record was pressed and typed into opens
  nothing over the draft, and so does a child row's after New Order line;
  work typed while a row's read was out is asked about before the row
  opens; a form's definition refused after another form was chosen and
  typed into changes nothing, so main, Forms and the address name the
  form chosen last (each watched failing: the late answer opened the row
  over the draft without a question, and the refusal replaced the chosen
  form while its link kept `aria-current`), while a refusal for the form
  still chosen is said in main (watched failing with every refusal
  dropped); and a record created in one
  of two panes asks before the other drops its draft, Keep editing moves
  nothing, a pane with nothing typed follows without a question and the
  children are the created record's, and Discard opens it in the other
  pane (watched failing: React's create moved the heading on over
  Angular's draft without a question). `address.test.tsx`, on both
  engines -- no address the page writes holds a record token, with a
  record opened from the grid, loaded by its token, created, and in the
  record view of Separate views (watched failing with the token written
  into the fragment); arriving with a fragment opens its form after
  sign-in only when the menu names it, a form it does not name is never
  asked for, and a record token pasted into it does not stay (watched
  failing with the menu check removed: the page kept `pg-order-secret` in
  the address); Enter on the skip link puts the keyboard on main and
  leaves the address, the history and a draft as they were (watched
  failing with the link's click handler removed: the keyboard stayed on
  the link); Back over a draft asks, Keep editing goes forward again so
  the address is as it was and Back asks again, Discard and continue
  opens the earlier form, and Forward over a draft there asks the same way
  (watched failing against Keep editing that wrote the page's state over
  the entry Back had reached: the second Back went to the arrival entry
  and asked nothing); Back and Forward move between the views of
  Separate views, the keyboard going where the views' own buttons send it
  (watched failing: Back to the records view wrote an entry of its own,
  which dropped the one Forward goes to); Back onto an entry an earlier
  sign-in wrote is asked about as an address, Keep editing puts the
  page's own back, and one that names no form is written over (watched
  failing with one count for every sign-in: Back was "Going forward" and
  Keep editing left an address naming no form); and a row clicked while
  Back waits puts the address back before it asks (watched failing: the
  address kept naming the form Back had reached); a fragment typed into
  the address bar asks as Back does, Keep editing writes the page's own
  address over it and Discard opens its form, and Forward after Back while
  the notice waits answers the question (watched failing with the typed
  address left under the open form, and with the notice left up).
  `choices.test.tsx`, on both engines -- the record is drawn by React until
  the viewer chooses, Angular alone draws Angular's, Both draws the two,
  and the choice is there when the page is opened again; the separator is
  named by the records, at 55 until moved, steps by five with the arrows,
  goes to its limits with Home and End, is kept, and is not drawn in
  Stacked (watched failing with Both as the default, and with the split
  not kept). `children.test.tsx`, on both engines -- the order's lines grid
  holds the open order's lines only, without the order column (watched
  failing without the list's `parent`: "Order line rows 1–4." where two
  were the order's); a new line is preset with the order, drawn disabled,
  created under it and shown in the grid, and a line is opened and saved
  in its own form, in each renderer; under a new order the lines grid is
  not drawn and New Order line says why; an employee with its own form as
  a child through the manager and the order form twice, through who
  created and who approved, open at once with a row open in each of the
  three, mints no element id twice and passes axe with a name on every
  control, and the order form this clerk may only read draws its fields
  disabled (watched failing with the child sessions in the record's
  namespace: the child's Name label named the record's own input; and
  with the two order sections in one namespace: the approved order's
  Amount label named the created one's input). `unknown-child.test.tsx`,
  on both engines -- a line whose real insert the test plane ran and then
  answered `unknown-outcome` in place of the adapter's answer checks as
  `present`, by the key the person typed, and one it answered so without
  inserting checks as `absent`, after which Save stores it once (watched
  failing with the answer lost between the page and the server instead:
  the page never hears which record the server would have made, and
  checks as unverifiable); the loss is made up around a real write, and
  that a dropped connection makes the adapters say `unknown-outcome` is
  data-server's `e2e-lost-answer.integration.test.ts`.
  `grid-keys.test.tsx`, on both engines -- Delete and Backspace clear no
  cell and send nothing, and Alt with an arrow resizes no column (watched
  failing with Delete turned into a request, and with the columns
  resizable: a header grew from 92 to 96 pixels); and the grid writes
  nothing on the console (it failed for real: AG Grid's "error #200" for
  `localeText` without `LocaleModule`, which the module list now holds).
  `split.test.tsx` -- a drag the browser cancels, or whose capture is
  lost, moves and keeps nothing after it (watched failing: the move and
  the release after the cancel were both acted on).
  `plane.test.tsx`, on both engines -- every request of a whole journey
  through the workspace is a route of the server's `ROUTE_OPERATIONS`, read
  from the package, the journey uses every one, each carries the token in
  its header and in no URL or body, no body names a tenant, and only forms
  the menu named are asked for (watched failing with one stray
  `/v1/whoami`, and with a form id the menu did not name).
  `page.test.tsx` -- signed in with no form open, a form's records, a
  record with its lines, a line open, the unsaved notice, Separate views
  and a refused list each pass axe at WCAG 2.2 AA with a name on every
  control, the grids and the separator included (watched failing with the
  separator unnamed); the token is in no storage, which holds the viewer's
  two choices and nothing else. `session-work.test.ts` -- a form holds no
  work when opened, a change when typed into and none when typed back,
  `discard()` opens it as it was, a preset parent is not the person's work,
  a child's parent field is disabled on the page's copy and so is every
  field of a record the person may not update (watched failing with no
  answers taken when the form opened, which counted every opened form as
  changed). `session.test.ts` -- a save still out is work, and after it is
  answered only what was typed meanwhile, the stored spelling included
  (watched failing with the answers saved not taken as the form's, and
  with a save out not counted); what another pane opens after a create is
  the record as stored, not what was typed since (watched failing with the
  form's answers handed over); a save whose answer was lost is work until
  it is discarded, which lifts its hold. `leave.test.ts`,
  `layout.test.ts`, `prefs.test.ts`, `grid-datasource.test.ts`,
  `widgets.test.ts` -- the table of what each request drops, a record
  created in one pane dropping the others and never the one that created
  it (watched failing with a guard that asked about the record's forms
  only: 8 of the 17 cases; and with the creating pane listed), the
  address read and written, a key it does not know, a value it does not
  read and a key said twice asking for nothing (watched failing with the
  menu check removed, and with every value taken as written), the choices
  kept and storage that throws (watched failing without the reads
  wrapped), a grid's sentences and requests (watched failing with the
  no-match sentence never said and the parent column kept), and a
  disabled rule added once (watched failing with it added twice).
  `grid-theme.test.ts` -- every colour parameter is a room variable or a
  mix of parameters that are, the focused cell's border and a header's
  ring are `--server`, and no stylesheet under `src/`, `host.css`
  included, names an AG Grid class or property (watched failing with a
  literal header colour, without `rangeSelectionBorderColor`, and with a
  `.grid-bench .ag-cell` rule in `styles/records.css` and in `host.css`). `grid-pin.test.ts` -- both AG Grid
  packages exact and equal, installed as pinned, and no Enterprise package
  (watched failing with `^36.2.0`). `in-flight.test.tsx`,
  `journey.test.tsx`, `stale.test.tsx`, `problems.test.tsx`,
  `guide.test.tsx` and `temporal-round-trip-page.test.ts`, as 0029, 0031
  and 0040 describe them, through the workspace: New while a create is out
  now passes through the notice and still hears the replaced form's answer.
  `apps/host/scripts/browser-test.mjs` (`pnpm test:browser`, its modules in
  `scripts/browser/`) -- in Chromium against the real server on PostgreSQL,
  at 320 (also with the web fonts refused), 360, one past each breakpoint
  and 1440, in each state of the workspace and the record's journey: no
  sideways scroll and nothing past either edge outside a grid's well, the
  well itself inside the window (watched failing at 320 when the Layout
  options ran 5 pixels into the page's scrollbar gutter); axe at WCAG 2.2
  AA, and what it leaves undecided inside a grid decided on the pixels
  Chromium painted, at 4.5:1 or more; the focused cell's teal border at
  3:1 or more on the open row and on another (watched failing with
  `rangeSelectionBorderColor` set to the open row's own tint: 1:1 on the
  open row, 1.53:1 on another), and the open row's bar against its tint;
  Shift and an arrow on a header moves no column (watched failing with
  the columns movable: Customer and Order date swapped -- jsdom cannot
  show it, as AG Grid moves a header by where it is drawn); Tab into a
  grid on the open row and out of it in one stop, End on the last column
  in view; a pointer dragging the separator
  moves it within its limits and keeps it, and letting it go fits the
  columns to the rows shown: a group longer than its column, given to the
  run's order beside the page and found by a search, is cut before and
  whole after (watched failing with the sizing on release removed: cut
  before and after, at each width that draws the separator); the keyboard on Forms, on the
  form's heading, on the record after Enter, on the notice and back on
  New record after Keep editing, on its radio after a layout change, and
  on the open row after Back to the records; no rule of `host.css` selects
  anything in either paper or either grid; and an `@media` condition other
  than a `max-width` in rem stops the gate before it measures (watched
  failing with a `min-width: 90rem` rule, which the gate named and stopped
  on). `pnpm
  pictures --check`, in the same job -- the host's scenes, the workspace
  among them, still say what their pictures were taken saying.
  `scripts/palette.test.mjs` -- the room's palette, which the grid's theme
  reads, is the admin's.
  **Not mechanically enforced:** what the workspace costs a page to load,
  measured once below and held by nothing; that the order lines' tenant
  rule restates the order's, which 0043 says nothing checks.

## Context

Since 0029 the host page drew one published form, named by id in a text
field, in both renderers side by side, and a record was opened by pasting
its token. The runtime plane now lists the forms a person may read, with
the children under each (0045), and a form's records a page at a time
under its read policy (0044), each row what a read of its token returns;
a child's rows are reached only through a parent its policy admits
(0043). Nothing drew them.

The person asked for a master and its detail with AG Grid and a search, a
menu to choose the tables from, master and detail on one page or apart,
and no delete. They chose AG Grid Community, which is MIT-licensed: its
master/detail rows are Enterprise, under a commercial licence this
module does not hold, so master and detail are linked grids. On
2026-10-10, having used a clickable prototype, they decided two things
more: a switch that draws the record in React, Angular or both, React by
default, only the chosen one mounted; and a split between the records and
the record that a person can drag or move with the keyboard, 55 to 45 by
default, kept for that viewer in their browser like the renderer choice.

What AG Grid Community 36.2.0 does, read from its code and run in jsdom
and Chromium: Space on a row toggles its selection, so a grid that drove
the detail would close the open record on Space; a cell's key event is
reported to the page even when the grid is told to leave the key alone;
the focused cell is drawn by `rangeSelectionBorderColor`, which follows
the accent unless set; its overlays and loading cells speak words of its
own; and every grid API the page calls belongs to a module that must be
registered, or the grid writes "error #200" and ignores the call.

## Decision

`apps/host` is a host application's workspace over the runtime plane,
through `@formancy/data-client` alone.

- **Signed out**, a host token and Sign in, which asks for the menu
  (`GET /v1/forms`). The form id field goes: Forms replaces it.
- **Forms**, a sidebar on a wide window and a row of tabs on a narrower
  one: each form the menu names, by title and id, its link carrying the
  form's address and a click going through the guard below.
- **The open form**: its heading, which names main, its operations as
  tags, and the Layout -- Side by side, Stacked or Separate views; then the
  Records panel and the detail.
- **The Records panel**: New record when the person may create; the
  search, submitted with Search or Enter and never per keystroke, its
  hint naming the fields the server's `list.searchable` names; the pager,
  Previous rows and Next rows, `aria-disabled` and never `disabled`; and
  the grid. A status line says what the page's numbers say -- "Rows 51–100;
  more follow.", "No records match “Zug”." with Clear search, the server's
  refusal verbatim with Ask again -- and nothing of AG Grid's words is
  shown: its overlays are off and its loading cells empty.
- **The grid**: AG Grid Community, `ag-grid-community` and `ag-grid-react`
  pinned exactly and equal, its modules listed (infinite row model,
  pagination, row selection, render, scroll and row APIs, column
  auto-size, locale) and no other. One block of `LIST_PAGE_SIZE` rows is
  one `records/list` request, its sort AG Grid's sort model and its offset
  the block's start, then one `lookups/:source/resolve` per lookup column
  for the labels; a block no longer shown is asked for again, never kept
  (0022, 0029). Every readable field is a column, sortable where the
  server says, sized to its content: to the first page that has rows, so
  paging never makes a column jump, and again to the rows shown each time
  the separator is let go; no cell is editable, no column is moved or
  resized by hand, and Tab and Shift+Tab leave the grid.
- **Which row is open is the page's.** Click selection is off; Space and
  Enter are held from AG Grid on every cell and handled by the page;
  after every page the grid's selection is set from the open record, so
  `aria-selected` and a violet bar in the first cell say what the detail
  shows, and Space on the open row changes nothing. A click or Space
  opens a row and leaves the keyboard in the grid; Enter opens it and
  moves the keyboard to the record, in Separate views to the record view.
- **The detail**: the record's heading, Go to its row (Back to the records
  in Separate views), a status line, the renderer switch, Open by record
  token -- a disclosure that opens itself when a Load is refused -- and
  the record's form in the renderers chosen, each with a session of its
  own as in 0029. Only the chosen renderer's form is mounted; Both draws
  them side by side where two papers fit and stacked where they do not.
  A form this person may only read is drawn with every field disabled on
  the page's copy, presentation only: the server refuses the update.
- **Children**: below the record, one section per child the menu names
  whose list the server offers now, its grid listed with `parent: { field,
  record }` and the parent's column left out, and, once a row is opened
  or New is pressed, the child row's forms on a rail. A new child row is
  preset with the open record, whose field is drawn disabled, and a child
  of a record not saved yet says its rows come once it is. A child's
  sessions are namespaced `<child form>~<field>`, so a form that is its
  own child, or one form twice, never mints one element id twice.
- **One guard over every way of leaving a form** (`leave.ts`). A request
  that would drop a form holding work -- answers changed since it was
  opened or saved, a save still out, or a save whose outcome is unknown --
  waits behind a focused "Unsaved changes" notice that names what was
  asked for and each form with what it holds. Another row, New record,
  Load, another form, Back or Forward and Sign out drop the record and its
  children; a child row or a new one, that child's forms; hiding a
  renderer, its forms everywhere. A layout or view change, a page, a
  search and a sort drop nothing: every lane stays mounted. Keep editing
  -- or Escape -- changes nothing and gives the keyboard back, and after
  Back or Forward goes the other way again; Discard and continue drops the
  work and carries the request out, after naming any typed while the
  notice waited. A second request replaces the first, and undoes what the
  first already did: Back's move of the address. 0031's rule stands: Load
  and New clear a hold, and now the page asks first.
- **What arrives late is not opened over the person's work**
  (`opening.ts`). A record's read, the record's or a child row's, is
  dropped when the detail was asked for something else meanwhile -- New,
  another row, Load -- or when the page waits for the person about another
  request; otherwise the guard is asked again when it answers, so work
  typed while it was out is asked about first. A form's definition
  answered after another form was chosen is dropped, a refusal included.
- **A record created in one pane is the detail's.** Every other pane of
  the record -- or of the child row -- is opened on it as stored, so the
  heading, the panes and the children name one record; a pane holding
  work of its own is asked about first, and kept editing, nothing moves.
- **The address** is `#form=<id>&layout=<layout>&view=<view>` and never a
  record: a record token spells its key (0023), and an address goes into a
  history a browser may sync. A reload opens the form and its layout, a
  fragment's form only when the menu names it, and the page's own address
  goes over the one it arrived on. Choosing a form and changing the view
  in Separate views push an entry, a layout change replaces it, and the
  skip link moves the keyboard to main without navigating. Each entry the
  page writes is marked with its sign-in's count and its number in it, so
  Back and Forward know their direction; an entry an earlier sign-in wrote,
  which Sign out and a reload leave in the history, is asked about as an
  address is, and taking it over starts a new count.
- **What the browser keeps** is the viewer's renderer choice and split, in
  `localStorage`, every read and write wrapped, the page working without
  either. Nothing else: the token stays in the client's closure.
- **The room.** The grid is recoloured only through its theme's
  parameters, each a room variable or a mix of them: the ground opaque,
  the header a 4% mix, the open row a 30% violet tint with its bar, the
  focused cell's border and a focused header's ring teal. No stylesheet
  of the host's names an AG Grid class or property, and none reaches into
  a grid's well or onto a paper. The forms stay on white paper in
  Blueprint. Every breakpoint is a `max-width` in rem -- 80, 56 and
  40rem, the UX specification's tiers -- the form the gate reads.
- **No delete**: no control, no route, no key. The person decided it, and
  it comes later as its own step.

## Consequences

**What it buys.** A person sees the forms they may read, a form's records a
page at a time, the record beside them in the renderer they choose and
its child rows below, on both engines, keyboard first, the grid in the
room and the forms on paper -- and nothing they typed is dropped without
being asked by the page; a reload or a closed tab still drops it.

**What it costs.**
- **Weight.** `vite build` on 2026-10-11, in this worktree with Vite
  8.3.3 and `@formancy/*` 0.5.0: the sign-in page's chunk 233.89 kB
  (74.09 kB gzipped); the workspace's, loaded after sign-in with AG Grid
  in it, 1,064.05 kB (304.53 kB gzipped); Angular's, loaded with its
  first form, 229.51 kB (66.68 kB gzipped). Vite warns of the workspace
  chunk's size.
- **An exact pin.** An AG Grid upgrade is a change of its own that runs the
  gate again.
- **Three decisions of the gate's own.** What axe leaves undecided inside a
  grid -- its painted selection and header layers -- is decided on the
  pixels Chromium painted; an element past the edge inside a grid's well
  is accepted where the well is inside the window; and an animation
  cancelled before it ends -- a button's colour, the button drawn again
  for the record a create opened -- counts as ended when the gate waits
  for the page to settle.
- **The grids are React's.** Only the forms are drawn by both renderers;
  the grids are the page's shell.
- **Pages with no total**, as 0044 decided: the line says the range and
  whether more follow.
- **One more question.** Load, New record, another form, Sign out, a child
  row and the renderer switch ask first over unsaved work, and so does a
  create in one pane while the other holds a draft; a browser reload or a
  closed tab does not. "Load the saved record", after a stale save, does
  not either: it says it discards the draft, and is the person's answer.
- **The columns re-fit to their content, not to the lane.** The person's
  decision of 2026-10-10 has the columns re-fit when the split is let go,
  and the UX specification sizes them to their content and leaves the
  space over at the end (§6.3). Both hold: letting go sizes every grid's
  columns again, to the rows shown then, which a search or another page
  may have changed since the first page sized them; a lane made wider
  leaves its space at the end of the grid rather than stretching the
  columns past their content. Fitting them to the lane's width instead is
  a change of §6.3, for the person to ask for.
- **No record in the address.** A reload or a shared link opens the form,
  never the record.
- **A child row's parent is fixed only on the page.** The server checks
  only that it is one the person may reference (0043).
- **A form this person may only read still draws Save.** Its fields are
  disabled; pressing Save is refused by the server, in its words.
- **Create-only forms are not reachable here**, as 0045 leaves them out of
  the menu.
- **New names in the guide.** Sign in replaces Open the form, and Open by
  record token stands before Record token and Load.
- **AG Grid's own limits**, which no theme parameter reaches: its focused
  cell is a 1-pixel border, not drawn in forced colours; a focused cell's
  change of state is not announced; and Home and End are its own.
- **One viewer's choices are kept in their browser**, and nowhere a person
  would look for them: a shared machine keeps the last viewer's.
- **The composed stack's own account may not read `sales.order_line`**, so
  the getting-started guide and the README's pictures show no child grid;
  the suites and the gate publish the line form as the owner.

**What it forecloses.** Nothing the runtime plane offers: a host that wants
another shape calls the routes itself. Delete is not foreclosed; it is
decided apart, later.

## Alternatives considered

**AG Grid Enterprise's master/detail rows.** A commercial licence, which
this module does not hold.

**A hand-written table.** The person asked for AG Grid.

**AG Grid's client-side row model over one page.** Its sort is
JavaScript's, which disagrees with the database's collation.

**Infinite scrolling with no pages.** It cannot say "Rows 51–100", and a
block AG Grid keeps would be a page the policy was not asked about.

**AG Grid's own paging panel.** Its words are AG Grid's, and it overflowed
a phone in the prototype.

**AG Grid's selection driving the detail.** Space deselects the open row,
and a page loaded again cannot be selected again until it is drawn.

**Recolouring with `.ag-*` rules or `--ag-*` properties.** They change with
AG Grid's minor releases, and would be a second palette beside the room's.

**Both renderers always**, as 0029 had them. The person decided a switch,
and two Angular applications per record and per child row are a cost
nobody asked for; the suites and the gate choose Both, so both renderers
are still held to the same scenarios.

**The detail in a dialog.** A focus trap around an Angular application,
and the records out of sight.

**The record in the address.** Its token spells its key, into a history a
browser may sync.

**A query string for the address.** It is in every proxy's log.

**Keeping the choices in the server, or in nothing.** The server keeps no
viewer's state; keeping nothing asks the same question every time.

**Writing the page's state over the entry Back reached, on Keep editing.**
The design said so; the suite showed it loses that entry, and the next
Back asks nothing. Going forward again keeps the history as it was.

**Hiding Side by side on a narrow window.** The checked option would
vanish; the group says instead that the window draws it stacked.

**One count of history entries for every sign-in.** A count starts at the
page's arrival; an earlier sign-in's entries kept their numbers, so Back
onto one was read as Forward, and Keep editing moved the history the wrong
way. A count of its own per sign-in reads an older entry as an address.

**Opening a late read, or a created record, as it arrives.** It put another
record over a draft typed meanwhile, with no question, and a create in one
pane moved the heading and the children away from what the other pane
held.
