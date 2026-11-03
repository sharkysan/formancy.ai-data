# 0129 — An administrator labels a state field's states

- **Status:** accepted; extends [0030](0030-presentation-is-a-patch-over-the-generated-base.md): a presentation may hold the labels of the state field's states; amends [0127](0127-a-host-page-draws-a-state-field-as-the-moves-its-person-may-make.md): a state is offered by the label its administrator gave it, where 0127 offered it as its column spells it
- **Date:** 2026-11-03
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/presentation/state-labels.test.ts`
  -- the labels are read by shape, a state once and words a person can
  read (watched failing with `states` not a property of a presentation:
  every label was refused); they fit the states the policy's moves name
  and nothing else (watched failing with every label let through: lost
  was stored); a regeneration carries them as they are (watched failing
  with them left out of the carried presentation); a person is offered
  the labels of the states their own moves name (watched failing with
  every label offered: the clerk was told what delivered is called).
  `packages/data-server/src/routes/admin.test.ts` -- a label for a state
  no move names is refused at the write and nothing is written (watched
  failing with the fit left out of `storable`: lost was stored).
  `packages/data-server/src/routes/runtime-transitions.test.ts`, over fake
  ports -- the form names each person the labels of their states (watched
  failing with the presentation's labels left out: the clerk was told
  none). `packages/data-client/src/transport.test.ts` -- a form's moves
  without their labels, or with a label that is not text, is unexpected
  (watched failing with `labels` left unchecked).
  `apps/host/src/session-work.test.ts` -- a labelled state is offered by
  its label, its value the state (watched failing with the labels left
  unread). `apps/studio/src/state-labels.test.tsx`, against the real
  server -- the Presentation step labels each state the moves name and
  publishes the labels (watched failing with them left out of the publish:
  version 1 held none), draws nothing without moves, and publishes no
  label of a state the policy dropped (watched failing with every kept
  label published: the server refused the dropped one).

## Context

0127 draws a state field on the host page as the moves its person may
make: a choice of where the record is and where it may go. Each state was
offered as its column spells it -- `placed`, `in_transit`, `ok` -- since
the policy's values are the column's, and nothing gave them words for a
person.

## Decision

**A presentation may hold the labels of the state field's states**
(`states`, `packages/data-core/src/presentation/state-labels.ts`): a list
of `{ state, label }`, each state as its column holds it and once, each
label words a person can read, in the order the policy's moves name the
states; left out when there are none, never `[]`. It is read by shape on
every read of a version, as the rest of the presentation is. At a write,
each state must be one the policy's moves name (`stateLabelProblems`); a
label for another would be shown nowhere. A regeneration carries the
labels as they are: a state is a value, not a field key.

**A person is told the labels of their states.** `GET /v1/forms/:id`'s
`moves` carries `labels`, those of the states the person's own moves name
and no other, beside the moves (0127).

**The host offers each state by its label**, its value the state as the
column holds it; a state without one is offered as it is spelled.

**The studio edits them** in the Presentation step, after the list views:
"State labels", a box for each state the Policy step's moves name,
"Label of placed", empty for the state as its column spells it. A label
of a state the policy no longer names is neither shown there nor
published. A draft's reviewer is shown them.

## Consequences

**What it buys.** A person moves an order from "Placed" to "On its way"
rather than from `placed` to `in_transit`.

**What it costs.**
- A label is one text, not one for each language a form is shown in.
- A state is labelled only where the policy holds the field to moves; a
  field without moves offers its values as published.
- A label is given in the Presentation step for the states the Policy
  step names: changing the moves after the labels may leave a state
  unlabelled, and a label of a state the moves no longer name is dropped
  from the next publish.
- A server of an earlier release refuses a version whose presentation
  holds `states`, and this release's `@formancy/data-client` requires the
  moves' `labels`, so it reads a form from an earlier server as
  `unexpected`.

**What it forecloses.** Nothing.

## Alternatives considered

**Labels in the policy, beside the moves.** A label is how a state is
shown, not who may move it; the policy holds what the server enforces, and
a reviewer of access would read words that change nothing.

**Options in the published form.** The field stays the column's text box,
which any value fits, where no moves hold it; a choice of every state
would offer a person moves the policy refuses.
