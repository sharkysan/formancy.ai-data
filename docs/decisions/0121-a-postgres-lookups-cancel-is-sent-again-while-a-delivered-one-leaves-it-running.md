# 0121 — A PostgreSQL lookup's cancel is sent again while a delivered one leaves its statement running

- **Status:** accepted; extends [0061](0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md): once an abandoned lookup's execute is written, a cancel request PostgreSQL received that has not stopped the statement 250 ms later is sent again, four in all
- **Date:** 2026-11-01
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-postgres/src/lookups-limits.integration.test.ts`, against
  its real server -- a lookup aborted between its describe and its
  execute, the execute held at the hop until both cancels sent so far have
  crossed and the backend dropped them, is stopped once its sleep starts
  (watched failing, in CI while Docker was down on the workstation, with
  one cancel after the execute as before: the sleep ran on past the wait);
  a late cancel still held at the hop is never sent again, so the cases
  where one or two late cancels stop the next lookup hold exactly as many
  as before. `packages/data-fixtures/src/tcp-hop.test.ts` -- the hop holds
  what a connection already open sends until release while a connection
  opened afterwards flows (watched failing with the hold taking in new
  connections, as `holdNewConnections` does: the later connection's bytes
  never arrived).

## Context

0061 stops an abandoned lookup's statement in the database: postgres.js has
PostgreSQL parse and describe a statement before it sends the execute, and
the backend drops a cancel request that arrives between the two, so the
adapter sends one when the statement is sent and another in the turn after
its execute is written.

Written first is not arriving first. A cancel request travels on a
connection of its own, opened after the execute is written, and nothing
orders the two. On CI's loaded runners the suite's case of a lookup
abandoned while it queued for a connection failed twice on PostgreSQL 18
(main at 78496ef on 2026-10-30, and #143's run on 2026-10-31), the second
time waiting for a sleep its cancels should have stopped. Neither run says
why. A cancel that reached the backend while it still waited for the
execute explains it, and the suite now makes that happen on purpose, with
the execute held at the hop: the sleep then runs its 30 s. In production
that is the load a deadline is meant to shed, scanning on for nobody.

postgres.js reports nothing of when a backend has started an execute. It
does say when a cancel request was delivered: its connection, closed by
the server once it has read it.

## Decision

**A cancel delivered after the execute was written, that has not stopped
the statement 250 ms later, is sent again**, four cancel requests after
the execute in all (`cancelUntilStopped`,
`packages/data-postgres/src/lookups/cancel.ts`). A lookup abandoned once
its execute is out has its first cancel followed the same way.

**A cancel not yet delivered is not followed.** It has not failed, and a
second would only add a late cancel, which stops the next lookup on that
backend; that lookup runs once more for one (0061), not for several.

SQL Server sends its cancel as an attention on the statement's own
connection, after the statement, so its order is the wire's; nothing
changes there.

## Consequences

**What it buys.** An abandoned lookup's statement stops when its cancel
races its execute and loses, rather than running to its end; and the
suite's case that waited for one stops failing for it.

**What it costs.**
- Up to three more cancel requests, each a connection the server opens
  and closes, for a lookup whose statement a delivered cancel did not stop
  within 250 ms.
- Where a statement takes longer than 250 ms to answer a cancel that did
  stop it -- a long network path, or a busy server -- another is sent,
  which can land on the next lookup on that backend; that lookup runs once
  more, and a second such stop refuses it, as 0061 states of late cancels.
- 250 ms and four are chosen over the 100 ms the suite holds answers for,
  not measured on a real network.

**What it forecloses.** Nothing.

## Alternatives considered

**Send the cancel after the execute later, by a fixed delay.** No delay is
long enough on every network, and a statement that ends within it is
cancelled late onto the next lookup instead.

**Send every cancel again on a timer, delivered or not.** A cancel held on
a slow path would be followed by others, each a late cancel for the next
lookup: the case 0061's one retry is sized for would become several.

**Ask the server whether the backend is executing.** A query of
`pg_stat_activity` on another connection for every abandoned lookup, under
an account that may not see other sessions' state, to learn what a
delivered cancel left running already says.
