# 0114 — The studio names a chain of versions in the Choose step, and keeps it through a regeneration

- **Status:** accepted; extends [0113](0113-a-form-over-versions-changes-the-open-one-from-a-date.md): the studio names a chain, which 0113 left to a proposal's request through the administrator's plane
- **Date:** 2026-10-30
- **Deciders:** Daniel Bacher
- **Verified by:**
  `apps/studio/src/choose-versions.test.tsx`, against the real server
  behind a fake `fetch` -- the box ticked, its start and end are the
  proposal's request and the generator binds the chain over them, every
  control named and axe clean (watched failing with the choice left out of
  the request: none was asked for); unticked, nothing is asked; a root no
  column of which could start a version offers no box; and a published
  form generated again and taken up as the draft shows its chain ticked in
  the Choose step and asks for it again (watched failing with the chain
  left out of the draft taken up: the box was unticked).

## Context

0113 lets a generation request name a chain of versions, `validity: {
from, to }`, and left the studio without a control for it: an
administrator named a chain only by sending a proposal's request to the
administrator's plane by hand. The Choose step is where a request is
made.

## Decision

**The Choose step offers Versions** (`apps/studio/src/choose-versions.tsx`)
where the root has a column that could start a version and one that could
end it (`validityCandidates`, `choice.ts`): a readable date or instant that
may not be NULL and is part of a key of two columns or more, and one that
may be NULL. A box -- "Each row of … is a version, valid from a date until
the next one starts" -- and, ticked, "Valid from" and "Valid until, empty
while open", each a choice among those columns, the first of each chosen.
Unticked, the rows are records of their own and nothing is asked. Whether a
pair holds a chain -- one kind, a key holding the start, a version column --
is the generator's to say, in its words, when the form is generated, as it
says every refusal.

**A regeneration keeps it.** A published form generated again from the
Drift step and taken up as the draft is rebuilt from its stored request:
its chain is that request's, in the draft's request and in the Choose
step's choice, so generating once more from there asks for it again.

## Consequences

**What it buys.** An administrator names a chain where they choose
everything else about the form, and sees what it changes in the Generate
step's notes.

**What it costs.**
- The box is offered from what the snapshot says a column could be, not
  from whether the pair holds; a pair the generator refuses is refused
  when the form is generated, not before.
- The first candidate of each is chosen when the box is ticked; a table
  with several is the administrator's to set.
- The host page still offers no change from a date: the next record's.

**What it forecloses.** Nothing.

## Alternatives considered

**Offering only the pairs the generator would accept.** It would ask the
generator's rules a second time in the studio, where they could drift
apart; the generator's refusal, in its words, is the one decision.
