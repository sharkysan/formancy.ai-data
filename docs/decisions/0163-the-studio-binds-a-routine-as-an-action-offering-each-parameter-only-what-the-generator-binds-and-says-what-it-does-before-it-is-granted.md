# 0163 — The studio binds a routine as an action, offering each parameter only what the generator binds, and says what it does before it is granted

- **Status:** accepted
- **Date:** 2026-11-17
- **Deciders:** Daniel Bacher
- **Verified by:** the studio's side of an action over the open record --
  its discovery, the Choose, Policy, Presentation and Drift steps -- and
  the one query the administrator plane's discovery gained for it. Every
  case was watched failing with its rule taken out, the file put back
  byte for byte, on 2026-11-17.
  `packages/data-server/src/routes/runtime-actions.test.ts`, over fake
  ports -- `GET /v1/connections/:id/metadata?routines=true` discovers with
  the routines in scope and without the query as it always did, any other
  value refused 400 before anything is discovered, each a `discovery` in
  the administrator's trail (watched failing with the query ignored:
  "expected [ { schemas: [ 'sales' ] }, …(1) ] to deeply equal [ Array(2)
  ]"; and with any value read as a yes: "?routines=false: expected [ 200,
  undefined ] to deeply equal [ 400, 'invalid-request' ]").
  `packages/data-core/src/generate/actions.test.ts` -- `sourceProblem`,
  asked of one parameter and one source, answers null exactly where the
  generator binds the action with that source and otherwise the rule its
  note refuses with (watched failing with it answering null for every
  source: "amount from {"field":"customer_no"}: expected null to be
  'parameter amount is given customer_no…'").
  `apps/studio/src/fixtures.test.ts` -- the routines the suite's discovery
  reports when asked, made from `src/fixtures/routines.json`, say what the
  shared model says of each as each account (watched failing with the
  PostgreSQL reader's ship_order made executable: "executable as the
  reader is true, expected false"), and asked without routines each is the
  captured file to the byte (watched failing with the routines gap kept:
  the SQL Server reader's differed).
  `apps/studio/src/api.test.ts` -- asked for them, a discovery sends
  `?routines=true` and its snapshot records the routines; not asked, the
  request and the snapshot are what they were (watched failing with the
  flag not sent).
  `apps/studio/src/metadata.test.tsx` -- the routines a discovery read are
  listed and counted, a reader behind a gap says it cannot tell, and a
  discovery that did not ask is the pane as it was (watched failing with
  the list left out of the pane).
  `apps/studio/src/choose-actions.test.tsx`, against the real server
  behind a fake `fetch` -- a discovery that did not ask offers no action
  and says how, and Include routines asks the server (watched failing with
  the box's state left out of the discovery: "expected [ undefined,
  undefined ] to deeply equal [ undefined, '?routines=true' ]"); a form
  with no confirmed version offers none, in `actionUnoffered`'s words
  (watched failing with the form's refusal unasked); a routine no run
  could call is listed, disabled, with `routineProblem`'s words -- the
  reader who may not execute it, SQL Server's function (watched failing
  with it unasked); a rowversion order waits for its touch column (watched
  failing with the touch column left out of the request the step asks
  of); each parameter is offered only what the generator binds and the
  generator's note says what is missing (watched failing with every
  candidate offered: "expected [ 'Nothing yet', 'Key id', …(10) ] to not
  include 'Key id'", and with the note left out); a name the generator
  throws is said in its words as it is typed (watched failing with the
  throw unasked); and what is chosen is sent and bound (watched failing
  with `actions` left out of `proposalFor`).
  `apps/studio/src/actions.test.ts` -- a name starts as the routine's, as
  a URL carries it, apart from the names taken (watched failing with the
  taken names unasked); the parameters keep the routine's order (watched
  failing with a source appended as chosen); and a routine is described
  as its engine says it (watched failing with its reach left out).
  `apps/studio/src/policy-actions.test.tsx` -- the notice says what applies
  to the routine and the engine, and no more (watched failing with each
  of its three conditions forced in turn); the roles typed are the grant,
  refused in `validatePolicy`'s words where they may not read, and an
  emptied list leaves `actions` out of the policy (watched failing with
  it kept: the published policy had `actions`); and a grant left from a
  generation that bound the action is removed by its button, the
  keyboard on the policy check (watched failing with the stray grants
  left out of the fieldset).
  `apps/studio/src/action-words.test.ts` -- a label, a sentence, the views
  and a question's words are kept only where they say something the
  generator's do not, in the server's one spelling (watched failing with
  each rule taken out in turn: the label typed back to the base's, the
  views in the order ticked, the emptied help text as a removal); and what
  the server or formancy's validator refuses of them is said (watched
  failing with the dialog left unvalidated).
  `apps/studio/src/presentation.test.tsx` -- an action offers words alone
  on the Presentation step, and what they make publishes beside a binding
  the proposal's to the byte (watched failing with a select of the routine
  added to the panel, and with the words applied to the bindings' dialog:
  the server refused the bundle).
  `apps/studio/src/drift.test.tsx` -- each action is said under what the
  form may still do, the routines' comparison above it, and one only
  review stops is said as the server still allowing it (watched failing
  with the server's own verdict of an action unread).
  `apps/studio/src/journey.test.tsx` -- the whole journey of an action:
  chosen, generated, granted after its notice, worded, published as
  chosen -- request, binding, words and grant in the version the store
  wrote -- axe and a name on every control at each state, only the
  administrator plane called, drift saying it runs and then that a dropped
  routine stops it, and a regeneration taken up keeping it chosen and
  worded (watched failing with `actions` left out of the take-up, with the
  words left out of the publish, and with the Drift step's line left out).
  The studio's browser gate (`apps/studio/scripts/browser/actions.mjs`)
  -- the three states measured at every width in Chromium, and Space on a
  routine's box ticking it with the keyboard kept there and the next Tab
  on the action's name (watched failing, at all six widths, with the box
  drawn again when ticked).

## Context

0159 decided what data-core holds of an action, 0160 how both adapters
run one, and 0161 how the runtime plane serves and runs it -- and that
the administrator plane publishes a bundle whose request names one,
discovering a proposal that names an action with the routines in scope,
and every comparison with a version that recorded them alike. What none
of them built is a way for an administrator to name one without writing
the generation request by hand: the studio bound no action, so an action
reached a database only from a client that wrote its own request.

The studio speaks only the administrator plane (0024) and edits
presentation with controls of its own, none of which can remove, rename
or retype a bound field. 0155's box under a lookup set the shape this
follows: what the generator refuses is asked of data-core's own functions
in the browser and said in their words before anything is sent, never
decided a second time. And 0052 says, before a delete is granted, what it
also does.

Two facts shaped the rest. The administrator plane's discovery, the one
the Connect step asks for, had no way to ask for routines: a snapshot
records them only when its scope asks (0158). And which source a
parameter can take is the generator's rule for one parameter and one
source (`boundSource`), which nothing exported; its typing pieces were,
but the rule for a trusted attribute and the actor's id was not.

## Decision

1. **Include routines asks the discovery for them.** The Connect step
   has a box, Include routines, unticked for every discovery, with a
   sentence saying what it is for and that a form binding one is
   published with them in its snapshot, which a server of an earlier
   release refuses. Ticked, a discovery sends
   `GET /v1/connections/:id/metadata?routines=true`, which discovers with
   the routines in scope; without the query the route is the one it
   always was, and any other value of `routines` is refused 400 before
   anything is discovered. The pane of what a connection can see lists
   each routine a discovery that asked read, with what its engine says it
   is -- its kind, what it returns and changes, its parameters, a reach
   past the account's grants, whether the account may execute it -- and
   counts them beside the tables; behind a routines gap, none seen is said
   as "cannot tell". A discovery that did not ask draws the pane as it
   was.
2. **The Choose step offers each routine, and nothing for anybody.** An
   Actions fieldset lists every function and procedure the snapshot
   records, each a box, "Offer `sales.ship_order(…)` as an action", never
   ticked for anybody, and its facts. A routine no run could call --
   one the account may not execute, a PostgreSQL procedure or a function
   that returns a value, a SQL Server function, a parameter that is not
   `in` or not of a type the adapters' tables hold -- is listed, disabled,
   with the generator's sentence from `routineProblem`, never left out as
   if it were not there. A form that offers no action -- a view, no key,
   no confirmed version, a version that does not prove the record, a
   rowversion with no touch column -- says so once, above the routines,
   in `actionUnoffered`'s words, and its boxes wait. A snapshot discovered
   without routines offers none, and says to tick Include routines and
   discover again.
3. **Each parameter is offered only what the generator binds.** Ticked,
   an action is named after its routine, as a run's address carries it --
   lower-case letters, digits and hyphens, apart from the names taken --
   which the administrator may type over, and each parameter has a select
   starting at Nothing yet: each column of the record's key, each column a
   column field is bound to, an answer of the action's dialog, a trusted
   attribute -- with its name, starting at `tenant` -- and the person's
   id, in that order, each offered only where data-core's
   `sourceProblem`, the generator's own rule for one parameter and one
   source, now exported, says nothing. A key column is offered as the key
   alone, which any reader may pass. A source chosen that the generator
   now refuses stays listed, so its refusal can be answered. The dialog
   field an answer fills takes its key from the parameter's name, without
   SQL Server's `@`; its words are the Presentation step's.
4. **The action as mapped is the generator's to judge.** The generator
   runs in the browser on the request the step would send, as the server
   runs it on a proposal: its blocked note about an action -- a parameter
   given nothing, given a column of another range -- is said under it as
   it is mapped, and what it throws of the actions as a whole -- a name no
   URL carries, two of one name -- is said under the fieldset. The
   request carries `actions` only where one is chosen, in the snapshot's
   order of their routines; a regeneration taken up, and Generate again,
   keep them, and a routine no longer recorded stays listed with its box
   ticked, to be unticked.
5. **Who may run it is granted on the Policy step, after what it does is
   said.** "Who may run each action" holds a list of roles per action the
   form binds, nobody's until one is typed; an emptied list is no entry,
   and no action anybody's is `actions` left out, which a server older
   than 0159 reads. Whether a grant fits -- a role that may not read with
   the form, or may not read a field the action passes, an attribute no
   filter compares with -- is `validatePolicy`'s, said by the policy check
   in its words, and the Publish step waits on it. A grant for an action
   the form no longer binds is listed to be removed, and the keyboard goes
   to the policy check once the last is. Before each grant, as 0052 says
   what a delete also does, a note says what the module neither sees nor
   bounds, each line where it applies: it calls this routine over the open
   record after moving the version, in one transaction, and cannot see
   what the routine does; field grants, state moves and the policy's
   cascades do not bind it; over a version column, a routine writing
   other rows of the table must increment theirs; on SQL Server, a RETURN
   status other than 0 refuses the run; and where the routine reaches
   past the connection's grants -- SECURITY DEFINER, every SQL Server
   procedure by ownership chaining -- that it may.
6. **Its words are the Presentation step's, and only words.** An Actions
   region holds, per action, its label, the sentence a page asks before a
   run, the one it says after, the views read again -- the form's list,
   its child grids -- and each dialog question's label and help text:
   boxes and checkboxes, no select, no button, nothing that names a
   routine or gives a parameter a value. What they make is kept in the
   one spelling the server reads -- an entry only where it says something
   the generator's words do not, in the bindings' and the dialog's order
   -- and what the server's shape and fit checks, or formancy's validator
   over the dialog a page is served, refuse of it is said there, and the
   Publish step waits on it. The bundle sends it as
   `presentation.actions`, and leaves the bindings as the generator wrote
   them.
7. **The Drift step says what each action may still do.** Under what the
   published form may still do, "Run *name*: still allowed" or "blocked by
   the changes below", from the verdict's own list (0159); an action
   review stops that the server still lets run -- EXECUTE taken back,
   which the database refuses itself -- is named in the sentence that says
   what the server still allows; and above them, on a form with actions,
   that the routines are compared by what a call rests on, and not by
   their bodies.

## Consequences

**What it buys.** An administrator binds, grants, words and reviews an
action over the open record from the studio on both engines, through the
administrator plane alone, and every rule a choice is refused by is the
generator's, the policy check's or the server's, asked again in the
browser and said in their words, so the studio and the server cannot
disagree about what will publish.

**What it costs.**

- **Routines are read only when Include routines is ticked**, which it is
  not whenever the Connect step opens. A discovery that did not ask offers
  no action, and an administrator discovers again to bind one.
- **Every routine in scope is listed**, the ones no run could call too,
  so a schema of many routines lists as many boxes on the Choose step and
  as many lines in the Connect step's pane.
- **The notice asks for nothing.** It is drawn beside the grant, and no
  box records that it was read: the policy holds no acknowledgement, and
  a box that wrote nothing would only look like one.
- **An answer's dialog field is keyed by its parameter's name**, without
  `@`, and is not chosen: a parameter whose name formancy does not accept
  as a field key cannot be asked in a dialog, and the generator's throw
  says so.
- **An action is named by the administrator, and a name is its identity.**
  Renamed on the Choose step, it is another action: its words are dropped
  by the rebase and its grant is left as a stray for the Policy step to
  remove.
- **Words are edited as literals.** A label or a sentence that is a
  message reference is shown by its key, and replaced by what is typed.
- **The Policy step names an action by its name, not its label**, since
  it comes before the Presentation step where the label is typed.
- **The suite's routines are made, not captured.** The studio's captured
  snapshots predate routines and taking them again starts both engines,
  so the routines its discovery reports are made from
  `src/fixtures/routines.json`, held to the shared model by the
  comparator both adapters' discovery suites answer to for every fact it
  reads; the type ids, which it does not read, are each engine's own
  built-in ones, written by hand.
- **One more export the studio rests on.** `sourceProblem` is
  `boundSource`'s answer as a function of data-core's, so the studio
  offers what the generator binds; a rule added there changes the
  options at the next release, as every rule of the generator's changes
  its notes.

**What it does not do.** No selection of records: an action runs over
the open record alone, as 0159 binds it. No source is suggested from a
name, as no version column is. The host page's control is another
record's. A routine's body is not shown, as it is not compared.

**Forecloses:** nothing.

## Alternatives considered

**Offer every source and let the generator's note refuse the mapping.**
Lost: a select offering what will be refused is a choice the step knows
to be wrong, and the note names only the first parameter it refuses.

**Decide a source's fit in the studio**, from `fitProblem`, `inputProblem`
and the kinds a trusted attribute takes. Lost: the last is the
generator's rule with no export, and a second copy of it is two
implementations of one decision that nobody would find disagreeing.

**Infer a source from a name** -- `order_id` from the key `id`, `tenant`
from the tenant's attribute. Lost: a source is what the routine is handed,
and a guess that reads right passes the wrong column to a routine whose
body nothing here reads; a version column is never inferred either.

**Include routines always.** Lost: a snapshot that records routines
churns its fingerprint with every routine change in scope and is refused
by a server older than 0158, a cost every form would pay to offer an
action few do.

**A route of its own for a discovery with routines.** Lost: it is one
discovery, with one operation in the administrator's trail, and a query
the route refuses in any other spelling keeps it one.

**The notice on the Publish step**, or a box to tick before a grant.
Lost: the grant is made on the Policy step, where 0052 says what a
delete also does; and a box no policy records proves nothing was read.

**Capture the studio's snapshots again with routines.** Lost for now: it
starts both engines for a fixture whose routines the shared model
already states and both adapters' suites are held to; made from that
model, the suite proves the studio against what discovery must report.

## Older records

Extended, not edited away: 0052 (the studio says before a grant what an
action does that nothing binds, as it says what a delete also does);
0158 (the administrator plane's discovery asks for the routines when the
studio does); 0159 (the studio binds, grants, words and reviews what it
decides); and 0161 (an action is published by the studio, where its
costs said only a client writing its own request could).
