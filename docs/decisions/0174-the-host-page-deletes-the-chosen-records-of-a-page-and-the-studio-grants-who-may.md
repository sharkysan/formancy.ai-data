# 0174 — The host page deletes the chosen records of a page, and the studio grants who may

- **Status:** accepted
- **Date:** 2026-11-22
- **Deciders:** Daniel Bacher
- **Verified by:** the host page's Delete the chosen…, its confirmation
  and what it says of each record, and the studio's grant. Written on a
  machine without Docker on 2026-11-22: the cases that need no database
  ran there, each watched failing with its rule taken out and the file put
  back byte for byte; the host's suites that start the databases, and its
  browser gate, have never run, and CI is their first run.
  Ran and watched failing:
  `apps/host/src/chosen-deletion.test.ts`, run with a configuration of its
  own without the databases its package's suites start, which it does not
  use -- the confirmation says a cascade, a reference cleared or a record
  kept only where the form's `deleting` does, and of one record a delete
  of it alone's words (watched failing with the cascade said on every
  form); asked again while out it is the same deletion, focused again
  (watched failing with a second ask replacing the deletion out); each
  record's fate in the order sent -- deleted, changed since, not found,
  referred to, declined, its own answer lost, not sent -- said, marked and
  counted, a 404 never called deleted (watched failing with a 404 read as
  a refusal); done for every record closes (watched failing with Close
  kept from it); a request refused whole is the server's sentence (watched
  failing with the refusal dropped); a lost request is checked record
  by record, only what is still unknown read again (watched failing with
  the check reading every record again); a check that finds none gone
  says only what it read, none deleted where every record is still
  stored (watched failing with "0 of 2 records are not there any more");
  the open record a check found gone is left open until Close the record
  (watched failing with it forgotten by the next check); and the count is
  said in teal only where this request deleted some, once for its answer
  (watched failing with it said wherever the request was answered).
  `apps/host/src/leave.test.ts`, the same way -- a confirmation's list
  names each form once, and asks again only for a form it did not name,
  the one rule the three confirmations ask (watched failing with each
  form kept however often it was named, and with every form at risk
  asked again).
  `apps/host/src/chosen-rows.test.ts`, the same way -- a deletion's answer
  takes the records gone from the choice and marks the rest, never
  choosing again a record unticked while it was out, and a box ticked
  drops the marks (watched failing with the marks kept past a box, and
  with the marks' records taken as the choice); a question holds only
  while the same records are chosen, in any order (watched failing with
  the count compared alone).
  `apps/host/src/choose-column.test.tsx`, the same way -- a box whose
  record a deletion did not delete is described by why, its title, until
  the choice changes, and axe passes (watched failing with the mark left
  off the box's title).
  `apps/studio/src/policy-bulk.test.tsx`, against the real server behind a
  fake `fetch` -- nobody by default, a box for each role given delete, and
  the grant published exactly `bulk.delete.roles`, which `validatePolicy`
  accepts, and no `bulk` once the last box is unticked (watched failing
  with the box's change left unwritten, and with an empty grant kept); a
  ticked role that may no longer delete kept, described by why the server
  refuses it (watched failing with the boxes drawn from the delete roles
  alone); nothing offered on a form with no delete, nor on rows saved
  with their record, each said why (watched failing with `offers()` asked
  in place of `offeredFor`); a grant left from a generation that offered
  delete, and one imported that names nobody, listed to remove, Remove
  taking it out of what publishes, the keyboard on the policy check
  (watched failing with Remove writing nothing, with the keyboard moved
  from the notice that goes with the grant, and with the notice drawn
  only for a grant that names a role); and a draft's policy, as its
  publisher reads it, naming who may delete chosen records together
  (watched failing with the line left out).
  First run in CI, never run: `apps/host/src/bulk-delete.test.tsx`, on
  both engines -- five removable records deleted together, one changed,
  one deleted and one referred to beside the page, the confirmation in the
  form's words with no cascade, headed a level under the grid, and Keep
  them the next Tab, the outcome naming each not deleted in the server's
  words and described by all it says, the two deleted gone from the
  choice and the database, the others still chosen, named on the bar and
  described on their boxes, axe at each state; the order form's cascade
  said and done, the open order's form listed as discarded, the other
  typed into while it asked named before anything is sent, and the
  detail closed once it is deleted; the open order deleted beside the
  page answered not found and closed, its typing listed; a lost answer
  after and before the server deleted them, the guard asking before
  another form, Check them reading each and nothing sent again, none
  deleted said as none; the open order a check found gone, typed into
  after the lost answer, left open until Close the record; a question
  closed by Escape, by Keep them, by a box unticked and by Clear the
  choice, the keyboard back on the bar's button, one record's question in
  a delete's own words, nothing chosen saying what to do first, and no
  box on the order lines, which grant a delete and no deletion of chosen
  records; a second press while out sending nothing, the open order's
  Save held, and another order's opened meanwhile; and Delete them
  waiting for a save of the open order out, then sending the version it
  moved to.
  `apps/host/src/plane.test.tsx` -- the journey sends `delete-chosen` on
  the page's own origin, the exception 0173 left there gone, and the
  demo's door alone keeps it unsent. `apps/host/src/page.test.tsx` -- axe and a
  name on every control in each state: chosen, confirming, deleting,
  answered, a box marked, may have been deleted and checked.
  `apps/host/scripts/browser/choosing.mjs` in Chromium, Firefox and WebKit
  at every width -- the confirmation, the keyboard on it and Keep them the
  next Tab, and Delete them from the keyboard once the gate's measure has
  given it back to Keep them, the keyboard on what the server answered,
  one order deleted and the other still chosen.
  Held by no test: the Drill down levels that hold a chosen record other
  than the open one, listed in the confirmation and dropped once it is
  gone. The fixture has no form that is its own child and may be
  deleted, and a level holding another chosen order is reached only
  through Open under a line's lookup (0141); the levels are asked through
  the same `HeldLevels` a row's Delete asks (0094), which its own suites
  hold.

## Context

0173 built the server's half of deleting the chosen records of a page --
`FormPolicy.bulk.delete`, `PublishedForm.bulk`, the route, data-client's
`deleteChosen` and `reconcileChosen` -- and left the host page with no
control that sends it and the studio with no grant, so an administrator
wrote `bulk` into a policy by hand, and `apps/host/src/plane.test.tsx`
held the route unsent. 0166 had given the Records grid a column of boxes
and a bar above it, drawn where the form offers an action over a
selection, with a choice of the page shown and rules for a question over
it. 0053 deletes one record after a confirmation in place worded by the
form's `deleting`, closing the open record when it is the one deleted.

## Decision

1. **Where.** The box column and the bar are drawn where the form serves
   its person a deletion of chosen records (`bulk.delete`) or an action
   over a selection, on the Records grid alone. The bar gains **Delete the
   chosen…**, which with nothing chosen is `aria-disabled` and says what
   to do first, as an action's button does; that sentence now names no
   action.
2. **The confirmation**, in place under the bar
   (`apps/host/src/chosen-delete-region.tsx`), headed by how many records
   and the form's title -- "Delete 3 chosen Order records?" -- since no
   plural of a title is guessed. It says each is deleted on its own, at the
   version this page read it at, one that cannot be named and the others
   deleted; that they go for everyone; and, only where `deleting` says
   so, that records referring to one go with it, lose that reference, or
   keep it. One record chosen is a delete of it alone, in 0053's words.
   The forms its deletion drops -- the open record's where it is chosen,
   the Drill down levels that hold a chosen record (0094) -- are listed,
   and named again before anything is sent where they were typed into
   since. Keep them is the next Tab; Escape is Keep them.
3. **0166's rules for a question over a choice**
   (`apps/host/src/chosen-delete-flow.ts`, beside `action-flow.ts`, the
   rule itself `chosen-rows.ts`'s `holdsAsked`, which both flows ask): a box
   ticked or unticked, Clear the choice, or another page drawn closes it,
   nothing sent; Delete them sends the records chosen as it is pressed,
   each at the newest version the page knows, and waits for a save of the
   open record out where it is chosen; while the deletion is out, that
   record's Save sends nothing and says why (`session.hold(…, 'bulk')`),
   and a second press of either button sends nothing.
4. **What became of each** (`apps/host/src/chosen-deletion.ts`), in the
   region the keyboard is taken to and described by all it says: "Deleted
   2 of 3 records.", each record not deleted by the words its row's Delete
   names it with, in the server's words -- a 404 as 0053 says one, never
   deleted -- and "Not sent, so not deleted: …" for those after a stop.
   The page is read again; the records deleted, not found or found gone
   leave the choice and the page, the open record among them closed as a
   delete closes it; the others stay chosen, the bar naming them, each box
   described by why -- its title -- until the choice changes
   (`chosen-rows.ts`'s `settle`).
5. **A lost answer** -- the request's, or one record's, at which the
   server stopped -- offers **Check them**, `reconcileChosen` reading each
   record not known, as a delete's check reads one (`deletion.ts`'s
   `checkedOf`): at the version sent or changed since, not deleted and
   kept chosen; gone, deleted by this request or by somebody else's,
   which the page cannot tell apart and says. A check that finds none
   gone says only what it read: "None of the chosen records was deleted."
   where every one is still stored. The open record a check finds gone is
   closed only where its forms hold no work: the lost answer gave its Save
   back, and what was typed since was never listed, so it is left open,
   the region naming it, until **Close the record**, as after a delete's
   check (0053). Nothing is sent again from an outcome; a deletion of what
   is left is a new question from the bar.
6. **The guard counts it** as the records grid's work, as a run over a
   selection is (0166): out, or answered with a record not known and not
   checked, it goes only with the grid -- another form, Back or Forward,
   Sign out -- which ask first.
7. **The studio's grant** (`apps/studio/src/policy-bulk.tsx`, its change
   `policy-model.ts`'s `withBulkDeleteRoles`): on the Policy step, "Who
   may delete chosen records together", a box for each role given delete,
   unticked, read with what deleting together does. Nothing is offered,
   each saying why, on a form that offers no delete, on a together child
   (0173's refusals, by data-core's `offers` and `offeredFor`), or while
   nobody may delete. A ticked role that may no longer delete keeps its
   box, described by why the server refuses it; a grant on a form that
   cannot offer one is listed to remove, one that names nobody among
   them. What it publishes is exactly `bulk: { delete: { roles } }`, and
   no `bulk` where no box is ticked. A draft's policy, as its publisher
   reads it on the Review step (0065, `draft-policy.tsx`), names who may
   delete chosen records together wherever the policy holds a grant.

The record's own forms -- one session per renderer, known to the guard,
and how a record opens in them -- moved out of `form-view.tsx` into
`master-panes.ts`, as what changes when the forms do, to make room under
the size budget for what closes the open record a deletion took.

## Consequences

**What it buys.** A person deletes up to a page of records they chose in
one press and one confirmation, told what became of each, those not
deleted left chosen with why; an administrator grants it to the roles
that should have it, from the studio, and nobody has it by default.

**What it costs.**

- **A set left half deleted, now in front of the person.** The
  confirmation says before that one that cannot be deleted is named and
  the others deleted; the outcome says after which, record by record, and
  nothing is undone. A set that must go whole is an action's (0165).
- **What the confirmation cannot know.** It says what deleting them may
  do, from the form's `deleting`, never which record will be refused: a
  record changed since the page read it, referred to, or declined is found
  only by sending it.
- **A record not found leaves the page and closes the open record.** It
  may be one the person may no longer see rather than one deleted; either
  way the form cannot save it, and the open record's typing goes with it,
  as the confirmation listed.
- **Why a record is still chosen is a box's title.** A screen reader says
  it as the box's description and a pointer shows it on hover; a person
  who neither uses one nor points sees the bar's line, which names the
  records still chosen, up to a page of names, and not each reason once
  the region is closed.
- **A record whose answer was lost and found still stored stays chosen**
  and is deleted only by asking again from the bar, a new confirmation:
  there is no Delete them again.
- **The open record a check found gone can stay open.** Where its forms
  hold work, the detail shows a record that is not there until the
  person presses Close the record or asks for something else, as after a
  delete's check (0053).
- **The open record's Save is held while a deletion over it is out**,
  even where the person opens another record meanwhile, as a run over a
  selection holds it (0166): that record's Save says the deletion's words
  until the answer comes.
- **The studio offers only roles already given delete**: a role that
  should delete chosen records together is given delete first.
- **The demo shows none of it**: the live demo's forms grant no
  deletion of chosen records, so its page never offers Delete the
  chosen…, and plane.test's journey through the demo's door does not send
  it.
- **No picture shows it.** The pictures' own plane grants no `bulk`, so no
  README or guide picture changes, and none pictures the confirmation or
  the outcome.

**What it forecloses.** Nothing: changing chosen records to values is a
later record's, through the same bar and the same rules.

## Alternatives considered

**A loop of 0053's single deletes, from the page.** Lost: a write id and
a confirmation per record, and no one answer to read; 0173's route is
the server's loop, once per write id.

**A dialog over the page.** Lost: 0053 and 0162 confirm in place, with no
overlay, and the keyboard and the guard already know that shape.

**The reason in the row's first cell.** Lost: the Choose column is a
24-pixel box at most 120 pixels wide, where a sentence clips at every
width; the bar names the records and each box's title says why.

**Delete them again after a check.** Lost: the records found stored are
still chosen, and Delete the chosen… is that question, asked anew over
the choice as it is.

**A typed list of roles in the studio, as an action's.** Lost: every role
must be one given delete, which a box per delete role makes the only
choice; a role typed there that may not delete would be refused at once.

**Closing the open record only when this request deleted it.** Lost: a
form open on a record that is not there saves nothing, and its typing
was already listed as discarded with it.

**Closing the open record a check found gone, whatever its forms hold.**
Lost: from the lost answer on its Save was the person's again, and what
they typed then was listed nowhere, so closing it would drop that
unasked. **Asking the guard instead of offering Close the record** lost
too: it would need a request of its own, worded for a record that is
not there, where 0053's check already answers the same case with a
button in the region.

## Older records

Extended, not edited away: 0047 (the Records grid's boxes and bar on a
form that offers a deletion of chosen records too, and that deletion the
grid's work to the guard); 0053 (several records deleted after one
confirmation in place in the same words, the open record closed as one
delete closes it, the session's hold kept apart as `bulk`); 0166 (the
column and the bar drawn for the deletion too, its button with nothing
chosen saying what to do first in words that name no action, and a
choice settled by a deletion, its records marked); and 0173 (the host page
sends `delete-chosen` and the studio grants `bulk.delete`, so its cost
that only a client of the deployment's own sends one, and plane.test's
exception for the route, hold no longer but on the demo's door).
