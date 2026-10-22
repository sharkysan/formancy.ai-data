# 0098 — An echo the record moved since it was read is a stale save, not over-posting

- **Status:** accepted; narrows [0022](0022-the-runtime-plane-asks-the-policy-every-time.md): a changed read-only value from a client that read an old version is answered as stale
- **Date:** 2026-10-22
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-server/src/e2e.integration.test.ts`, on
  PostgreSQL and on SQL Server against the real server, *an order's lines
  are reached through the order: its tenant's clerk reads and updates one,
  another tenant's is told 404* -- after a save that moved the computed
  `line_total` from 3.00 to 4.50, a save from the version read before it,
  sending every answer as read, `line_total` among them, is `409 stale`
  (watched failing before this record on both engines: `403 over-posting`,
  "line_total is never written by this form on update").
  `packages/data-server/src/routes/runtime.test.ts`, *updates: an echo the
  record moved since it was read is a stale save, 409, not a refused field*
  -- a read newer than the version sent, whose `created_at` the person may
  not write differs from their echo: `409 stale`, and the statement sent
  sets no `created_at` (watched failing: `403 over-posting`); and *updates:
  an unchanged read-only echo is removed, a changed one refused, a stale
  version is 409*, which still refuses a changed echo sent with the version
  the record holds.

## Context

A formancy renderer sends every field back, the ones the person may not
write included. The server removes such an echo only when it can prove it
one: on update, when it equals what the record holds now, read first; any
other value is refused as over-posting, so that a changed read-only value is
never silently ignored
([0022](0022-the-runtime-plane-asks-the-policy-every-time.md)).

0022 named the two reasons such a value can differ, tampering and "a client
that read an old version", and answered both the same way. The second is
not rare: a field the person may not write can be moved by any write to the
record -- a computed column, `order_line.line_total` in the shared model; a
stamp a trigger sets; a value another actor may write. When another client
saved in between, the person's save carried the old value, and was refused
`403 over-posting`, saying that a field they never touched "is never written
by this form on update". The person was told something false, and reloading
the record and saving again, which is what a stale save asks of them, looked
pointless. Found by the host page's Drill down tests, saving an order line
another client had changed.

## Decision

**When the record read for the update holds a different version than the
one the person sent, every echo of a field they may not write is removed**,
whatever its value, and the update goes to the database as one guarded
statement (0015), whose expected version no longer matches: it is answered
`409 stale`, as any stale save is, and nothing is written. With the version
the record holds, a changed echo is refused as before.

The comparison is of the version tokens the server hands out, as strings:
the read and the client's token come from the same encoding (0015).

## Alternatives

- **Answer 409 before planning, when the versions differ.** It would answer
  a malformed version as stale too, which the planner refuses as
  `invalid-version`, and decide staleness outside the guarded statement that
  0015 makes the one authority.
- **Leave 0022 as it was.** A stale save with a computed or trigger-set
  field would keep saying the person changed a field they cannot change.

## Consequences

**What it buys.** A save over a record somebody else changed is told it is
stale, whichever fields the change moved, and the person is asked to reload
and review, which mends it.

**What it costs.**

- **A tampered read-only value sent with an old version is answered stale**,
  not `403 over-posting`, so a client probing what it may change learns
  only that its version is old. Nothing is written either way: the guarded
  statement matches no row.
- **The read decides only which echoes go.** Whether the save is stale is
  still the statement's: a write that lands between the read and the
  statement is found there, as before (0015).
