# 0176 — The host page changes the chosen records of a page, and the studio grants who may and in which fields

- **Status:** accepted
- **Date:** 2026-11-22
- **Deciders:** Daniel Bacher
- **Verified by:** the host page's Change the chosen…, its fields on
  paper, its confirmation and what it says of each record, the rule a
  deletion of the chosen records now shares with it, and the studio's
  grant. Written on a machine without Docker on 2026-11-22: the cases that
  need no database ran there, each watched failing with its rule taken out
  and the file put back byte for byte; the host's suites that start the
  databases, and its browser gate, have never run, and CI is their first
  run.
  Ran and watched failing:
  `apps/host/src/chosen-change.test.ts`, run with a configuration of its
  own without the databases its package's suites start, which it does not
  use -- the fields offered are `bulk.update`'s in the form's order
  (watched failing with the grant's order); the paper is the form narrowed
  to the fields ticked, a section left with none of them dropped and no
  field at a default (watched failing with the empty section kept); the
  state field offers every state some chosen record may move to from the
  state the page read it in, every state a move reaches for one whose state
  the page did not read, and is disabled where none may go (watched failing
  with the first record's states alone); a new paper keeps what was typed
  into the fields still ticked (watched failing with each paper started
  empty); a field left empty is sent `null`, and the confirmation says each
  value -- an option by its label, a lookup by its record's label or its
  token, a yes or no, "cleared" (watched failing with the empty field left
  out); the lead says each record is changed on its own, each moves from
  its own state where the state field is set, and what clearing leaves
  (watched failing with the state's sentence said whatever was set); a
  deletion asked while a change is out is that change asked again (watched
  failing with the deletion replacing it); each record's fate is said in a
  change's words (watched failing with the outcome in a deletion's words);
  a request refused whole is a change's refusal (watched failing with it
  kept as a deletion's); a lost answer is checked as an update's, a
  record gone answered not found rather than done (watched failing with a
  404 read as a deletion's "gone"); and a record is found changed once, by
  the answer or by the check that found it, so the open record is read
  again once (watched failing with a check finding again every record
  found so far).
  `apps/host/src/chosen-deletion.test.ts`, the same way, its assertions as
  0174 wrote them, run against the rule a change shares
  (`chosen-request.ts`): every case still passes, so a deletion of chosen
  records says and does what it did.
  `apps/host/src/chosen-rows.test.ts`, the same way -- the choice keeps each
  record's answers as the page drew it last, the state a change's state
  field moves each record from (watched failing with the first read's
  answers kept). `apps/host/src/leave.test.ts`, the same way -- the open
  record read again after a change drops its own forms but those its
  confirmation listed, never the records grid's request (watched failing
  with the request dropping as a row's does), and the guard says a change
  out, or one that may have been made, in words of its own.
  `packages/data-core/src/policy/validate.test.ts` -- `unsettableField`,
  the reason the studio shows beside a field it does not offer, is the
  function the policy check refuses a `bulk.update` field by, in its words
  (watched failing with the pinned column left out).
  `packages/data-core/src/policy/read-together.test.ts` -- the bundle's
  check of a field a rule reads together with another says it in
  `readTogetherReason`'s words, which the studio shows (watched failing
  with the check worded on its own).
  `apps/studio/src/policy-bulk.test.tsx`, against the real server behind a
  fake `fetch` -- nobody by default, a box for each role given update and
  for each field, every field the server's checks refuse shown unticked
  and not offered, described by `unsettableField`'s reason, one nobody
  given update writes said so; a role alone grants nothing and says so;
  with Notes the policy publishes exactly `bulk.update { roles, fields }`
  beside a deletion's grant, which the real server stores and
  `validatePolicy` accepts, and none once Notes is unticked (watched
  failing with the field's tick left unwritten); a field a rule reads
  together with another not offered, in the check's words (watched failing
  with `readTogether` left unasked); nothing offered on a form with no
  update alone, nor while nobody may update, and a delivery saved with its
  order offering a change of its rows but never of the field that names
  the order (watched failing with `offeredFor` asked of delete); and a
  hand-written grant's refused role and field kept ticked, described by
  why, until unticked (watched failing with a refused field's box disabled
  whatever it held). The studio's other suites that read the Policy step
  -- policy, journey, guide, review, delete-reach, policy-actions,
  policy-moves, choose-together, choose-versions, choose-stamps,
  regenerate, publish, state-labels, starting-value, presentation -- ran
  and pass.
  First run in CI, never run: `apps/host/src/bulk-update.test.tsx`, on
  both engines -- three orders changed together on the order form whose
  status moves from draft to placed to shipped, one changed beside the
  page: a box for each field granted, none ticked; Status offering placed
  alone; the confirmation saying each field and its value and that each
  record moves from its own state, Keep them the next Tab; the outcome
  naming the one changed since stale and the shipped one's move refused,
  in the server's words, the draft changed in the database and gone from
  the choice, the others chosen and described on their boxes, axe at each
  state; two removable records' note cleared, said before it is sent, and
  NULL once changed; the paper drawn under React and under Angular, a
  customer found by its typeahead and named in the confirmation; the open
  order typed into, listed, changed and read again into its forms, its next
  Save stored; a lost answer after and before the server changed them, the
  guard asking before another form, Check them reading each and nothing
  sent again; a question closed by Escape, by a box unticked and by Clear
  the choice, nothing chosen saying what to do first; a second press while
  out sending nothing, the open order's Save held in the change's words, and
  its form typed into meanwhile asked about before it is read again.
  `apps/host/src/plane.test.tsx` -- the journey sends `update-chosen` on
  the page's own origin, the exception 0175 left there gone, and the demo's
  door alone keeps it unsent. `apps/host/src/page.test.tsx` -- axe and a
  name on every control in each state: the fields, the paper, confirming,
  changing, answered, a box marked, may have been changed and checked.
  `apps/host/scripts/browser/choosing.mjs` in Chromium, Firefox and WebKit
  at every width -- the fields' region, the next Tab on the first field's
  box, Note on paper, the confirmation with Keep them the next Tab, and
  Change them from the keyboard, the keyboard on what the server answered,
  one order's note changed and the other still chosen.
  Held by no test: the open record whose read after a change is refused,
  which keeps its forms at the version from before; a lookup's label that
  cannot be read, said by its token; and a studio box ticked alone left
  ticked after an import replaces the policy under the step.

## Context

0175 built the server's half of changing the chosen records of a page --
`FormPolicy.bulk.update { roles, fields }`, its refusals in `bulk-fit.ts`
and `read-together.ts`, `POST /v1/forms/:id/records/update-chosen`,
`GET /v1/forms/:id`'s `bulk.update`, data-client's `updateChosen` and
`reconcileChosen` for a change -- and left the host page with no control
that sends it and the studio with none that grants it, keeping a grant an
administrator wrote by hand. 0174 had built the host page's deletion of
the chosen records: the bar's Delete the chosen…, a confirmation in place,
what became of each record, the marks on the boxes still chosen, the
settled choice, Check them, the `'bulk'` hold and the guard's count, each
in a file named for the deletion. 0166 gave the grid the column of boxes,
the bar and the rules for a question over a choice; 0162 draws an action's
dialog on paper under what asked, and reads the open record again after
a run changed it.

## Decision

1. **Where.** The box column and the bar are drawn where the form serves
   its person a change of chosen records in some field (`bulk.update`), as
   where it serves a deletion of them or an action over a selection. The
   bar gains **Change the chosen…** before Delete the chosen…,
   `aria-disabled` until something is chosen and saying what to do first,
   as Delete's is.
2. **The fields** (`apps/host/src/chosen-change.ts`,
   `chosen-change-region.tsx`), in the region under the bar where 0162's
   dialog and 0174's confirmation are drawn: headed by how many records --
   "Change 3 chosen Order records" -- a box for each field `bulk.update`
   offers, none ticked, read with what ticking one does; each ticked
   field drawn on white paper in Blueprint by the renderer the person
   shows, React where both are, the published form narrowed to the fields
   ticked (`widgets.ts`'s `onlyFields`, over `withoutField`) with no
   default, a section left empty dropped, its lookups the form's own
   typeahead under the update's filter. A new paper for each box keeps
   what was typed into the fields still ticked. The state field offers
   every state some chosen record may move to from the state the page read
   it in (`moves.ts`'s `withMovesOver`), none first; the server checks
   each record's move from its own state (0175). Continue runs the
   engine's submit, then reads the label of each record a lookup it sets
   names, as the typeahead reads one.
3. **The confirmation**, in place, "Change 3 chosen Order records?": each
   field and its value -- "Status: placed", an option by its label, a
   lookup by its record's name, "Notes: cleared" for a field ticked and
   left empty, which is sent `null` -- that each is changed on its own at
   the version this page read it at, one that cannot be named and the
   others changed, that the state field moves from each record's own
   state where it is set, and what a field cleared leaves; and the open
   record's forms that hold work, which reading it again drops. Keep them
   is the next Tab; Escape is Keep them.
4. **One rule for a deletion and a change**
   (`apps/host/src/chosen-request.ts`, `chosen-flow.ts`,
   `chosen-flow-state.ts`, `chosen-region.tsx`, out of 0174's
   `chosen-delete-flow.ts` and `chosen-delete-region.tsx`): each record of
   either is a write of its own, so their states, what became of each
   record -- done, not found, refused in the server's words, not sent,
   unknown, found by a check -- the count and its "Not sent, so not …"
   line, what leaves the choice and what stays marked, the settled line,
   the hold, the question closed when the choice changes, a second press
   sending nothing, Check them and the guard's count are one, said in each
   one's words. What stays apart is what differs: the delete's lead from
   `deleting` and its closing of the record it took
   (`chosen-deletion.ts`); the change's fields on paper, its values and
   its words (`chosen-change.ts`, `chosen-change-flow.ts`). One request
   over the choice is out at a time, so the one `'bulk'` hold is never
   lifted by another's answer: a change asked while a deletion is out, or
   not known yet, is that deletion asked again, and the other way round.
5. **What became of each**, in the region the keyboard is taken to and
   described by all it says: "Changed 11 of 12 records.", each record not
   changed by name in the server's words -- changed since, a move refused,
   declined, not found -- and "Not sent, so not changed: …" after a stop;
   a request refused whole is "Not changed", the server's sentence, and
   that none was. The page is read again; records changed leave the
   choice; those not changed stay chosen, each box's title saying why
   ("Not changed. …"). The open record, chosen and changed, is read again
   into its forms through the guard, as after a run (0162): those its
   confirmation listed drop without asking again, one typed into since is
   asked about, and its Save says why until the read answers.
6. **A lost answer** offers **Check them**, `reconcileChosen` reading each
   record as an update's check reads one: at the version sent, not
   changed and kept chosen; moved on, changed by this request or by
   somebody else's, which the page cannot tell apart and says, and gone
   from the choice; its record gone, not found, the read's own answer --
   the design's `absent` is a deletion's, and the code keeps 0175's
   reading. The open record a check finds moved on is read again through
   the guard, which asks about every form typed into, since the lost
   answer gave its Save back. Nothing is sent again from an outcome. The
   guard counts a change out, or answered with a record not known and not
   checked, as the grid's work, in words of its own.
7. **The studio's grant** (`apps/studio/src/policy-bulk-change.tsx`, its
   change `policy-model.ts`'s `withBulkUpdate`): on the Policy step, "Who
   may change chosen records together, and in which fields", a box for
   each role given update and one for each field, none ticked, read with
   what changing together does. A field no change of chosen records may
   set is shown unticked and not offered, saying why in the server's own
   words: `bulk-fit.ts`'s `unsettableField`, now exported and asked by the
   policy check too -- the key, written on create only, written by the
   database, stamped, pinned, a version chain's, the together field -- and
   `read-together.ts`'s `readTogether` with its `readTogetherReason`; so is
   a field nobody given update writes. A ticked role or field the server
   refuses keeps its box, described by why, until unticked. Nothing is
   offered where no update of a record alone is, nor while nobody may
   update, each saying why. It publishes exactly `bulk.update { roles,
   fields }`, none while no role or no field is ticked -- a box ticked
   alone is the step's own until the other is, said as granting nothing
   yet -- and `withBulkDeleteRoles` keeps it, as 0175 made it. The stray
   grants 0174 and 0175 list to remove are as they were: a `bulk.update`
   on a form that offers no update is the policy check's to name, with no
   Remove of its own.

**Where the code disagrees with the design.** The design kept a together
child's rows out of a change, as a deletion keeps them; 0175's check grants
one, since a together child offers an update of a row alone (0155), so the
studio offers it there and refuses only the field that names the record the
rows are saved with. The design's heading "Change the chosen orders: 3
records?" is 0174's, "Change 3 chosen Order records?", so no plural of a
title is guessed.

## Consequences

**What it buys.** A person sets up to a page of chosen records to the same
values in one press and one confirmation, on the paper their forms are
drawn on, told what became of each, those not changed left chosen with
why; an administrator grants it to the roles and fields that should have
it, from the studio, told why a field cannot be offered; and a deletion and
a change of a choice answer by one rule, so the two cannot drift apart.

**What it costs.**

- **A set left half changed, now in front of the person.** The
  confirmation says before that one that cannot be changed is named and
  the others changed; the outcome says after which, record by record, and
  nothing is undone. A set that must change whole is an action's (0165).
- **The page cannot run a rule over each record's other answers.** The
  paper holds the fields ticked and nothing else, so a rule that reads
  another field cannot be run there for fifty records, which is why 0175
  refuses such a field and the studio does not offer it; the paper runs
  only a field's rules about itself.
- **What the confirmation cannot know.** It says each value and that each
  record moves from its own state, never which records will be refused: a
  record changed since, a state it may not move from, a trigger's decline
  are found only by sending. The state field offers every state some chosen
  record may reach, so it offers moves others cannot make.
- **A field ticked and left empty is cleared**, `null` for every record; a
  column that may not be NULL is required on the paper, and cannot be
  cleared.
- **One value for every record**: no value per record, no expression, no
  preview.
- **A lookup's value is read once more** before the confirmation, as the
  typeahead reads one; where it cannot be read, the confirmation names the
  record by its token, and the change sends the token either way.
- **One request over the choice at a time.** A change cannot be asked while
  a deletion of the choice is out or not known, nor a deletion while a
  change is: the bar's other button asks that one again.
- **A request refused whole** -- a value no codec takes, a lookup outside
  its filter -- says the server's sentence and that none was changed; the
  person asks again from the bar, and the paper's typing is not kept.
- **The open record read again after a change drops what its forms held**
  where the confirmation listed them, as after a run (0162); a form typed
  into since is asked about. Its Save is held while the change is out, even
  where another record is opened meanwhile.
- **A studio box ticked alone is not in the policy.** A role with no field,
  or a field with no role, is held by the step and said as granting
  nothing; it is lost with the step. A field no role given update writes is
  not offered until one is given write under Fields.
- **The demo shows none of it**: the live demo's forms grant no change of
  chosen records, so its page never offers Change the chosen…, and
  plane.test's journey through the demo's door does not send it.
- **No picture shows it.** The pictures' own plane grants no `bulk`, so no
  README or guide picture changes, and none pictures the fields, the
  confirmation or the outcome.

**What it forecloses.** Nothing: a value per record, an expression, and
every row a filter lists stay later records'.

## Alternatives considered

**A flow of its own beside 0174's.** Lost: two flows over one choice could
each be out at once, the first answer lifting the other's `'bulk'` hold,
and two copies of the outcome, the marks, the settle and the check that
nobody would find disagreeing until one changed.

**Every field of the form on the paper, those not ticked disabled.** Lost:
a disabled field still submits, and a rule of the form could read a field
the change does not set; the narrowed form holds what is sent and nothing
else.

**The state field as every state the column allows.** Lost: a state no
chosen record may move to is a refusal for every record, offered as a
choice.

**The lookup's token in the confirmation.** Lost: a person chose a
customer by its name, and confirming "Customer: k1:42" asks them to
recognise a key.

**Back to the fields after a request refused whole, its typing kept, as an
action's dialog.** Lost for now: a change's answers are checked once for
the request, so such a refusal is rare -- a lookup outside its filter, a
value the engine let through -- and asking again from the bar is a new
question over the choice as it is.

**A typed list of fields in the studio, as an action's roles.** Lost: every
field must be one the checks let a change set and an update role may
write, which a box per field, refused ones said why, makes the only
choice.

## Older records

Extended, not edited away: 0162 (a change's fields drawn on paper under
the bar as an action's dialog is, and the open record read again after a
change as after a run); 0166 (the column and the bar drawn for a change
too, its question closed by a change of the choice); 0174 (its deletion's
states, outcome, marks, settle, check and hold now one rule a change
shares, in `chosen-request.ts` and `chosen-flow.ts`, its files renamed);
and 0175 (the host page sends `update-chosen` and the studio grants
`bulk.update`, so its cost that only a client of the deployment's own
sends one, and plane.test's exception for the route, hold no longer but on
the demo's door).
