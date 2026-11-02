# 0127 — A host page draws a state field as the moves its person may make

- **Status:** accepted; amends [0112](0112-a-policy-holds-a-state-field-to-the-moves-it-lists.md): the form names a person's moves, and the host draws the state field as them, where 0112 left every value offered; extends [0122](0122-a-host-page-draws-a-saved-record-for-the-update-and-a-new-one-for-the-create.md): the host's copy of a saved record is drawn from the state it holds too
- **Date:** 2026-11-02
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/records/transition.test.ts` --
  a person is offered the moves `checkTransition` lets them make and no
  other: every pair of states asked of the check answers as the offer
  says, for each of three people (watched failing with every move offered
  whatever its roles: the clerk was offered shipped to delivered).
  `packages/data-server/src/routes/runtime-transitions.test.ts`, over fake
  ports -- the form names each person's moves and no other's (watched
  failing with the moves left out of the form: the page was told nothing).
  `packages/data-client/src/transport.test.ts` -- a form's `moves` is
  `null` or a field and moves between states, and a reply without it is
  unexpected (watched failing with `moves` left unchecked).
  `apps/host/src/session-work.test.ts`, without a server -- a saved
  record's state drawn as a choice of where it is and where it may go, its
  label kept, disabled where it may go nowhere, a new record's as where a
  create may start it, a field no moves hold left as published, and a
  whole number's box kept (watched failing with the session drawing the
  form as published: a text box on every record).
  `apps/host/src/moves.test.tsx`, on both engines against the real server,
  in both renderers (watched failing in CI with the session drawing the
  form as published: no Status choice was drawn).

## Context

0112 holds a state field to the moves a policy lists, and checks each
change in the planner. Its form still offered every value the field
accepts: a clerk could type "delivered" into a placed order's status,
press Save, and only then read that the move was refused. The page could
not do better, since it was never told which moves the person may make.

## Decision

**The form names the moves this person may make** (`stateMoves`,
`packages/data-core/src/policy/evaluate.ts`): `GET /v1/forms/:id` carries
`moves`, the state field and each move from a state -- or from nothing,
on a create -- to another, for one of the person's roles, in the policy's
order and without the roles; `null` where the policy names no state field
or the person may write neither create nor update. It reads the policy as
`checkTransition` reads it, so the moves offered are those the check lets
through and no other.

**The host draws the state field as those moves** (`apps/host/src/moves.ts`),
in the copy of the form it draws each record with (0122): on a saved
record, a choice of the state it holds, first, and each it may move to; on
a new one, a choice of the states a create may start it in. Where the
person may move it nowhere, the field is drawn disabled, as a field
nothing writes, and a new record left to the column's default. The
field's label, help text and whether it is required are kept; each state
is labelled as the column spells it.

**The server still checks every move** (0112). The drawing is
presentation: a page that drew a stale choice is refused on Save, as
before.

## Consequences

**What it buys.** A person picks a move they may make, rather than typing
a state and reading the refusal after Save.

**What it costs.**
- A state is labelled as the column spells it: "placed", not a label of
  the administrator's.
- The choice is drawn when a record is opened: after a save the form keeps
  the choice it was opened with, so the next move is offered once the
  record is opened again.
- A whole number held to moves keeps its number box, which still accepts
  any value; it is only drawn disabled where the person may move it
  nowhere.
- A person who may not read the state field is drawn the field as
  published, since the page does not know where the record is.
- This release's `@formancy/data-client` requires `moves`, so it refuses
  a form from a server of an earlier release as `unexpected`.
- Not measured in the browser gates: the choice is formancy's own select,
  drawn by its renderers.

**What it forecloses.** Nothing.

## Alternatives considered

**Send the whole rule, roles included, and let the page choose.** A page
would know which moves the policy keeps for other roles, and the choice
would be made twice, as 0124 says of a view's roles.

**Narrow the choice in the published document.** The document is one for
every person and every record; the moves depend on both.

**Labels for states in the presentation.** A later change: a state's
label is presentation, and the policy's values are the column's.
