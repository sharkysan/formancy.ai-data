# 0112 — A policy holds a state field to the moves it lists, each for named roles, checked from the record as read

- **Status:** accepted; extends [0011](0011-every-operation-carries-a-trusted-policy-context.md): a policy may name one state field and the moves it is held to, read and fitted with the rest of it; extends [0022](0022-the-runtime-plane-asks-the-policy-every-time.md): a create or an update that changes the state field is a listed move for one of the actor's roles, from the record as read at the version the update names, or 403 `transition-denied` before any statement; extends [0023](0023-the-audit-trail-is-operational-not-evidence.md): every runtime event says whether its write moved the state field, `moved`, and never from where or to where
- **Date:** 2026-10-30
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/records/transition.test.ts` -- the rule
  fitted to its form: a field of the form, text or a whole number, values
  spelled as the column holds them, each move once and none to the value
  it starts from, every role one that may make it (watched failing with a
  move's operation left unchecked: an auditor's grant was accepted); the
  check, a listed move for one of the actor's roles and nothing else, its
  sentence naming no state (watched failing with the roles left out: a
  clerk delivered an order); an update checked from the record as read
  (watched failing with the record left out: placed to shipped was
  refused as a start), the value it holds moving nothing, a record that
  could not be read refused (watched failing with it let through), a NULL
  refused as a move to nothing (watched failing with a NULL taken for no
  change), and a record read at a newer version than the update names
  left to the version guard (watched failing with the move judged against
  the newer read: refused instead of stale); a create checked from
  nothing, and left to the column's default when it does not write the
  field (watched failing with the create unchecked: an order was created
  shipped). `packages/data-server/src/routes/runtime-transitions.test.ts`,
  over fake ports -- a listed move sent as asked and audited `moved: true`
  with no state in the trail (watched failing with the plan's move left
  off the trail: `null`); a move another role's, a step skipped or a step
  back, 403 `transition-denied` with nothing sent (watched failing with
  the code left out of the 403s: 500); a save that leaves the state where
  it is, `moved: false`; a record moved since it was read, 409 `stale`; a
  create started where a move from nothing puts it, refused anywhere
  else, and left to the default. `apps/studio/src/policy-moves.test.tsx`
  -- the Policy step's State moves refused by the policy check until the
  field has a move, a move granted to a role that may not update refused
  in `validatePolicy`'s words, and what fits published as typed (watched
  failing with the moves never written into the policy); every control
  named and axe clean; the keyboard after a removal on the next move, else
  Add a move (watched failing: the page itself); and the draft review
  listing each move with its roles (watched failing with the moves left
  out: no list).

## Context

A policy grants a field's write per role (0011). Whoever may write an
order's status may write any value the column accepts: a clerk can mark
an order delivered the day it is placed, or move a delivered one back to
placed. A CHECK constraint says which values exist, never who may move a
record from one to another; a trigger sees the value before and after,
never the person, since every statement runs as the connection's one
account. A deployment that wants a sequence enforces it in application
code the form does not see, or not at all.

The backlog asked for workflows as state transitions on a status column:
the policy says which role moves which state, the update is guarded, and
the move is audited. No process engine.

## Decision

**A policy may name one state field and the moves it is held to.**
`transitions: { field, moves: [{ from, to, roles }] }`
(`packages/data-core/src/policy/types.ts`). `from: null` is a record with
no state: a create, or a stored NULL. It is read with the rest of the
policy (`policy/inputs.ts`): a property this release does not read is
refused, there is at least one move, no move goes to the value it starts
from, and none is named twice. It is fitted to the form
(`transitionFitProblems`, `policy/validate.ts`) on publish and on every
read of a bundle (0019): a column field of the form whose value is text or
a whole number, the shapes a key's values are spelled in (`isKeyValue`);
every value spelled as the column holds it; and every role of a move one
that may make it -- update, or create for a move from nothing, and read
and write the field.

**Every change of the field is a listed move, decided in the planner**
(`records/transition.ts`, `planMove`): after the answers are decoded and
the memberships planned, before any statement. The value written is
compared with the record as read, the read the update route already
makes (0040): the same value moves nothing; any other is a move from the
value read to the value written, allowed when a move lists that pair for
one of the actor's roles (`checkTransition`, `policy/evaluate.ts`).
Refused, it is 403 `transition-denied`, with a sentence that names the
field and never a state, as every policy sentence names no value (0011).

A create's move starts from nothing. A create that does not write the
field leaves it to the column's default: the schema's start, which the
person did not choose. No move ends at NULL, so emptying a nullable state
field is refused. An update whose record could not be read cannot say
where the field moves from, and is refused.

**The version guards the state the move starts from.** The update names
the version its person read, and its statement is guarded by it (0022),
so the state the move was checked from is the state the write finds, or
the write is stale. When the record as read now is at a newer version
than the update names, the move would start from a state the person
never saw: it is not judged, and the guarded statement answers the save
stale, as an echo is decided against the version named (0040, 0098). The
person reloads, rather than being refused a move from where the record
went since.

**The trail says whether, never from where or to where.** Every runtime
audit event gains `moved`: on a create or an update of a form whose policy
names moves, whether the write as planned moves the field; `null` for
every other operation and form, for a write refused before it was planned
and for one answered again (0031). A refused move's outcome is
`transition-denied`. A state is a value, and the trail holds none (0023).

**The studio writes them, and the review says them.** The Policy step's
State moves chooses the field among the form's written text and
whole-number column fields and lists its moves -- From, empty for a new
record; To; Roles -- judged by the policy check in `validatePolicy`'s
words, as the rest of the step is. A draft's review lists each move with
its roles to the publisher approving it (0065).

## Consequences

**What it buys.** A sequence of states the policy states and the server
enforces on every write through the runtime plane, per role, seen by the
publisher who approves it, and a trail of who moved which record when.

**What it costs.**
- One state field per form.
- A move is a pair of values. No condition on another field, on time or
  on the person; no "from any state": a move to cancelled from every
  state is one move per state.
- The form offers every value the field accepts. A move the person may
  not make is refused after Save, with the sentence; the host does not
  narrow the field's choices to the moves its person may make.
- A create that leaves the field to the column's default is not checked:
  the default is the schema's.
- A record read at a newer version than the update names is answered
  stale, even where the move would be allowed from where it is now.
- A write that reaches the table another way -- another application,
  SQL, a trigger -- is not checked.
- The trail says that a record moved, not from where or to where. A
  deployment that needs the history keeps it in the database.
- No workflow engine: no task, no assignment, no deadline, no
  notification on a move.
- A server older than this release refuses a policy that names moves, as
  it refuses any property it does not read: a version holding them is not
  imported into an older deployment (0062).

**What it forecloses.** Nothing: a later connector for a process engine
would read the same rule.

## Alternatives considered

**A process engine.** Process definitions, tasks and timers are a product
of their own; the backlog leaves a connector for later.

**The moves in a CHECK constraint or a trigger.** A CHECK sees one row and
not the value before; a trigger sees both, and never the person's roles.

**The host narrowing the field's choices to the moves allowed.** The
published document would change per person, or the page would read the
policy. The server's refusal guards the write either way; this is for a
later record.

**Judging the move against the record as read now, whatever its
version.** A person who then reloads is told their move is not allowed,
about a state they never saw.

**The states in the trail.** A state is business data, and the trail is
no copy of it.

## Older records

Extended, not edited away: 0011 (a policy may name a state field and its
moves), 0022 (a change of the state field is a listed move, from the
record as read), 0023 (`moved` on every runtime event).
