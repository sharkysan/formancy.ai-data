# 0155 — A record's rows may be saved with it, in one transaction guarded by its version and checked as a whole

- **Status:** accepted; extended by [0159](0159-a-form-binds-a-database-routine-as-an-action-over-the-open-record.md): a run on a rowversion form moves the rowversion through the confirmed touch column, held to `touchColumnProblem`
- **Date:** 2026-11-15
- **Deciders:** Daniel Bacher
- **Verified by:** what data-core plans, what both adapters run, what the
  generator writes and the bundle check holds, the route, the client, the
  host page and the studio, each named below.
  `packages/data-core/src/records/save.test.ts` -- the record's step is
  planned under the order's policy and each line's under the line's, and a
  person one of them refuses is refused at that part (watched failing with
  every part planned under the order's policy: the save was refused
  `invalid-policy`); the record's and every row's field errors come at
  once, each at its part (watched failing with the record's answered
  alone); every child carries the order's key as its pin -- what each
  located statement and its explaining read do with it is the adapters'
  save's to show -- and a line the order's list does not hold is
  `not-found` at its part (watched failing with the pin left empty, and
  with the list unasked); a row's answers that are not an object are
  refused as an update alone refuses them, and the row's own listed
  spelling of the order's field is an echo (watched failing with the field
  looked up before the answers were read -- a TypeError -- and with the
  listed spelling not compared); the field that names the order is
  supplied on create, never required, and over-posting when sent there,
  dropped on an update when it is the order's own token and over-posting
  otherwise (watched failing with its columns not supplied -- "order: A
  value is required." -- and with the field passed on to the update as
  sent); `within` is the line lookup's filter for a create, once per child
  that creates rows, and holds a note's customer to the clerk's tenant
  through the note lookup's filter, a policy without that filter refused
  (watched failing with it planned for every child, and with no filter);
  the key is bound where it is known -- a saved order's token, a
  customer's pinned tenant and typed number -- and taken from the record's
  step only where the database numbers it, and a key a default fills that
  may repeat is refused (watched failing with every key taken from the
  step, and with every key the insert does not write taken from it); an
  empty record patch with rows changed is a touch on the confirmed touch
  column, a version column's `touch: null`, unavailable on a rowversion
  without one, and with no row changed `nothing-to-update` (watched
  failing with the patch planned as alone, and with the touch column not
  required), and refused where a row filter pins the touch column (watched
  failing with the row filters unasked); a touch stamps nothing, where an
  update of the record stamps who and when (watched failing with the touch
  stamped as an update); only changed children are counted or refused for
  their bound, a list above `max` refuses a change, and a new record is
  held to its bounds and to every child that requires rows of it before
  any statement, a create naming the children that require its rows, `[]`
  for none, as its type requires (watched failing with unchanged children
  kept, with a new record's creates not counted, and with the required
  children unasked); the steps run record, then each child in codepoint
  order with its `within`, deletes, updates and creates, then the counts
  (watched failing with the body's order kept, and with creates before
  deletes); a child saved through any field but its together one, a child
  named twice, a record whose own rows are saved with another, one no
  token addresses and one of a form over versions are refused (watched
  failing with each check taken out); a deadline that is not a whole
  number of milliseconds throws (watched failing with it unchecked); and a
  record's rows are listed with `max + 1`, at the largest `max` a list
  `listTerms` takes and at no larger (watched failing with `max`, and with
  `max` unbounded).
  `packages/data-core/src/records/together.test.ts` -- `offeredFor`
  refuses a together child's create, delete and change from a date alone
  and keeps its update, offers only through its together field in a save,
  and the planners and the menu's operations ask it (watched failing with
  `offers()` asked alone, and with the save's field not compared);
  bindings no save can hold -- two together lookups, bounds that are not
  whole or ordered, a field written on update, a foreign key that can be
  NULL, onto the form's own table, a section, a form over versions, row
  security, a `max` past `TOGETHER_MAX_ROWS` -- and a touch column no
  touch can set are refused before anything is planned (watched failing
  with `togetherProblem` unasked, with its NULL check taken out, with the
  cap taken out, and with the touch column unchecked); `rowsRequired`
  finds a requiring child from the bundles alone, a min of 0, another
  connection or a plain lookup requiring nothing (watched failing with a
  min of 0 counted); `TogetherChild`'s flags follow the child's create,
  update and delete and the parent's create, update and touch column, a
  touch column a row filter pins turning `saved` off and a key a repeating
  default fills turning `created` off, and all are off for a parent that
  cannot carry a save, one no token addresses and one over versions
  included (watched failing with the parent's update, then its touch
  column, left out, and with each of the rest unasked); a SQL Server save
  of several together children holds the lines whose parameters, 10 a line
  change, 9 a child and 17 for the order's step, fit 2,100 and not one
  line more, where PostgreSQL has no such limit (watched failing with the
  batch's sum unasked, with each child's count and `within` left out of
  it, and with the pin left out of a row's parameters); a row's delete
  reach and its stamps of who add to what it binds (watched failing with
  each left out); and `togetherBatchProblem` names the most that fits for
  a line too wide for one batch at the cap and nothing for a policy that
  cannot be read, which the bundle check refuses first (watched failing
  with that policy asked: a batch of Infinity parameters, of which a max
  of 0 fits).
  `packages/data-core/src/records/menu.test.ts` -- the menu leaves out the
  create of an order whose lines are required exactly where the person
  could not make the save: the line form is not their child of the order,
  or they may not create its rows in one; a min of 0 or another connection
  leaves it in, and the line form lists no create alone (watched failing
  with no narrowing, with the child's being shown unasked, with an unread
  child's together lookup not read, and with the operations asked of
  `offers()`); and a customer whose number a repeating default fills is
  offered no create while its notes are required (watched failing with the
  key unasked).
  The engine facts the decision rests on are held by
  `packages/data-postgres/src/save-facts.integration.test.ts` and
  `packages/data-sqlserver/src/save-facts.integration.test.ts`, each case
  watched failing with its opposite asserted, on the default images; the
  SQL Server file's later cases, measured once the save was built, hold
  that a table a step wrote, and one its cascade reached with no row
  removed, keep an ALTER, a unique index, a trigger created or enabled and
  a foreign key onto them waiting to the end of the transaction, 1222,
  where a DENY DELETE there does not wait; and that a count beside another
  record's uncommitted row waits where the child's foreign key has no
  index and not where it has one, and that two such saves deadlock, 1205.
  What both adapters run is held by the shared cases of `SAVE_PARITY`
  (`packages/data-fixtures/src/saves.ts`), asserted on each engine through
  `covers()` by `packages/data-postgres/src/save.integration.test.ts` and
  `packages/data-sqlserver/src/save.integration.test.ts`, each case watched
  failing with its rule taken out, on postgres:17-alpine and
  mcr.microsoft.com/mssql/server:2022-latest, its comment quoting the run:
  every change committed, on a new order whose key the database numbers
  (watched failing with that key read wrong, a NULL on SQL Server), on an
  account whose code is typed (with a known key bound as NULL) and on a
  saved order (with the deletes not run); a save of rows alone moving the
  order's version (with the touch taken out); the order read back as a
  line's trigger left it (with it answered from its own step on PostgreSQL,
  and on SQL Server with its columns read back before its rows); a delete
  and a create of one number (with the creates first); a refusal at the
  order, at `within` and at the first, middle and last line rolling
  everything back, each line's place a test that declares its own case (with
  the refusal dropped, `within` unasked, and every step its own
  transaction); a row's trigger refusing in words for the person (0156)
  declined at its step with its reason (with a create's error translated as
  a read's on PostgreSQL, and on SQL Server with the severity left out of
  what CATCH records, which answered it `refused`); a stale order and a
  stale row (with each version guard out); another order's line `not-found`,
  by its update or delete and by the read that explains it (with the pin out
  of each, one at a time); a duplicate line refused at its step with its
  constraint (with a step's refusal answered at the save); a moved
  definition of the lines' table (with the guard out); the bounds at and
  past them, bound and never written into a statement (with `max + 1`, with
  `min` unasked, with the limit spliced and with bounds that are not whole
  let through); a lock not waited for past the deadline (with no lock
  timeout), a save stopped between statements past it (with the deadline's
  checks out), and a statement that outlasts it cancelled at its step on
  PostgreSQL and run to its end on SQL Server, which then stops the save
  before its next step (with the statement timeout not set, and with
  PostgreSQL's bound asserted on SQL Server); and two saves of one order at
  once, one stored and one `stale` (with the touch out: both stored on
  PostgreSQL and on SQL Server under READ_COMMITTED_SNAPSHOT, and under SQL
  Server's locking READ COMMITTED the two counts deadlocked, one chosen to
  lose). On PostgreSQL alone, REPEATABLE READ's snapshot taken after the
  save's LOCK (with the timeouts set by a SELECT). On SQL Server alone, a
  text not stored as sent rolling the save back (with the text checks out),
  a trigger that commits in a step `unknown-outcome`, the save stored in
  part (with 3609 answered as a refusal), the batch of every save the suite
  plans, over each of its forms, within `saveParameters`' prediction (with
  two values more bound for every step, which put the saves of 21 cases past
  it), a batch past 2,100 parameters refused unsent (with the guard out,
  which SQL Server then refused itself), and a rowversion order's touch
  (with its version guard out). Each adapter's
  `save-lost-answer.integration.test.ts` -- a save whose answer the TCP hop
  dropped `unknown-outcome`, sent once (with the adapter sending it again),
  a save sent again `stale` (with the version guard out), and on PostgreSQL
  a COMMIT a deferred key refused answered as that refusal with nothing
  stored (with it answered as a lost connection). Each adapter's
  `save-sized.integration.test.ts` -- a save's round trips (with a statement
  more per line on PostgreSQL, one more before the batch on SQL Server) and
  a save of `SAVE_MAX_ROWS` lines stored within the default deadline (with a
  deadline of 1 ms). `together.test.ts` -- the cap the fewer of a page less
  one and `SAVE_MAX_ROWS` (with `SAVE_MAX_ROWS` at 10 and the cap the page's
  alone).
  What the generator writes and the bundle check holds:
  `packages/data-core/src/generate/together.test.ts` -- a choice's
  `together` written as the bindings the suites before it edited in, the
  field written on create only (watched failing with the choice's bounds
  not carried), never required in the form, with its note (with `required`
  decided as for any other lookup), and refused where a save could not
  hold it -- bounds, a foreign key that can be NULL, row security, the
  form's own table, two together lookups, a section, a form over versions
  (with `togetherProblem` not asked of the generated bindings, and with
  its section and versions checks out); a touch column carried onto a
  rowversion's concurrency and never inferred (with `touchColumn` not
  read), and refused in a key, a foreign key, generated, unwritable,
  pinned, absent or on a version column (with it carried unchecked).
  `packages/data-core/src/records/menu.test.ts` -- a together child under
  its record carries its `TogetherChild`, any other child none (with it
  left off the menu). `packages/data-server/src/bundle.test.ts` -- a
  together child and a touched parent as generated validate and are stored
  (with the format-1 refusal asked of every format); a request and
  bindings that disagree about `together` or the touch column refused
  (with each left out of the comparison); a read filter beyond the
  together key, a through by another field, row security, a touch column
  in a key and one a row filter pins refused on read (with
  `togetherProblems` left out of `policyProblems`); a `max` past one SQL
  Server batch refused at publish, at the most that fits stored and one
  more refused, and still served once stored (with the publish gate not
  asking `togetherBatchProblem`); either in format 1 refused (with format
  1 read as before); a hand-edited bound refused on read (with the
  request's bounds read without `boundsProblem`).
  `packages/data-server/src/routes/admin.test.ts` -- proposed and
  published through the administrator's plane, bindings with other bounds
  or without the touch column refused, a touch column in the key refused
  by the proposal (with the reading leaving `together` out).
  `packages/data-server/src/generation.test.ts` -- the reading carries both
  exactly when given (with `touchColumn` not carried), and a key of a
  lookup choice the reading does not read leaves the request not in its
  normalised form, so a server before 0155 serves no together child (with
  the normalised comparison out).
  The route: `packages/data-server/src/routes/runtime-save.test.ts`, over
  fake ports -- a new order and its lines sent as one request with the
  configured deadline and answered by ref (with the default deadline
  sent); fewer rows than the record must hold refused before anything is
  written, the child left out included (with the required children not
  handed to the planner); over a saved order one read, one list of `max +
  1`, the touch, and each change answered in the order sent (with changes
  matched by position); a row its record does not hold 404 at the row
  (with it answered as any refusal); rule 1, a body that is not one save
  400 with nothing read (with a duplicate ref let through); rule 2, a plain
  child, another field and no form 400 (with the child's `together` not
  asked); rule 3, a policy refusal at its part before any read (with the
  children's operations left to the planner); a new order from intake,
  who may create orders and never sees a line, 403 before any read and
  naming no child (with the check taken out: 422 `too-few-rows` naming
  the line form, after a describe); rule 4, the field that names the
  record over-posting on a create and when moved, dropped when echoed
  (with a new row's answer for it let through, with another value on an
  update dropped rather than refused, and with every row read as behind
  its version -- each saved, 200; with the field passed to the update as
  sent it still passes, the update's own check refusing it); rule 5,
  one adapter call per write id and another body with it 400 (with
  `sendOnce` given no id);
  every part's field errors at once (with the parts left out); a
  membership refusal at its row (with the checks unasked); the
  transaction's refusals at their steps -- stale, a unique key, a count, a
  refused `within`, the deadline (with the part left off); a lost answer
  502 naming the record and the version sent (with the version left out);
  the audit one event, a rows count and no value (with `rows` read for
  exports alone); a together child's create or delete alone 403, nothing
  written after the table is described (with the planners asking
  `offers()`); a plain create of a record whose rows are required 403
  before any statement (with the create route not asking
  `rowsRequired`); the form route's create as the menu's (with
  `grantedOperations` asked alone); and a store that cannot list its
  forms refusing every plain create and every save 503 with nothing
  asked, and offering no create (with each null branch read as no child
  required, one at a time). `packages/data-server/src/save-deadline.test.ts`
  -- the setting's digits only (with any `Number` taken), the start-up
  check only beside SQL Server (with it asked of every allowlist), and the
  server's option held to the same rule (with it unchecked);
  `scripts/server-start.test.mjs` -- the built server stopping at 7,500 ms
  beside SQL Server, naming the setting, and starting at 7,499 and at
  8,000 beside PostgreSQL alone (with `main.ts`'s check removed: it
  listened at 7,500).
  `packages/data-server/src/e2e-lost-answer.integration.test.ts`, on
  postgres:17-alpine and mcr.microsoft.com/mssql/server:2022-latest -- a
  save whose answer the TCP hop dropped is 502 with the order and the
  version, sent once; on SQL Server stored once and stale sent again, on
  PostgreSQL uncommitted and saved sent again (with the route sending it
  again: the marker crossed twice on both engines).
  The client: `packages/data-client/src/transport.test.ts` -- a save
  posted with its two keys and a write id, done only on a saved answer
  (with it read as a record); a 2xx not saved, a lost connection and the
  502 unknown, sent once (with the saved shape unchecked); a refusal with
  its part, parts and bound (with them dropped); a form's `together` and a
  menu child's flags of the server's shape (with each unchecked).
  `packages/data-client/src/reconcile.test.ts` -- a save as an update with
  a version and as a create without one (with every save read as a
  create). `packages/data-client/src/saves.integration.test.ts`, on the
  same images -- an order created with its lines, changed in one save,
  stale sent again and reconciled `changed` (with the client posting to
  the update route); past its bound, a plain create of the order and a
  line alone refused (with the create route not asking `rowsRequired`,
  the server rebuilt); and the menu and the line form saying the lines are
  saved with their order (with the menu's child left without its
  `together`, data-core rebuilt).
  What the form route serves a page drawing a new row:
  `packages/data-server/src/routes/runtime-save.test.ts` -- a together
  child's `writable.create`, what a row's create in a save takes, served to
  a clerk who may make it and to an auditor not (with it served for a
  create alone: the clerk's was null), and
  `packages/data-client/src/transport.test.ts` -- read where the form's
  rows are saved with their record and nowhere else that offers no create
  (with the save's create left out of the check: the line form refused as
  no form).
  The host page, on postgres:17-alpine and
  mcr.microsoft.com/mssql/server:2022-latest, each mutation watched on
  PostgreSQL, and those that came with the host page's review on both:
  `apps/host/src/together.test.tsx` -- a line changed and one added held
  on the page, said New and Changed in their column, and saved by
  the order's own Save in either renderer (with the session never carrying
  the rows: "Saved." and the lines as they were), the line's form without
  the field naming the order (with it left in: a Saved order control on
  the rail), the mark following the first keystroke (with the set told of
  typing only at Done: no mark until then), Enter on a line putting the
  keyboard on the rail's heading, Done back on its row, Add in its first
  field and Go to Save on the order's Save, Done back on a new line's row
  when pressed before the grid drew the line's first keystroke (with the
  grid telling the tab of a page AG Grid had set aside as drawn: the
  keyboard on the tab's heading), and a clerk's line saying they
  may not remove saved rows while their new line has its Remove (with the
  line saying "You may not remove them here": the page contradicted its
  own button); Add absent at three lines, Remove at one -- a remover's --
  and Undo remove at three, the line saying why (with Remove drawn at the
  bound: a Remove on the last line; with the menu's flags ignored: the
  clerk's line said nothing of removing; and with Undo remove drawn at the
  bound: four lines held under a bound of three), Remove marking a line To
  be deleted and becoming Undo remove with the keyboard on it; a new
  order's Save, pressed before its lines' tab was ever shown, refused at
  that tab with the keyboard on its heading and the bound in the page's
  words, then created with its line (with the tab drawn only once shown:
  the order's pane took the refusal; and with the bound in the server's
  words: the line named the line form's id); a line its own form refuses
  opened with its summary taking the keyboard and nothing sent (with
  `take` handing it on: the save went out and the server refused it); a
  line the database's check refuses refusing the save at that line, opened
  on its tab, the keyboard on the tab's heading and the server's words on
  its line (with a refusal about a row that names no field said on the
  order's pane alone: the keyboard went to its Not saved notice); an order
  holding four lines under a bound of three shown read only (with `mayOf`
  ignoring the count: the line said only that none could be added); the
  line form opened on its own saying its lines are added and removed with
  their Order, with no New record and no Delete (with `savedWith`
  answering null: no such sentence); and in Drill down a line opened on
  the tab's rail and saved by the order's Save (with the together tab drawn
  as a child section while drilling: a child section's grid).
  `stale-set.test.tsx` -- the second of two saves of different lines of
  one order stale at the order, Keep my line changes keeping its line,
  and Save storing it beside the other (with Keep listing the lines
  afresh: the page's line was gone); Keep asking first where the order was
  typed into after the stale answer, Keep editing keeping the typing and
  Discard and continue saying it was dropped (with Keep reading the order
  again unasked: the page asked nothing); a line both changed said Changed
  by someone else and refused at that line, nothing stored, until Load
  this line takes it as stored (with the moved line taken at the version
  it was listed at: marked Changed alone, and, its mark kept, saved over
  the other person's change with nothing said); a line deleted beside the
  page found gone by the save, marked so, and taken off the page by Load
  this line, said on the tab's line with the keyboard on its heading (with
  a line not found left unmarked: no Load this line; and with Load this
  line saying it loaded the line: the keyboard on the page itself); and
  Load the saved record asking first, naming the lines' changes, and then
  dropping them with the order's (with the session loading the record
  alone: the lines as they were drafted; and with the rows dropped unasked:
  no question). `plane.test.tsx` -- the save sent from the page through
  every door, the token in its header alone (with 0155's exception
  removed before the page drew a record's rows as one set: save unused on
  every door). `page.test.tsx` -- axe and a name on every control in the
  states of the lines' tab its case lists, a new line on the rail, one
  its form refused and an order read only over its bound among them (with
  Add drawn without a name). `in-flight.test.tsx` -- a second press while
  the save is out sending nothing, a line typed into meanwhile keeping its
  newer answer and its mark, every answer heard (with the newer typing
  dropped for the stored row: the line said nothing of it); and a new
  order's line typed into while the save creating both is out keeping the
  keyboard and its tab, the order opened without asking about its own
  line, no Remove while the line is out, and the next Save storing the
  typing (with the line's forms keyed by its grid key: the keyboard on the
  page itself; with the record's tabs started again for the created order:
  the order's tab shown; with the created order's rows another pane's
  work: the page asked, and the order was not opened; and with Remove
  drawn while its line was out: each new line's Remove). `leaving.test.tsx`
  -- New record asking first and naming the order with what its lines
  hold (with the lines' changes not the guard's: nothing asked).
  `unknown-child.test.tsx` -- a save whose answer was lost after it
  committed, sent once, checked by the order, and Load the saved record
  asking about the line's change and listing the lines as stored (with the
  order loaded alone: the line still marked Changed); saved again at the
  version it sent, stale by its own doing and still unknown (with that
  sentence for a lost update alone: a stale notice took the unknown one's
  place); and a new order created with its line, its answer lost, holding
  a second press in either renderer until it is checked, one order stored
  (with a lost save that created the record not held, and with the hold
  the pane's alone: a second order created with the line). `save-set.test.ts`
  -- a row added, while the create was out, to a child the save took
  nothing of, the created record's (with only the children the save
  carried moved: its owners named the lines alone). `leave.test.ts` -- a
  created record's rows spared by the guard's question, Keep my line
  changes asking about its pane alone and Load the saved record about the
  rows (with the rows not spared: the created order's own line asked
  about). The host's browser gate, `apps/host/scripts/browser/together.mjs`
  -- the lines' tab clean at every width down to 320 pixels; Add, typing,
  Done, Go to Save and Save from the keyboard, Done giving the keyboard
  back to the new line's own row; no rule of host.css on a line's paper;
  and a new order saved with its line whose answer the hop drops stored
  once with its line, the page saying it may have been saved, or, where
  the browser sent it again, that it was created -- in Chromium on this
  machine, its keyboard checks watched failing there (with Add's move to
  the rail's first field removed, and with Done's and Go to Save's: each
  check found the keyboard on the page itself); in Firefox and WebKit in
  CI alone, where none of its checks was watched failing.
  The studio, against the real server behind a fake `fetch`:
  `apps/studio/src/together.test.ts` -- a lookup offered where its key
  is NOT NULL onto another table (watched failing with the NULL check
  out: the order's creator offered; with the table check out: an
  employee's NOT NULL manager offered); the box starting at no row and
  at the largest max the generator's `boundsProblem` takes (with
  `SAVE_MAX_ROWS`, which it refuses, and with one row fewer); a touch
  column offered from the generator's candidates alone, on SQL Server's
  order `order_date`, `status`, `amount`, `notes` and `group` (with
  `touchColumnProblem` unasked, and with the pins unasked); a lookup the
  generator refuses -- row security, a section -- said before its box is
  ticked (with the unticked lookups unasked); ticked, bounds out of
  order in the generator's words, a pin outside the record's key in the
  bundle check's and, on SQL Server, a `max` past one batch in the
  publish gate's, gone at the max it names (with each source left out in
  turn); a pinned touch column in the generator's words (with the touch
  unasked); and nothing said where the request is refused without them
  (with that request unasked: the box refused with a pin's sentence).
  `apps/studio/src/choice.test.ts` -- the request carrying a lookup's
  bounds and the touch column, and neither where none is chosen (with
  each left out of `proposalFor`); a bound that is no number refused in
  the server's words (with it unasked); and a through by another field
  than the together one not offered, in the bundle check's words (with
  `togetherPolicyProblems` left out of `throughBlocker`).
  `apps/studio/src/choose-together.test.tsx` -- the box under the
  order's customer and not its creator (with it drawn under every
  lookup), once ticked saying that a save holds one level, so a form
  saved with each order is read-only and, requiring one, leaves no order
  to create (with those words left out of its description); not offered
  under row security, its description the generator's sentence (with the
  blocker not handed to it); two keys NOT NULL onto one table, an
  order's creator and approver, each box and its group named by its
  foreign key, and the second refused in the generator's words once the
  first is ticked (with the key left out: two groups, and two boxes, of
  one name); a box emptied refused with nothing sent (with the bounds
  unchecked: the proposal sent with a null and refused 400 in words
  about the body's shape); a pin outside the key under the box and in
  the Policy check (with the together rules out of `policyCheck`: the
  check listed only the undecided order list); a `max` past one batch
  under the box and on the Publish step, its button disabled and its
  words saying that the Choose step's Generate starts the presentation
  afresh (with the Publish step not asking `togetherBatchProblem`: the
  button enabled); nothing of the batch while a pin's attribute is
  cleared, the pin's and the batch's words back with it (with
  `togetherBatchProblem` asking a policy that cannot be read: a batch of
  Infinity parameters); the touch column's options, none chosen, and a
  pinned one refused under it (with every readable column listed, and
  with the refusal not handed to it).
  `apps/studio/src/journey.test.tsx` -- a rowversion order published
  with its touch column and its lines with theirs between 1 and 20, the
  field naming the order written on create only, the store's version the
  request sent, axe and a name on every control at each new state, and
  the order regenerated from Drift with its touch column still chosen
  (with `together`, then `touchColumn`, left out of `proposalFor`: each
  bundle published without it; with At least's label pointing elsewhere:
  the state's audit named the box unlabelled; and with the
  regeneration's touch column left out: None chosen). The studio's
  browser gate, `apps/studio/scripts/browser/together.mjs` -- the touch
  column chosen, none chosen first; the lines saved with their order,
  Space ticking the box and keeping the keyboard on it, the next Tab on
  At least, At most at the cap; and a delivery's pin refused under the
  box; each state clean at every width down to 320 pixels -- in Chromium
  on this machine, its checks watched failing there (with the box
  remounted as it is ticked: the keyboard dropped, and Tab not on At
  least; with the starting max one less: At most not at the cap); in
  Firefox and WebKit in CI alone.

## Context

A record operation is one guarded statement, and 0015 forecloses
"Automatic retries of writes, and bulk writes, in this port"; the two
exceptions are a change from a date (0113) and a file of records (0079).
The plan this repository started from answers "Scope expands to an entire
low-code platform" with "One root record per form; defer nested writes and
workflows" (section 20). That is a working default, not a record, so this
one says it reverses it, for together children alone.

So an order cannot be held to at least one line, and an order and its
lines cannot be stored together: a failed third line leaves the order and
two lines stored. A child is derived from two bundles and declared in
neither (0045); each child row opens in its own form with its own Save.

The engine facts a save would rest on were measured before anything was
decided, by `packages/data-postgres/src/save-facts.integration.test.ts`
and `packages/data-sqlserver/src/save-facts.integration.test.ts`, and held
on the default images (PostgreSQL 17.11, SQL Server 2022 CU27): a
rowversion table's `set c = c` moves the rowversion, fires AFTER UPDATE
triggers with `UPDATE(c)` true; `SET LOCK_TIMEOUT` inside `sp_executesql`
ends with the request; under REPEATABLE READ, `SET LOCAL` and `LOCK TABLE`
take no snapshot; a `FOR NO KEY UPDATE` that waited on a holder that only
locked is not rolled back, and its count misses the holder's rows; and two
transactions that each move a parent's version and then count are
serialised, the second finding no row to move, or, on PostgreSQL under
REPEATABLE READ, refused 40001. One fact cost more than
assumed: on PostgreSQL's locked path, `LOCK … IN ROW EXCLUSIVE MODE` on
the record's table is refused, 42501, to an account granted UPDATE on the
version column alone; it needs a grant to write the table, as 0041
already records for that path.

## Decision

**A child form's lookup onto its parent may be saved with its parent**,
by an administrator's choice, for the rows' creates and their edits
alike. The generation request's lookup choice carries
`together: { min, max }`, and the binding carries it, as 0109's `section`
is; the field is written on create only. The bounds are whole numbers,
`0 <= min <= max`, and `max` is at least 1 and at most
`TOGETHER_MAX_ROWS`, one row less than a list's page: a save over a saved
record is planned from one page of its rows (`planSaveList`), which no
adapter reads past `LIST_PAGE_SIZE`. The cap is derived, not measured;
the adapters' save is to measure how many rows one save can hold, which
may lower it. For a rowversion parent the request confirms a
`touchColumn`, kept as `ConcurrencyBinding.touch`. Neither is ever
inferred. A record and its together children's rows are then created and
changed in one save: the record, a create or an update that may change
nothing, and each child's creates, updates and deletes.

**The generator writes them, and the bundle check holds them.** The
generator writes a lookup choice's `together` as its binding's bounds,
the field written on create only and not required in the form -- a save
supplies it from the record -- and holds the bindings it writes to
`togetherProblem`, the rule the planner refuses bindings by; it writes a
`touchColumn` onto a rowversion's concurrency, refusing one in a key or
a foreign key, a pinned one, a generated one and one the account may not
both read and update (`touchedConcurrency`). The bundle check, on publish
and on every read, compares both with the request (`requestProblems`),
reads the request's bounds again as whole numbers a save can hold, and
refuses a together child whose read policy narrows by anything but the
record its rows belong to -- a row filter outside its foreign key, a
through by another field -- row security on its table, a touch column a
touch cannot set or a row filter pins (`togetherPolicyProblems`), and a
format-1 bundle that carries either, since format 1 keeps no request. At
publish alone, on SQL Server, it refuses a child whose `max` rows would
bind more than one batch's 2,100 parameters (`togetherBatchProblem`): a
prediction this release makes, so a version stored is still served.

**The record's version moves on every save.** A save over a saved record
updates it, or, where its own answers change nothing, touches it: a
version column incremented, a rowversion's touch column set to itself. The
version the person read guards it, so that one row lock serialises every
save of the record's rows, a resend of the same save is `stale`, and one
read of the record reconciles a lost answer.

**A together child's rows are updated alone, and never created or deleted
alone.** `offeredFor(bindings, operation, scope)` is what a form offers
alone (`null`) and in a save (`{ save: field }`); the menu, the form
route and the planners ask it. A record whose rows a together child
requires -- `min` of 1 or more -- has no plain create: `rowsRequired`
finds such a child among every served bundle, whoever asks, and the
create route refuses one 403 `operation-unavailable` before any
statement, in words that name no child; the menu leaves the create out
where the person could not make the save (`formMenu`), and
`GET /v1/forms/:id` offers it, and the save route takes a save that
creates such a record, exactly where the menu does (`createOffered`).

**data-core plans the save, and both adapters run it.** `planSave`
(`packages/data-core/src/records/save.ts`, one child's steps in
`save-steps.ts`, the adapters' request in `save-types.ts`, the wire shapes
in `packages/data-core/src/save.ts`) plans every part with today's
planners, under its own form's policy, in the save's scope:

- the record's step first: an insert, an update, or the touch;
- each child the save changes, in codepoint order of form and field: its
  `within` where it creates rows -- the record under the child's lookup
  filter for a create, which 0043's membership check would ask -- then its
  deletes, its updates and its creates, every one pinned to the record's
  key through the child's foreign key: bound where the key is known, taken
  from the record's step only where the database numbers it;
- each child's count, under its read filters and throughs, held to `min`
  and `max`;
- the record read back by its key, and the configured deadline.

It answers every part's field errors at once; a part's other refusal
alone, at its part; a row the record's list does not hold `not-found`; a
list already above `max`, or a new record's creates outside its bounds or
without a child that requires rows of it, before any statement.
`planSaveList` is the list a save is planned over, with `max + 1` rows.

`RecordAdapter.save` runs the request as one transaction, never sent twice.
On PostgreSQL it is one `sql.begin` on the path the record's definition
chooses (0041), the locked one under any isolation but READ COMMITTED or
where a delete reaches past its root (0051): `SET LOCAL` lock and statement
timeouts of the deadline, on the locked path one `LOCK … IN ROW EXCLUSIVE
MODE` of every table it writes, then each step as today's statement, the
deadline checked before each and before COMMIT. On SQL Server it is one
batch that owns its transaction: `set lock_timeout` of the deadline, each
step followed by the checks a write alone's batch carries, from shared
functions (`batch-steps.ts`) -- the text, row-count and after-trigger
version checks after every step, the definition's and the INSTEAD OF guard
after the first step on each table and a delete's reach checks after the
first delete of each reach only, since that step leaves the transaction
holding a lock that keeps an ALTER, a unique index, a trigger created or
enabled and a foreign key onto the table waiting to its end, as measured (a
DENY DELETE made meanwhile is not, below) -- the deadline checked in the
batch before each step, and CATCH recording the step it stopped at with SQL
Server's own number, message and severity, translated by the rule a single
write's refusal is. Each child's pin is added to the WHERE that locates each
of its rows and to the read that explains one that changed nothing, and
written into each create. A step that changes nothing, a `within` that is
false and a count outside its bounds stop the save and roll it back; the
first is then explained, outside the transaction, by the read a write alone
asks. The bounds and the limit of each count are bound; only the timeouts
are spliced, from the deadline's whole number. `SAVE_MAX_ROWS` and
`DEFAULT_SAVE_DEADLINE_MS` (`packages/data-core/src/records/save-limits.ts`)
are measured, by the adapters' sized suites, and `TOGETHER_MAX_ROWS` is the
fewer of a page less one and `SAVE_MAX_ROWS`.

**A child's pinned column is held through its lookup's filter.** A
column of a child's foreign key onto the record that the child's policy
pins to the context is written in a save from the record's key, not from
the context. The policy's fit already refuses a policy that pins a column
a lookup sets unless that lookup's filter pins the target's column to the
same attribute, so `within` -- the record under that filter -- holds the
record's value there to the context's, as a selection of another
tenant's record is not an option when a row is created alone. Nothing
compares the two again at plan time.

**The menu narrows the parent's create, and says each together child's
flags.** `togetherChildren` gives each together
child's `TogetherChild` for one person: in a save that creates the
record, the child's create with the parent's create and a key the save
can know before the rows' statements, every key column written or
numbered by the database (`newKeyPart`, which the planner asks too); in
one over a saved record, each of the child's writes with the parent's
update and a touch, which a row filter on the touch column rules out
(`pinsTouch`, likewise). On SQL Server every flag is off where the
parent's step and every together child's `max` rows do not fit one batch
of 2,100 parameters, by `saveParameters`, a prediction of the batch the
adapter will build. `formMenu` leaves out a parent's create where the
person could not make the save, and names each together child with its
`TogetherChild` (`FormMenuChild.together`), which is absent for every
other child -- not `null`, so a child is read as before 0155 by a page
that knows nothing of it. `PublishedForm.together` is the lookup a
form's rows are saved through and its bounds, `null` for every other.

**The runtime plane saves them in one request.**
`POST /v1/forms/:id/records/save` (`routes/runtime-save.ts`, its body's
check in `save-body.ts`, its answers in `save-answers.ts`) takes a
`SaveBody` and answers in this order, each stage alone: the body's shape
(400, before the write id is read): a new row's `ref` of 1 to 32 letters,
digits, `-` or `_`, once in the body, a row's token once in its child,
each child once, and something saved, else `nothing-to-update`; each
child a together child of this form in the person's menu through that
field (400, naming the form and the field sent); every part's operation
-- the record's create or update alone, each child's create, update or
delete in the save (`offeredFor`) -- under its own form's policy, before
anything is read (403, at the part); then, before anything is read too, a
new record a together child requires rows of from a person who could not
make that save, where the menu offers them no create of it
(`createOffered`), 403 `operation-unavailable` at the record in words that
name no child, which the planner's bound would name to somebody who may
not read it (0045); then the reads -- the record by
`readForWrite`, or its table described; each changed child's rows by
`planSaveList`, or its table described -- each row's echoes removed
against its row as listed (0022, 0098), and `planSave` with the
configured deadline, whose refusals are answered at their parts: every
part's field errors at once (422 `parts`), a row the list does not hold
404, a bound broken before anything is written 422 with `rows`, and the field
that names the record over-posting where a row sends another value; each
selection's membership check, by the function a write alone asks, at its
part; and one call to `RecordAdapter.save`, once per write id
(`sendOnce`'s `save`), never again. A refusal of the transaction is
answered at the step it names, in a write alone's words for that step's
form -- a delete's as a delete's -- with `at`; a stale step in the save's
own words, which never say nothing was saved; the save as a whole past
its deadline or out of reach 503, rolled back. A lost answer is 502
`unknown-outcome`, `operation: 'save'`, naming the record and the version
sent, or for a new record what its insert would have made. The audit is
one event, `operation: 'save'`, the record's keyed hash and `rows`, the
row changes the body carried, and nothing else of them (0023).
`FORMANCY_DATA_SAVE_DEADLINE_MS` sets the deadline, `DEFAULT_SAVE_DEADLINE_MS`
unset; the server refuses to start where a SQL Server connection is
allowed and twice it is not below mssql's request timeout of 15 s, past
which a save that may commit would be unknown where the deadline rolls it
back.

**The client sends a save and reconciles it by the record.**
`client.save(formId, body)` resolves to the record and its rows as
stored, a refusal carrying `at`, `parts` and `rows`, or an unknown write,
by the rules every write's answer is read by (0031); `reconcile` reads a
lost save as an update where it carries a version and as a create where
it does not, and says what the record shows and nothing of its rows.

**The host page holds the rows until the record's own Save.** A together
child's tab (`apps/host/src/together.tsx`) is drawn with the record's
tabs, not the first time it is shown, and lists the record's rows as it
opens -- `list` with `parent` and `limit` `max + 1` -- into the page's
own set (`save-set.ts`, framework-neutral beside `session.ts`), which the
grid is answered from through its datasource's seam and asked again from
memory each time the set changes. Each row's change is said in words in a
column of its own; the tab's line, a polite live region, says how many
rows there are, the bound, why a control is not there and what is held,
with Go to Save beside it, which shows the record's tab and puts the
keyboard on its Save and sends nothing. Add starts a new row, its `ref`
minted from a counter that never goes back, and named by it, on a rail
with the keyboard in its first field; a row opens there by a click, Space
or Enter in every layout -- in Drill down on the record's own level, not a
level below -- in the child's own document with the field naming the
record left out, and Done runs the engine's submit and closes the rail
where it accepts, sending nothing. Remove marks a row to be deleted and
becomes Undo remove with the keyboard left on it, asking nothing. Add is
absent at `max` and Remove at `min` -- a new row's too, as a repeater's
are (formancy.ai 0184) -- and Undo remove at `max`, which it would pass;
each is drawn only where the menu's `TogetherChild` lets this person, and
the line says why one is not, in the words of the rule that draws it: a
clerk who may add rows and not delete them may take off a row they added,
and not a saved one. A record holding more than `max` shows them read
only. A row's draft is its forms, one engine per
renderer, each answer typed into one copied into the other. The record's
Save (`session.ts`, through `with-rows.ts`) carries its rows wherever
they hold a change, or a child requires rows of a new record: each new or
changed row's forms submitted first, a row refusing opened with its
summary taking the keyboard and nothing sent; then one `client.save`
with the record's answers where they changed and none where they did not.
While it is out every row stays editable, and the row's forms are keyed
by a slot it keeps when its key becomes its token, so the field being
typed into keeps the keyboard; but a row whose change is in that save has
no Remove until it is answered, since a new row taken off the page
meanwhile would be stored and shown nowhere. The rows are one set for
every pane of the record, so a press in the other renderer's pane while
the save is out says busy, and after a lost save that created the record
is held until that pane checks it. Its answer goes where it is about:
stored, each row takes its stored self, or, typed into while the save was
out, keeps its newer answers and its mark with the stored version, and the
record's line says what was saved; a record created takes every row held
for it, one added while the save was out too, and opening it asks nothing
about them, nor starts its tabs again; a refusal about a row opens that
row, the server's words on its fields where it names one and on the tab's
line where it does not -- neither engine names the column of a check or a
unique key -- a row stale marked moved and one not found gone, and a
bound onto the tab in the page's words, each with the keyboard there;
stale at the record from a save of rows alone, the notice offers Keep my
line changes, which reads the record again and lists the rows again,
every change kept at the version it was read at and a row moved or gone
since marked changed by someone else, so the next save is guarded row by
row and Load this line takes one row as stored, or, gone, off the page,
the tab's line saying so; lost, the record's notice checks by the record
alone, and Load the saved record lists the rows again. Keep my line
changes asks the guard first where the record's own form holds typing,
which it reads the record again over -- nothing merges, as for a record
alone (0029) -- and Load the saved record, in the stale notice or the
unknown one, asks first where the rows hold changes, naming them. The
guard counts the rows' changes as the record's work and names them with
it. A together child opened on its own says its rows are added and
removed with their record, named by the form it opens in (0140), and that
a change made there is saved by itself. `GET /v1/forms/:id` serves a
together child's `writable.create` -- what a row's create in a save takes
from this person -- where they may make it, though `operations` holds no
create, and with it its starting defaults (0149), narrowing
[0117](0117-a-form-names-what-each-write-accepts-and-a-host-page-sends-nothing-none-accepts.md),
whose `writable` named a write `operations` does not hold as `null`;
`@formancy/data-client` reads it there and nowhere else, so a page draws a
new row with the fields its create takes.

**The studio offers both, and ticks neither.** On the Choose step
(`apps/studio/src/choose-together.tsx`), under a lookup whose foreign key
is NOT NULL and onto another table, "Rows of this form are saved with
their order" is a box, unticked; ticked, "At least" and "At most" are
number boxes starting at 0 and `TOGETHER_MAX_ROWS`, and the lookup choice
carries `together`. On a rowversion root this connection reads, "Rows
saved with these records move the rowversion through" lists the columns
`touchColumnProblem` takes and no pin holds, none chosen, and the request
carries `touchColumn`; a regeneration taken up keeps it. What is refused
of either is asked of the functions the server runs and said in their
words before anything is sent (`apps/studio/src/together.ts`): the
generator itself, run in the browser on the request the step would send
against the snapshot it discovered, asked first without either, so that
only a refusal they cause is said there; a lookup it would refuse --
row security, a section, a form over versions, another lookup already
saved with its record -- is not offered, its box saying why; ticked, the
generator's refusal of it, or the bundle check's of the policy as it
stands (`togetherPolicyProblems`) and, on SQL Server, the publish gate's
(`togetherBatchProblem`), with the most that fits -- neither of a policy
that cannot be read, which the server refuses before either. Ticked, the
box also says that a save holds one level: a form saved with this form's
records then saves none, and where it requires a row, none of these
records can be created. Where another key that could be saved with its
record references a table of the same name, the box and its group are
named by the foreign key too, as the step's other controls of a lookup
are. A bound that is no number is refused before the request is sent,
in the words of the server's reading. The Policy step's check asks
`togetherPolicyProblems` as the server does, and does not offer a through
by another field, in its words; the Publish step waits on
`togetherBatchProblem` over the policy as it then stands.

## Consequences

What it buys: an order held to at least one line and at most `max`, and
an order and its lines stored together or not at all, on both engines,
for the children an administrator chooses; every other child keeps its
per-row saves.

What it costs, and what it does not do:

- **Two people saving different lines of one order at once.** Today both
  succeed. Here the second is `stale`. Where it changed only lines, "Keep
  my line changes" and Save store them, each line still guarded by its own
  version; where it also changed the order's own fields, Load discards
  them.
- **The record's version moves on every save of its rows.** Someone
  editing the record's own fields at the same time gets `stale`. The
  person saving rows needs the record's `update` in the policy and the
  database's UPDATE on its version column, or on a rowversion table's
  touch column. On PostgreSQL's locked path, any isolation but READ
  COMMITTED, the save's `LOCK … IN ROW EXCLUSIVE MODE` needs a grant to
  write the record's table: UPDATE on the version column alone is refused,
  42501, as measured before this was decided. The record's UPDATE triggers
  fire on a save of rows alone, and a `rowversion` parent needs an
  administrator to confirm a touch column before its rows can be saved
  over a saved record.
- **A touch stamps nothing.** A save of rows alone moves the record's
  version and writes none of its columns but the touch column, so a
  column the server stamps on update (0153) does not say who saved the
  rows, or when.
- **The record's own step runs first.** Its triggers see the rows as they
  were; a trigger on the order that totals or checks its lines sees the
  old set, and a line's trigger that updates the order runs after it.
- **The bound is held for these two forms' writes, not the database's.** A
  writer outside the module, or a trigger, can leave a record outside it.
  A second published form over the child's table, without `together`,
  creates and deletes rows one at a time: nothing relates two forms over
  one table. Another form's delete whose reach (0051) removes or clears
  the child's rows never touches the record's version. An older server
  reading the same store serves no together child, but can still create
  its parent alone.
- **A together child's read policy may narrow only by the record its rows
  belong to.** A row filter outside the together foreign key, a through by
  another field, or row security on the child table refuse `together`; a
  multi-tenant child whose tenant column is not part of its foreign key
  onto the record cannot be together.
- **A record whose rows are required is not created alone**: the menu
  and the form route leave its create out where the person could not make
  the save, and the create route refuses one whoever asks. So every plain
  create of every form, and every save, reads and validates every
  published form from the store first, as the menu does, and a store that
  cannot list them refuses the create and the save, 503, as nothing can
  tell, and offers no create. Measured once, on 2026-11-16, in-process
  through `inject` on a 20-thread i9-10900K under Node 24.21.0, with a
  file store on local disk, format-2 order forms over the examples'
  captured PostgreSQL snapshot, a version of 28,236 bytes, and ports that
  answer at once, the median of 101 creates after 20: a plain create took
  5.3 ms with one form published, 24 ms with ten and 203 ms with a
  hundred, and the menu over the same store 2.9, 21 and 202 ms -- about
  2 ms a published form, the menu's own cost (0045), paid by every create
  whether or not any together child is published. A refused create says
  only that the record is created with its rows, never which child
  requires them, since the person may read none.
- **A key the database fills by a default that can repeat**, one
  `numbersKey` does not count, cannot be known before the rows'
  statements: such a record is created with no rows saved with it, and
  where its rows are required, is offered no create at all.
- **All or nothing, except on SQL Server**, where a trigger that ends the
  transaction can store a save in part, answered `unknown-outcome`.
- **A together child cannot be created or deleted row by row**, through
  the page or the API; its own form updates rows, and integrators use the
  save for the rest.
- **Bounds, one level and the excluded forms.** A record holds at most
  `max` rows of a together child through the form, rows above it
  read-only until reduced elsewhere, and `max` is at most one row less
  than a list's page; two rows swapping a unique value in one save
  fail, each statement checked as it runs; a save holds one record and its
  direct together children; sections (0109), trees (0110) and forms over
  versions (0113) are not together.
- **SQL Server's 2,100 parameters** bound a save: refused in the menu for
  the parent and its children together, by a prediction the batch of every
  save the SQL Server save suite plans, and each size its sized suite saves,
  stays within, and refused by the adapter before it sends a batch past it;
  so a parent republished with more fields can turn a working together tab
  read-only. The limit is Microsoft's documented figure, not measured here.
- **Locks, round trips and the deadline.** A save holds its record's row,
  and every row it writes, for its transaction; before it, one read, one
  list per changed child and one membership check per selection. How long it
  holds the record's row was not measured apart from its whole time. The
  deadline bounds each lock wait and when a step may start, not the
  transaction. On PostgreSQL it bounds each statement too, which is
  cancelled at its step; on SQL Server nothing bounds a step slow for
  another reason than a lock -- a trigger's work, a count's scan -- but
  mssql's request timeout of 15 s, past which the save is `unknown-outcome`,
  and it holds its locks the while (the shared case `slow-statement` holds
  which engine stops such a step). A save on SQL Server is one batch whose
  text follows the save's shape -- how many deletes, updates and creates of
  each child, which columns each update sets -- and SQL Server compiles a
  text the first time it sees it: measured, the first save of a size took
  seconds where one that reused its plan took a fraction of one, a compile
  the deadline does not bound and mssql's request timeout does, and 500
  lines did not answer within it. People who change different things send
  different texts, so many saves pay that compile, and each text leaves a
  plan in SQL Server's cache; the reused plans' timings are a lower bound.
  `SAVE_MAX_ROWS` is set below that (save-limits.ts says on what and when).
- **What `SAVE_MAX_ROWS` was measured with**: one child's creates, of one
  shape. A save of several together children, a child's deletes and
  creates together -- up to twice its `max` steps -- and updates and
  deletes at any size were not measured, and nothing bounds a save's steps
  across its children.
- **Saves of different records can block each other on SQL Server.**
  Under locking READ COMMITTED a save's count reads its child's rows under
  shared locks, and where the child's foreign key onto the record has no
  index it scans the table and waits on another save's uncommitted rows,
  another record's too; two such saves deadlock, and one is answered
  `unavailable` (1205), measured with plain statements. An index on the
  foreign key avoids it, measured; READ_COMMITTED_SNAPSHOT's reads take no
  shared locks, which was not measured for this. The module makes neither.
  PostgreSQL's reads take no such locks.
- **A permission taken away while a save runs is seen once.** On SQL
  Server a delete's reach checks -- DELETE on every table past its root,
  and the VIEW DEFINITION its keys are read with -- run after the first
  delete of each reach alone, and a DENY DELETE does not wait for the
  save, measured: one made between two deletes of one save is not seen by
  the second. Whether a DENY of VIEW DEFINITION waits was not measured;
  the keys those checks read cannot move until the save ends, measured.
- **The audit trail** names the record and counts the row changes,
  never which; a save's event names no child form, token or ref, so the
  trail cannot say which lines a save touched, or which versions of the
  child forms served it.
- **A save's deadline is the server's, one value.**
  `FORMANCY_DATA_SAVE_DEADLINE_MS` is read once at start, for every form;
  with a SQL Server connection allowed it is at most 7,499 ms, half of
  mssql's request timeout less one, and on PostgreSQL alone it is held to
  nothing but a timer's longest. The timeout is mssql's default, named in
  `save-deadline.ts` because nothing here sets it, not measured.
- **A save's answer is kept for a resend as any write's is**, under
  `MAX_KEPT_BYTES`, 32 MiB, and `MAX_KEPT`, 10,000 answers, and is larger
  than one record's. Measured once, on 2026-11-16, through the real server
  and driver on the default images, postgres:17-alpine and
  mcr.microsoft.com/mssql/server:2022-latest, saving the fixture's order
  with its lines, the line form's `max` at `TOGETHER_MAX_ROWS`, 49, and
  counting the answer as `write-once.ts` does: the order's create alone
  answered 213 bytes on PostgreSQL and 258 on SQL Server; a save of the
  order with one line 428 and 518; with 49 lines created 7,508 and 9,758,
  and with 49 lines changed 6,929 and 9,179 -- about 148 and 193 bytes a
  line, SQL Server's with the fixture's order numbers near 2^53 and a
  rowversion in every token and version. So the byte cap holds about
  4,400 and 3,400 saves of 49 lines, and a save of more than about 21
  lines on PostgreSQL's fixture, 16 on SQL Server's, fills the byte cap
  before the count; a record with several together children, or rows
  with wider values, keeps fewer, and an answer dropped before its ten
  minutes leaves its resend applied again (0031).
- **A save names its children by what the menu says**: a child this
  person's menu does not show under the record -- one they may not list, or
  whose field they may not read -- is 400, so a person who may create the
  record and not read its required rows cannot create it at all: a save
  that creates it is refused 403 before anything is read, naming no child,
  as the plain create is.
- **The host page lists a together child's rows as the record opens**,
  since its tab is drawn with the record's tabs so that the record's Save
  can show it: one list request more for each record of such a form a
  person opens, whether or not they look at its rows.
- **A row's two renderers are two engines kept equal.** Each answer typed
  into one is copied into the other; a field a rule computes is each
  form's own.
- **Keep my line changes keeps none of the record's own typing.** It
  reads the record again at its new version; where its form holds typing
  -- typed while the save was out, or after the stale notice -- the guard
  asks first, and Discard and continue drops it: nothing merges, as for a
  stale record alone (0029). Load the saved record asks first too, naming
  the rows' changes it drops with the record's.
- **A row in the save still out cannot be removed** until that save is
  answered, nor put back: a new row taken off the page meanwhile would be
  stored all the same, and shown nowhere.
- **What no host test reaches.** A refusal naming a field of a row is put
  on that row's field (`applyServerErrors`) by code no test reaches:
  neither engine names the column of a check or a unique key, and a row's
  own form refuses a missing answer before anything is sent. The lines'
  tab in Stacked and Separate views, and on a Drill down level below the
  record, is the same `RecordTabs` drawing, which no test opens there.
- **Remove is absent at `min` for a new row too**, as a repeater's is: a
  new record at its fewest rows adds one before it drops one.
- **The studio offers the box under every lookup whose key is NOT NULL
  onto another table**, so an order is offered to be saved with its
  customer as a line is with its order; nothing ticks it, and the Choose
  step is longer under each such lookup. A save holds one level and each
  bundle is read alone, so nothing refuses publishing both: once the
  order's form is saved with its customer, a line form saved with its
  order saves none -- its rows read-only under each order -- and where it
  requires at least one line, no order can be created at all, through the
  page or the API. The box says so once it is ticked; nothing on the
  administrator's plane warns of such a pair, whichever is published
  first.
- **The studio's refusals are asked against what it holds.** The
  generator runs in the browser against the snapshot the Connect step
  discovered, where the server generates from a discovery of its own:
  a database changed since is said by Generate, in the server's words.
  The bundle check and the batch are asked in the Choose step against
  the policy as it stands, which the Policy and Publish steps ask again.
  On each change to the choice or the policy the generator runs once
  without either, once with the touch column, once with the lookup ticked
  and once for each lookup that could be: a cost not measured.
- **A touch column is offered from what the catalog says of keys alone.**
  A check constraint's expression is not parsed, so a column a check names
  is offered; whether SQL Server evaluates the check again when the column
  is set to itself is not checked.
- **Built.** The plan, both adapters' save, the generator's and the bundle
  check's part, the route, the client, the host page and the studio. The
  limits were measured on one workstation and on the default images
  alone, not on the CI runner, which holds only that a save of
  `SAVE_MAX_ROWS` lines is stored within the default deadline, nor on the
  oldest images of the matrix.

## Alternatives considered

- **Defer**: keep 0015's foreclosure and the
  plan's default. An order can still be stored without lines, and a failed
  third line leaves two stored.
- **Creates first**: a new record stored with its rows in one
  transaction, the bound checked then, later edits per row. It needs no
  version move, no touch column and no serialisation, since nobody else
  sees a record before it commits; but the bound would be true at creation
  only, and a page would edit one child two ways.
- **Lock the record's row without moving its version.** No `stale`
  between people saving different lines, and
  no touch column. But under PostgreSQL's REPEATABLE READ the lock does not
  make the count see a save that committed while it waited -- measured: the
  waiter is not rolled back and its count misses the holder's rows -- so
  the version would have to move under that isolation anyway, a second
  rule. A lost save of rows alone would be reconciled row by row, a
  numbered create unverifiable, and a resend reaching another process
  would store its new rows twice.
- **No per-row writes at all**: its own form
  read-only. Not taken: the together field is written on create only and
  the read policy narrows only by it, so an update alone can move no row
  out of a bound, and a line's quantity is still changed by itself, from
  the API and Drill down's habits, without moving the order's version.
- **Every per-row write allowed**, the bound checked only in
  saves: a per-row create or delete would skip it.
- **Per-row saves with a bound checked after each.** No atomicity: an
  order is briefly without lines, and a failed third line leaves two.
- **The children as a repeater in the parent's document.** Another table's
  columns in the parent's bindings, repeater rows given tokens and versions
  the spec does not carry, and the child's policy restated in the parent.
- **Count without serialising.** Two saves at once each pass their count,
  and the bound is exceeded.
- **Reorder the steps** -- lock and check the record, then the rows, then
  its update or touch. A create must still go first, so creates and
  updates would differ, and an update moved last would need its version
  read again, since a line's trigger can move a rowversion first.
- **Answer the record from its step's returning.** SQL Server's OUTPUT
  predates the AFTER triggers, so a total a line's trigger keeps would be
  answered stale beside a new version.
- **A database constraint, trigger or idempotency table made by the
  module.** It changes the customer's schema, which the plan rules out;
  the record's version makes an idempotency key unneeded over a saved
  record.
- **One statement of data-modifying CTEs on PostgreSQL.** Every CTE reads
  one snapshot, so a count cannot see the rows the save writes.
- **Requests on an `mssql.Transaction`.** A round trip per step with locks
  held between them, an isolation setting whose life on a pooled
  connection is not checked, and a batch whose trigger checks assume it
  owns its transaction.
- **A transaction held open across HTTP requests.** A lock held while a
  person thinks, which 0015 rejected.
- **Stopping a save on abandonment.** The browser's own resend (0031)
  would be answered "not saved".
- **Counting every row that references the record, ignoring the read
  policy.** A refusal would disclose rows outside the person's read scope
  (0012, 0015); limiting the read policy makes the two counts one.
- **The bound in the policy, or in the parent's bundle.** The first is not
  a "who may"; the second needs a reference across bundles, which would
  dangle once a form is unpublished.
- **The together child's operations written off by the generator.** The
  policy's fit would then refuse every grant a save needs; `offeredFor`
  tells a write alone from one in a save.
- **A touch that stamps.** A save of rows alone could stamp the record's
  who and when as changed; not taken, so a touch writes no field and the
  record's own fields keep saying who last changed them.
- **The pin on every row's request**, `parent` on each update and delete
  rather than once on the child. Two copies of one value per child, which
  could disagree, and no type can make an adapter apply either; the
  adapters' save holds it, by a row of another record that is `not-found`.
- **A plan-time comparison of the record's key with the child's pins.** A
  second rule beside the policy's fit and `within`, which hold it already.
- **A `max` past one list page**, read over several pages. A save would be
  planned from rows read by several statements, which another writer can
  move between, and no measurement says a save of that many rows fits its
  deadline.

