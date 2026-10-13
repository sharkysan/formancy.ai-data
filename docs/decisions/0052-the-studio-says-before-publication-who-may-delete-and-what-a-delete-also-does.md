# 0052 — The studio says before publication who may delete and what a delete also does, and asks for each foreign key by name

- **Status:** accepted
- **Date:** 2026-10-13
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/policy/cascades.test.ts` — `deleteReview` lists
  every key a delete acts through, the ones past the root included, each
  with whether `cascades` names it with its action (watched failing with a
  key accepted by its name alone); every key that only refuses, on delete
  and on the update a cleared reference is; each acceptance the delete does
  not act through, by its place in the list (watched failing with a key
  matched by its name alone); with every acting key named and nothing else,
  `deleteProblems` refuses a grant for exactly `blocked`, each after its
  "operations.delete grants roles, and", over a table the account may not
  DELETE from, a SET NULL another key follows, a cascade and a SET NULL out
  of scope, a gap past the root and a grandchild (watched failing with the
  SET NULL another key follows left out of `blocked`); and whether the list
  is every key the snapshot can show, which it never is for a root the
  snapshot lacks (watched failing with `complete: true` there).
  `apps/studio/src/delete-reach.test.tsx`, against the real server behind
  a fake `fetch` -- the roles typed are `operations.delete`, left out of the
  published policy when they name nobody (watched failing with `delete: []`
  published), and a deleting role that may not read is named by the check
  in validatePolicy's words, as is a key accepted while nobody may delete; the order's reach on the fixture is one box per
  key that acts, `fk_delivery_order`, `fk_order_line_order` and
  `fk_parcel_delivery`, none ticked and no control that accepts them all,
  with the sentence that triggers and rules are not listed (watched failing
  with an "Accept every key" button in the fieldset); a key that sets NULL
  says which columns, the walk stopping there, one that refers to a column
  it clears is listed as refusing that change, and the list says it covers
  the columns a delete clears and not the other keys onto a row it keeps,
  which it does not list (watched failing with the SET NULL said as a
  default, with that refusal worded as one on delete, and with the list
  said to be every key onto each table a delete reaches); a key that sets
  a default says so, of one column and of several (watched failing with
  every key that does not cascade said to set NULL); granted and
  unticked, the check lists `deleteProblems`' sentences and the Publish
  step counts them, and every box ticked publishes `cascades` the server
  accepts
  (watched failing with the check from validatePolicy alone: the step said
  the policy fitted, and the server refused it); a key that only refuses is
  listed, with no box; a table past the order the account may not DELETE
  from, and a `referenced-by` gap, are said in the publish check's words,
  and behind the gap the list says it is not every key; that no key acts
  is said where the snapshot shows every key, as of SQL Server's order
  lines, and behind a gap that hides every key -- SQL Server's reader
  granted DELETE on the order -- the step says the snapshot shows none and
  cannot show every one (watched failing with the sentence a complete
  snapshot gets, and with the reader's said of both); a form that offers
  no delete shows no reach (watched failing with the
  fieldset shown whatever the form offers); an acceptance the delete does
  not act through is named and removed, the keyboard going to the next
  Remove, else the one before, and then to the policy check (watched
  failing with the keyboard left on the page, with the next Remove sought
  at the place it had before the removal, and with nothing sought before
  the last), and on a form that offers no delete every acceptance
  is listed with its Remove. Axe and a name on every control in each of
  those states (watched failing with an unlabelled box beside the
  acceptances of a form that offers no delete, and in the fieldset while
  a role that may not read may delete).
  `apps/studio/src/choose.test.tsx` — the Generate step says delete offered
  or not from the bindings, with the generator's note: PostgreSQL's order
  lines offer update and not delete, SQL Server's reader no delete (watched
  failing with the line read from update's flag); and the Choose step's
  version column and its hint say that without one neither update nor
  delete is offered (watched failing with each one's earlier words, update
  alone).
  `apps/studio/src/drift.test.tsx` — the Drift step says delete only where
  the published policy grants it (watched failing with delete read from
  the bindings alone: the restricted reader's form, which grants none, was
  said to be still allowed to delete); a key nobody accepted that would
  cascade onto the order, DELETE revoked on the parcels and a gap over
  what refers to the order, as PostgreSQL reports a key onto a partition,
  each block delete in review while the runtime's verdict allows it, and
  the step says delete is blocked, that the server still allows it, and
  what each delete's own statement still refuses (watched failing with
  delete never among what "the server still allows"); and the Policy step
  asks about the added key only once the form is generated again.
  `apps/studio/src/journey.test.tsx` — axe and a name on every control with
  delete granted and refused for what it also does, and with its reach
  accepted, and the rest of the journey, publish, drift, restore and
  regenerate, with a policy that deletes (watched failing with the boxes
  unlabelled). `apps/studio/scripts/browser-test.mjs` — the states "Policy,
  delete refused for what it also does" and "Policy, with a reach" in
  Chromium at every width the gate measures: no sideways scroll, nothing
  past either edge, axe with contrast and target size (watched failing
  with the boxes unlabelled: axe's `label` rule in each Policy state).
  **Not mechanically enforced:** the studio's own words for each box and
  each key that only refuses, which are its labels and not the publish
  check's; and what the Drift step says each delete's own statement still
  refuses -- a key that acts and is not accepted, a table of the reach
  without DELETE -- which both adapters' `cascade.integration.test.ts`
  hold (reach-moved, reach-privilege, 0051) and the studio's suites do not.

## Context

0050 let a policy grant delete, and 0051 let a delete reach other tables
through the foreign keys its `cascades` names with their actions. Both
were held on the server: `deleteProblems` refuses at publish, on every
read and in the planner any grant whose reach is not accepted key by key.
The studio could not write either, so the order form -- whose delete
cascades into its lines, its deliveries and their parcels -- could be
granted delete only by a bundle written by hand, as the getting-started
gate's second form is.

Four facts shaped this:

- **The studio's check ran `validatePolicy` alone.** A delete grant over
  the order passes it, so the Policy step would have said "The policy fits
  this form" and the Publish step would have published, and the server
  would have answered with `deleteProblems`' refusals.
- **data-core gave no list of the keys a delete acts through.**
  `deleteReach` gives the tables of the reach and the keys a policy already
  accepts; the keys to ask about are known only inside the walk
  `deleteProblems` takes. A studio that walked the snapshot itself would
  be a second implementation of 0051's walk, which nothing would hold to
  the first.
- **A refusal no acceptance can fix reads like one a box fixes** in
  `deleteProblems`' words: both start "operations.delete grants roles,
  and". Sorting them by their text would pass for the wrong reason the
  moment a sentence changed.
- **Only review compares what refers to a table** (0041, 0050). A key
  added onto the order since publication, DELETE revoked on a table a
  delete reaches, or a gap over what refers to one blocks delete in
  review, while the runtime's verdict over the table's own description
  still allows it. What a delete then meets differs: its statement refuses
  a key that acts and is not named, and a table of its reach it may not
  DELETE from (0051), but a gap that hides only a key that refuses -- one
  declared onto a partition of the table, on PostgreSQL -- lets a delete
  of a record nothing refers to run. A drift report says which changes
  block delete, not which of them a statement would refuse: that is each
  adapter's guard, engine by engine.

## Decision

**The studio's Policy step grants delete and asks for each foreign key a
delete acts through by its own box, says which keys may refuse a delete
and what no box can fix, and checks the policy with the functions the
server refuses it by; the Generate step says whether the form offers
delete, and the Drift step what review leaves of a delete the policy
grants.**

- **data-core's `deleteReview(snapshot, root, policy)`**, beside
  `deleteProblems` in `policy/cascades.ts` and over the same walk: every
  key that acts on a delete, in the order the walk meets it, with whether
  `cascades` names it with its action (`unaccepted`); every key that only
  refuses, on delete or on the update a cleared reference is; each `cascades`
  entry that names nothing the delete acts through, by its place; what no
  acceptance can fix, as the clauses `deleteProblems` puts after
  "operations.delete grants roles, and" -- `deleteProblems` is now built
  from the same clauses, its words unchanged -- and whether the list is
  every key the snapshot can show. The studio decides none of it.
- **Who may do what** gains "Roles that may delete". The roles are
  `operations.delete`, left out of the policy while they name nobody, so a
  policy that grants no delete is one a server older than 0050 still
  reads. The hint says whether the form offers delete, and that a role
  that may delete must also be able to read, so its delete names the
  version it read.
- **The policy check** is `validatePolicy` and `deleteProblems` over the
  proposal's snapshot (`policyCheck`), on every change; the Publish step
  waits on the same list.
- **"What deleting a record of sales.order also does"**, a fieldset shown
  only where the form offers delete: one box for each key that acts --
  "Also deletes the rows of sales.order_line that refer to it
  (fk_order_line_order, ON DELETE CASCADE)", "… that refer to a deleted row
  of sales.delivery" for a key past the root, "Sets … to NULL in the rows of
  …" for one that clears -- ticked when the policy names it with its
  action, and ticking adds it to `cascades`; never one control for them
  all. Each key that only refuses is listed under "The database refuses a
  delete", with no box. What no box can fix is listed in the publish
  check's words under "Delete cannot be granted on this form, whatever is
  ticked". The fieldset says the list is every foreign key the catalog
  shows onto the form's table and each table a delete removes rows from,
  and onto each column it clears -- a key onto another column of a row it
  keeps is not affected, and is not listed -- or that it is not, where a
  gap or a table outside the scope hides some, and then never that no key
  acts; and that triggers and rules are not listed and do what the
  database defines. An acceptance the delete does not act through
  is listed with its Remove, as a stray lookup filter is.
- **A form that offers no delete** shows no reach; acceptances left on its
  policy are listed, each with its Remove.
- **Generate** says "Delete: offered" or "not offered" from the bindings
  through `offers()`, beside create and update, with the generator's
  blocked note; the Choose step's version column and its hint say that
  without one neither update nor delete is offered.
- **Drift** says "Delete: still allowed" or "blocked by the changes below"
  where the published policy grants delete, and nothing of delete where it
  does not. Where review blocks delete and the runtime's verdict allows
  it, delete is among what "the server still allows" (0041), as a create
  or an update is, and the sentence adds what each delete's own statement
  still refuses: a foreign key that acts on it and the policy does not
  accept, and a table it reaches that the account may not DELETE from.

## Consequences

**What it buys.** An administrator grants delete in the studio and sees,
before anything is published, every table a delete reaches through the
keys the catalog shows, accepting each key by reading its own sentence --
and the studio's verdict on a delete grant is the server's, from the same
function: the order form is published deleting with its lines, deliveries
and parcels from the studio, as the getting-started gate's hand-written
form is.

**What it costs.**

- One more fieldset, and a box per key, which grows with the schema: three
  for the fixture's order.
- The list is the proposal's snapshot, taken when the form was generated.
  A key added since is asked about only once the form is generated again;
  until then drift review reports it, and one that acts blocks delete
  there and is refused by each delete's statement, while one that only
  refuses is the database's to enforce.
- It lists foreign keys only. A trigger or a rule that runs on a delete is
  not listed, and does what the database defines (0050); the fieldset says
  so in so many words, every time.
- Where a gap or a table outside the scope hides some keys, the list says
  it is not complete and delete cannot be granted; the person sees why, and
  no box can change it.
- The boxes' sentences and the keys that only refuse are the studio's
  words, not the publish check's; the refusals beside them are the check's.
- data-core exports `deleteReview` and its types, a new entry point a
  release keeps.
- Nothing is unticked for the person: delete roles cleared leave the boxes
  ticked, and the check refuses `cascades` while nobody may delete, until
  they are unticked.
- Where only review sees what blocks a delete, the server still lets a
  host send deletes until the form is published again. The Drift step says
  so, and what each delete's statement still refuses, but not which of the
  changes below it would refuse: behind a gap that hides only a key that
  refuses, deletes run.

**Forecloses:** accepting every key in one step in the studio, and a
studio check that passes a policy the server's publish check refuses for
its delete.

## Alternatives considered

**"Accept all".** Lost: it accepts keys nobody read, which 0051 forecloses
for the policy and this for the studio.

**Hide the keys that only refuse.** Lost: the person would meet a refusal
at runtime they could have been told of before publishing.

**The studio walks the reach from the snapshot itself.** Lost: a second
implementation of 0051's walk, which could disagree with the publish check
and nobody would find out. `deleteReview` is the walk `deleteProblems`
takes, and a test holds its `blocked` to `deleteProblems`' words.

**Sort `deleteProblems`' sentences into those a box fixes and those it
cannot, by their text.** Lost: a check that matches a phrase passes for the
wrong reason the moment the phrase changes; the clauses come from the walk
by kind.

**Never say delete among what "the server still allows".** Lost: right
for a key nobody accepted, which each delete's statement refuses, and
wrong behind a gap that hides only a key that refuses, where deletes run
while the step said only that delete is blocked -- the silence 0041 ends
for a create and an update.

**Say it only where no change behind the block is one the statement
refuses.** Lost: the studio would decide, change by change and engine by
engine, which gap each adapter's guard reads -- a second implementation of
both guards that nothing would hold to them. The sentence says what the
statement refuses instead, and the adapters' suites hold that.

**Show the reach on a form that offers no delete.** Lost: there is nothing
to grant, and the boxes would accept what no delete does; its acceptances
are listed to be removed instead.

**Clear `cascades` when the delete roles are cleared.** Lost: deny by
default changes nothing behind the person's back; the check says why it
refuses, and the boxes are there to untick.

## Older records

Extended, not edited away: 0024 (the Policy step grants delete and asks for
each key of its reach; Generate and Drift say delete), 0050 (the studio
grants delete, and checks a policy with `deleteProblems` as the server
does) and 0051 (the studio writes `cascades`, one key at a time, through
`deleteReview`, the walk `deleteProblems` takes).
